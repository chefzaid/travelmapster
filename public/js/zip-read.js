// Reads entries from a ZIP file without loading all of it: the central directory first, then
// only the entries asked for, inflated with the browser's DecompressionStream. Enough for data
// exports from other apps, which can hold gigabytes of photos. Pure, unit tested in Node.
import { t } from './i18n.js';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

async function bytes(blob, start, end) {
    return new DataView(await blob.slice(start, end).arrayBuffer());
}

/** The entries of a ZIP file (a Blob or File): name, sizes, method and where the data starts. */
export async function zipEntries(blob) {
    // The end record sits in the last 22 bytes, plus a comment of up to 64 KB.
    const tailStart = Math.max(0, blob.size - 22 - 65_535);
    const tail = await bytes(blob, tailStart, blob.size);
    let end = -1;
    for (let i = tail.byteLength - 22; i >= 0; i -= 1) {
        if (tail.getUint32(i, true) === EOCD_SIGNATURE) {
            end = i;
            break;
        }
    }
    if (end < 0) throw new Error(t('This is not a ZIP file.'));
    const count = tail.getUint16(end + 10, true);
    const size = tail.getUint32(end + 12, true);
    const offset = tail.getUint32(end + 16, true);
    const directory = await bytes(blob, offset, offset + size);
    const decoder = new TextDecoder();
    const entries = [];
    let position = 0;
    for (let i = 0; i < count; i += 1) {
        if (directory.getUint32(position, true) !== CENTRAL_SIGNATURE) throw new Error(t('This ZIP file is damaged.'));
        const nameLength = directory.getUint16(position + 28, true);
        const extraLength = directory.getUint16(position + 30, true);
        const commentLength = directory.getUint16(position + 32, true);
        entries.push({
            name: decoder.decode(new Uint8Array(directory.buffer, directory.byteOffset + position + 46, nameLength)),
            method: directory.getUint16(position + 10, true),
            compressedSize: directory.getUint32(position + 20, true),
            size: directory.getUint32(position + 24, true),
            localOffset: directory.getUint32(position + 42, true)
        });
        position += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

/** The text of one entry, stored or deflated. */
export async function readZipText(blob, entry) {
    const local = await bytes(blob, entry.localOffset, entry.localOffset + 30);
    if (local.getUint32(0, true) !== LOCAL_SIGNATURE) throw new Error(t('This ZIP file is damaged.'));
    const start = entry.localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    const data = blob.slice(start, start + entry.compressedSize);
    if (entry.method === 0) return data.text();
    if (entry.method !== 8) throw new Error(t('{file} uses a ZIP compression this app cannot read.', { file: entry.name }));
    return new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
}
