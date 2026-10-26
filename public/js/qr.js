// QR codes (ISO/IEC 18004) for the two-step sign-in secret: byte mode, error correction level
// M, versions 1 to 10 (up to 213 bytes, enough for an otpauth URI), drawn as SVG. Pure, unit
// tested in Node by reading the codes back with a decoder.
import { t } from './i18n.js';

// Per version at level M: [error correction codewords per block, [blocks, data codewords]...].
/** @type {Array<null | [number, ...Array<[number, number]>]>} */
const BLOCKS = [
    null,
    [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]],
    [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]
];
const ALIGNMENT = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const LEVEL_M = 0b00;

// ---------------------------------------------------------------- Reed-Solomon over GF(256)

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const multiply = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function generator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
        const next = new Array(poly.length + 1).fill(0);
        poly.forEach((coefficient, j) => {
            next[j] ^= coefficient;
            next[j + 1] ^= multiply(coefficient, EXP[i]);
        });
        poly = next;
    }
    return poly;
}

function errorCorrection(data, degree) {
    const gen = generator(degree);
    const remainder = [...data, ...new Array(degree).fill(0)];
    for (let i = 0; i < data.length; i++) {
        const factor = remainder[i];
        if (factor) gen.forEach((coefficient, j) => { remainder[i + j] ^= multiply(coefficient, factor); });
    }
    return remainder.slice(data.length);
}

// ---------------------------------------------------------------- data codewords

function dataCapacity(version) {
    const [, ...groups] = BLOCKS[version];
    return groups.reduce((sum, [count, size]) => sum + count * size, 0);
}

function codewords(bytes, version) {
    const bits = [];
    const push = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
    push(0b0100, 4);
    push(bytes.length, version < 10 ? 8 : 16);
    for (const byte of bytes) push(byte, 8);
    const capacity = dataCapacity(version) * 8;
    push(0, Math.min(4, capacity - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
    for (let pad = 0; data.length < capacity / 8; pad++) data.push(pad % 2 ? 0x11 : 0xec);

    // Split into blocks, add error correction, then interleave.
    const [ecLength, ...groups] = BLOCKS[version];
    const blocks = [];
    let offset = 0;
    for (const [count, size] of groups) {
        for (let i = 0; i < count; i++) {
            const block = data.slice(offset, offset + size);
            offset += size;
            blocks.push({ data: block, ec: errorCorrection(block, ecLength) });
        }
    }
    const result = [];
    const longest = Math.max(...blocks.map(block => block.data.length));
    for (let i = 0; i < longest; i++) for (const block of blocks) if (i < block.data.length) result.push(block.data[i]);
    for (let i = 0; i < ecLength; i++) for (const block of blocks) result.push(block.ec[i]);
    return result;
}

// ---------------------------------------------------------------- the matrix

function bchRemainder(value, poly, length) {
    let remainder = value << length;
    const top = 31 - Math.clz32(poly);
    while (31 - Math.clz32(remainder) >= top) remainder ^= poly << (31 - Math.clz32(remainder) - top);
    return remainder;
}

const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    r => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

function baseMatrix(version) {
    const size = 17 + 4 * version;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (r, c, dark) => {
        modules[r][c] = dark;
        reserved[r][c] = true;
    };
    // Finder patterns with their separators.
    for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
        for (let r = -1; r <= 7; r++) {
            for (let c = -1; c <= 7; c++) {
                const row = top + r;
                const column = left + c;
                if (row < 0 || column < 0 || row >= size || column >= size) continue;
                const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
                set(row, column, ring !== 2 && ring !== 4);
            }
        }
    }
    // Alignment patterns, except where they would overlap a finder.
    for (const r of ALIGNMENT[version]) {
        for (const c of ALIGNMENT[version]) {
            if (reserved[r][c]) continue;
            for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
    }
    // Timing patterns.
    for (let i = 8; i < size - 8; i++) {
        set(6, i, i % 2 === 0);
        set(i, 6, i % 2 === 0);
    }
    // The dark module, and room for the format and version information.
    set(size - 8, 8, true);
    for (let i = 0; i < 9; i++) {
        if (!reserved[8][i]) reserved[8][i] = true;
        if (!reserved[i][8]) reserved[i][8] = true;
    }
    for (let i = 0; i < 8; i++) {
        reserved[8][size - 1 - i] = true;
        reserved[size - 1 - i][8] = true;
    }
    if (version >= 7) {
        const bits = (version << 12) | bchRemainder(version, 0x1f25, 12);
        for (let i = 0; i < 18; i++) {
            const dark = ((bits >>> i) & 1) === 1;
            const a = Math.floor(i / 3);
            const b = (i % 3) + size - 11;
            set(a, b, dark);
            set(b, a, dark);
        }
    }
    return { size, modules, reserved };
}

function placeData(matrix, data) {
    const { size, modules, reserved } = matrix;
    const bits = data.flatMap(byte => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1));
    let index = 0;
    let upward = true;
    for (let right = size - 1; right > 0; right -= 2) {
        if (right === 6) right = 5;
        for (let step = 0; step < size; step++) {
            const row = upward ? size - 1 - step : step;
            for (const column of [right, right - 1]) {
                if (reserved[row][column]) continue;
                modules[row][column] = index < bits.length ? bits[index] === 1 : false;
                index++;
            }
        }
        upward = !upward;
    }
}

function withFormat(matrix, mask) {
    const { size, reserved } = matrix;
    const modules = matrix.modules.map((row, r) => row.map((dark, c) => (reserved[r][c] ? dark : dark !== MASKS[mask](r, c))));
    const data = (LEVEL_M << 3) | mask;
    const bits = ((data << 10) | bchRemainder(data, 0x537, 10)) ^ 0x5412;
    const bit = i => ((bits >>> i) & 1) === 1;
    // One copy around the top-left finder, skipping the timing pattern...
    for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
    modules[7][8] = bit(6);
    modules[8][8] = bit(7);
    modules[8][7] = bit(8);
    for (let i = 9; i < 15; i++) modules[8][14 - i] = bit(i);
    // ...and one split beside the top-right and bottom-left finders.
    for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = bit(i);
    return modules;
}

// The standard's penalty score: runs, blocks, finder-like patterns and balance.
function penalty(modules) {
    const size = modules.length;
    let score = 0;
    const lines = [...modules, ...modules[0].map((_, c) => modules.map(row => row[c]))];
    for (const line of lines) {
        let run = 1;
        for (let i = 1; i <= size; i++) {
            if (i < size && line[i] === line[i - 1]) run++;
            else {
                if (run >= 5) score += run - 2;
                run = 1;
            }
        }
        const text = line.map(dark => (dark ? '1' : '0')).join('');
        score += 40 * ((text.match(/(?=10111010000|00001011101)/g) || []).length);
    }
    for (let r = 0; r < size - 1; r++) {
        for (let c = 0; c < size - 1; c++) {
            const dark = modules[r][c];
            if (modules[r][c + 1] === dark && modules[r + 1][c] === dark && modules[r + 1][c + 1] === dark) score += 3;
        }
    }
    const darkCount = modules.flat().filter(Boolean).length;
    score += 10 * Math.floor(Math.abs((darkCount * 100) / (size * size) - 50) / 5);
    return score;
}

/** The QR code of a text as rows of dark (true) and light modules, with the lowest penalty mask. */
export function qrMatrix(text) {
    const bytes = [...new TextEncoder().encode(text)];
    const version = BLOCKS.findIndex((_, v) => v > 0 && dataCapacity(v) * 8 >= 4 + (v < 10 ? 8 : 16) + bytes.length * 8);
    if (version < 1) throw new Error(t('Too long for a QR code here.'));
    const matrix = baseMatrix(version);
    placeData(matrix, codewords(bytes, version));
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
        const modules = withFormat(matrix, mask);
        const score = penalty(modules);
        if (!best || score < best.score) best = { modules, score };
    }
    return best.modules;
}

/** The QR code as an SVG image, with the quiet zone around it. */
export function qrSvg(text, { scale = 6, dark = '#000', light = '#fff' } = {}) {
    const modules = qrMatrix(text);
    const size = modules.length + 8;
    let path = '';
    modules.forEach((row, r) => row.forEach((on, c) => { if (on) path += `M${c + 4} ${r + 4}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size * scale}" height="${size * scale}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`
        + `<rect width="${size}" height="${size}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
