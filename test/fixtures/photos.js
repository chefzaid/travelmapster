'use strict';

// Photos built byte by byte for the import tests: JPEG and HEIC files with EXIF dates and GPS
// positions, as cameras and phones write them.

/** A little-endian TIFF block with a date and, when given, a GPS position. */
function tiff({ date, lat, lng }) {
    const entries = [];
    const data = [];
    let dataOffset = 0;
    // IFD0 at 8 with two entries, the Exif IFD and the GPS IFD after it; values follow.
    const ifd = (list, at) => {
        const buffer = Buffer.alloc(2 + list.length * 12 + 4);
        buffer.writeUInt16LE(list.length, 0);
        list.forEach(([tag, type, count, value], i) => {
            buffer.writeUInt16LE(tag, 2 + i * 12);
            buffer.writeUInt16LE(type, 4 + i * 12);
            buffer.writeUInt32LE(count, 6 + i * 12);
            if (Buffer.isBuffer(value)) value.copy(buffer, 10 + i * 12);
            else buffer.writeUInt32LE(value, 10 + i * 12);
        });
        entries.push({ at, buffer });
        return at + buffer.length;
    };
    const rational = values => {
        const buffer = Buffer.alloc(values.length * 8);
        values.forEach((value, i) => {
            buffer.writeUInt32LE(Math.round(value * 1000), i * 8);
            buffer.writeUInt32LE(1000, i * 8 + 4);
        });
        return buffer;
    };
    const dms = value => {
        const absolute = Math.abs(value);
        const degrees = Math.floor(absolute);
        const minutes = Math.floor((absolute - degrees) * 60);
        return [degrees, minutes, ((absolute - degrees) * 60 - minutes) * 60];
    };
    const ifd0At = 8;
    const exifAt = ifd0At + 2 + 2 * 12 + 4;
    const gpsAt = exifAt + 2 + 12 + 4;
    dataOffset = gpsAt + 2 + 4 * 12 + 4;
    const put = buffer => {
        const at = dataOffset;
        data.push({ at, buffer });
        dataOffset += buffer.length;
        return at;
    };
    const dateAt = put(Buffer.from(`${date}\0`, 'latin1'));
    const latAt = put(rational(dms(lat ?? 0)));
    const lngAt = put(rational(dms(lng ?? 0)));
    const ref = text => Buffer.from(`${text}\0\0\0`, 'latin1');
    ifd([[0x8769, 4, 1, exifAt], [0x8825, 4, 1, lat === undefined ? 0 : gpsAt]], ifd0At);
    ifd([[0x9003, 2, 20, dateAt]], exifAt);
    ifd([[1, 2, 2, ref(lat < 0 ? 'S' : 'N')], [2, 5, 3, latAt], [3, 2, 2, ref(lng < 0 ? 'W' : 'E')], [4, 5, 3, lngAt]], gpsAt);
    const out = Buffer.alloc(dataOffset);
    out.write('II', 0, 'latin1');
    out.writeUInt16LE(42, 2);
    out.writeUInt32LE(ifd0At, 4);
    for (const { at, buffer } of [...entries, ...data]) buffer.copy(out, at);
    return out;
}

function jpeg(meta) {
    const block = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff(meta)]);
    const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
    const app1 = Buffer.alloc(4);
    app1.writeUInt16BE(0xffe1, 0);
    app1.writeUInt16BE(block.length + 2, 2);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, app1, block, Buffer.from([0xff, 0xda, 0, 2]), Buffer.alloc(32)]);
}

const box = (type, ...parts) => {
    const body = Buffer.concat(parts);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length + 8, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body]);
};
const u16 = value => { const b = Buffer.alloc(2); b.writeUInt16BE(value); return b; };
const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; };

/** A HEIC file whose Exif item (id 2) sits in the media data after the meta box. */
function heic(meta) {
    const exifItem = Buffer.concat([u32(0), tiff(meta)]);
    const build = offset => {
        const ftyp = box('ftyp', Buffer.from('heic', 'latin1'), u32(0), Buffer.from('mif1heic', 'latin1'));
        const infe = (id, type) => box('infe', Buffer.from([2, 0, 0, 0]), u16(id), u16(0), Buffer.from(type, 'latin1'));
        const iinf = box('iinf', Buffer.from([0, 0, 0, 0]), u16(2), infe(1, 'hvc1'), infe(2, 'Exif'));
        // Version 0: offset and length of 4 bytes, no base offset.
        const iloc = box('iloc', Buffer.from([0, 0, 0, 0]), u16(0x4400), u16(1), u16(2), u16(0), u16(1), u32(offset), u32(exifItem.length));
        const metaBox = box('meta', Buffer.from([0, 0, 0, 0]), box('hdlr', Buffer.alloc(24)), iinf, iloc);
        return Buffer.concat([ftyp, metaBox]);
    };
    const head = build(0);
    return Buffer.concat([build(head.length + 8), box('mdat', exifItem)]);
}

module.exports = { box, heic, jpeg, tiff };
