// Where and when a photo was taken, from its EXIF metadata: GPS position and the original
// date, in JPEG files and in HEIC/HEIF files (iPhones). Only the file's first bytes are read,
// plus the EXIF block where a HEIC file stores it. Pure, unit tested in Node.

const HEAD_BYTES = 256 * 1024;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATE_TIME = 0x0132;
const TAG_DATE_ORIGINAL = 0x9003;

const ascii = (view, start, length) => String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + start, length));

/** The entries of one TIFF directory, by tag: a reader for each value. */
function readIfd(view, tiff, offset, little) {
    const entries = new Map();
    if (offset <= 0 || tiff + offset + 2 > view.byteLength) return entries;
    const count = view.getUint16(tiff + offset, little);
    for (let i = 0; i < count; i++) {
        const at = tiff + offset + 2 + i * 12;
        if (at + 12 > view.byteLength) break;
        const tag = view.getUint16(at, little);
        const type = view.getUint16(at + 2, little);
        const n = view.getUint32(at + 4, little);
        const size = { 2: 1, 3: 2, 4: 4, 5: 8 }[type] || 1;
        // Values of four bytes or less sit in the entry; others at an offset from the TIFF start.
        const data = n * size <= 4 ? at + 8 : tiff + view.getUint32(at + 8, little);
        if (data + n * size > view.byteLength) continue;
        entries.set(tag, {
            text: () => ascii(view, data, Math.min(n, 64)).replace(/\0.*$/s, ''),
            long: () => (type === 3 ? view.getUint16(data, little) : view.getUint32(data, little)),
            rationals: () => Array.from({ length: n }, (_, k) => {
                const denominator = view.getUint32(data + k * 8 + 4, little);
                return denominator ? view.getUint32(data + k * 8, little) / denominator : Number.NaN;
            })
        });
    }
    return entries;
}

function coordinate(ifd, valueTag, refTag, negative) {
    const value = ifd.get(valueTag)?.rationals();
    if (!value || value.length < 3 || value.some(Number.isNaN)) return null;
    const [degrees, minutes, seconds] = value;
    const sign = ifd.get(refTag)?.text().trim().toUpperCase() === negative ? -1 : 1;
    return sign * (degrees + minutes / 60 + seconds / 3600);
}

/** Position and day from a TIFF block (the EXIF payload): `{ lat, lng, date }`, or null. */
export function readTiff(view, tiff = 0) {
    if (tiff + 8 > view.byteLength) return null;
    const order = ascii(view, tiff, 2);
    if (order !== 'II' && order !== 'MM') return null;
    const little = order === 'II';
    const ifd0 = readIfd(view, tiff, view.getUint32(tiff + 4, little), little);
    const exif = readIfd(view, tiff, ifd0.get(TAG_EXIF_IFD)?.long() ?? 0, little);
    const gps = readIfd(view, tiff, ifd0.get(TAG_GPS_IFD)?.long() ?? 0, little);
    const lat = coordinate(gps, 2, 1, 'S');
    const lng = coordinate(gps, 4, 3, 'W');
    const stamp = (exif.get(TAG_DATE_ORIGINAL) || ifd0.get(TAG_DATE_TIME))?.text() || '';
    const match = /^(\d{4}):(\d{2}):(\d{2})/.exec(stamp);
    const date = match && match[1] !== '0000' ? `${match[1]}-${match[2]}-${match[3]}` : null;
    // 0, 0 is what cameras without a fix write.
    const located = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0);
    return located || date ? { lat: located ? lat : null, lng: located ? lng : null, date } : null;
}

// JPEG: the APP1 segment that starts with "Exif\0\0" holds the TIFF block.
function jpegTiff(view) {
    let at = 2;
    while (at + 4 <= view.byteLength && view.getUint8(at) === 0xff) {
        const marker = view.getUint8(at + 1);
        const length = view.getUint16(at + 2);
        if (marker === 0xe1 && ascii(view, at + 4, 4) === 'Exif') return at + 10;
        if (marker === 0xda) break;
        at += 2 + length;
    }
    return -1;
}

// ISO base media boxes (HEIC): size, type and where the content starts, within [start, end).
function* boxes(view, start, end) {
    let at = start;
    while (at + 8 <= end) {
        let size = view.getUint32(at);
        const type = ascii(view, at + 4, 4);
        let header = 8;
        if (size === 1 && at + 16 <= end) {
            size = Number(view.getBigUint64(at + 8));
            header = 16;
        } else if (size === 0) size = end - at;
        if (size < header) return;
        yield { type, start: at + header, end: Math.min(at + size, end) };
        at += size;
    }
}

const readSized = (view, at, size) => (size === 8 ? Number(view.getBigUint64(at)) : size === 4 ? view.getUint32(at) : size === 2 ? view.getUint16(at) : 0);

// HEIC: the "Exif" item named in the meta box's item info, placed by its item location.
function heicExifPlace(view) {
    const meta = [...boxes(view, 0, view.byteLength)].find(box => box.type === 'meta');
    if (!meta) return null;
    const inner = [...boxes(view, meta.start + 4, meta.end)];
    const iinf = inner.find(box => box.type === 'iinf');
    const iloc = inner.find(box => box.type === 'iloc');
    if (!iinf || !iloc) return null;
    const iinfVersion = view.getUint8(iinf.start);
    let exifId = null;
    for (const infe of boxes(view, iinf.start + (iinfVersion === 0 ? 6 : 8), iinf.end)) {
        const version = view.getUint8(infe.start);
        if (infe.type !== 'infe' || version < 2) continue;
        const id = version === 2 ? view.getUint16(infe.start + 4) : view.getUint32(infe.start + 4);
        const typeAt = infe.start + (version === 2 ? 8 : 10);
        if (ascii(view, typeAt, 4) === 'Exif') exifId = id;
    }
    if (exifId === null) return null;
    const version = view.getUint8(iloc.start);
    const sizes = view.getUint16(iloc.start + 4);
    const [offsetSize, lengthSize, baseSize, indexSize] = [sizes >> 12, (sizes >> 8) & 15, (sizes >> 4) & 15, version > 0 ? sizes & 15 : 0];
    let at = iloc.start + 6;
    const count = version < 2 ? view.getUint16(at) : view.getUint32(at);
    at += version < 2 ? 2 : 4;
    for (let i = 0; i < count; i++) {
        const id = version < 2 ? view.getUint16(at) : view.getUint32(at);
        at += version < 2 ? 2 : 4;
        if (version > 0) at += 2;
        at += 2;
        const base = readSized(view, at, baseSize);
        at += baseSize;
        const extents = view.getUint16(at);
        at += 2;
        const offset = readSized(view, at + indexSize, offsetSize);
        const length = readSized(view, at + indexSize + offsetSize, lengthSize);
        at += extents * (indexSize + offsetSize + lengthSize);
        if (id === exifId) return { offset: base + offset, length };
    }
    return null;
}

/**
 * Where and when a photo (a Blob or File) was taken: `{ lat, lng, date }` with a `YYYY-MM-DD`
 * date as the camera's clock showed it; either part may be null. Null without metadata.
 */
export async function photoMetadata(blob) {
    const head = new DataView(await blob.slice(0, HEAD_BYTES).arrayBuffer());
    if (head.byteLength < 12) return null;
    if (head.getUint16(0) === 0xffd8) {
        const tiff = jpegTiff(head);
        return tiff < 0 ? null : readTiff(head, tiff);
    }
    if (ascii(head, 4, 4) !== 'ftyp') return null;
    const place = heicExifPlace(head);
    if (!place || place.length < 10) return null;
    const block = new DataView(await blob.slice(place.offset, place.offset + place.length).arrayBuffer());
    // The item starts with the offset of the TIFF header within it.
    return readTiff(block, 4 + block.getUint32(0));
}
