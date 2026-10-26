// Unit tests for QR codes (public/js/qr.js), read back with the jsQR decoder.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jsQR = require('jsqr');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'qr.js'));

/** Reads a QR matrix back, as a camera would see it: four pixels a module, a quiet zone. */
function decode(modules) {
    const scale = 4;
    const quiet = 4;
    const size = (modules.length + 2 * quiet) * scale;
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    modules.forEach((row, r) => row.forEach((dark, c) => {
        if (!dark) return;
        for (let y = 0; y < scale; y++) {
            for (let x = 0; x < scale; x++) {
                const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
                pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
            }
        }
    }));
    return jsQR(pixels, size, size)?.data ?? null;
}

test('QR codes of every version read back as their text', async () => {
    const { qrMatrix } = await load();
    // Lengths that need versions 1 to 10 at error correction level M.
    for (const length of [1, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213]) {
        const text = Array.from({ length }, (_, i) => 'abcdefghijklmnopqrstuvwxyz0123456789:/?=&%'[i % 42]).join('');
        const modules = qrMatrix(text);
        assert.equal(modules.length % 4, 1, `square of 17 + 4 × version modules (${length})`);
        assert.equal(decode(modules), text, `${length} characters`);
    }
    assert.throws(() => qrMatrix('x'.repeat(214)), /Too long/);
});

test('an otpauth URI makes a QR code an authenticator app can read, also as SVG', async () => {
    const { qrMatrix, qrSvg } = await load();
    const uri = 'otpauth://totp/TravelMapster%3Ajeanne.d_arc-1412?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=TravelMapster&algorithm=SHA1&digits=6&period=30';
    assert.equal(decode(qrMatrix(uri)), uri);
    assert.equal(decode(qrMatrix('Café ✈ 東京')), 'Café ✈ 東京', 'any text, as UTF-8 bytes');
    const svg = qrSvg('hello', { scale: 2 });
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="58" height="58" viewBox="0 0 29 29"/);
    assert.match(svg, /<path d="M4 4h1v1h-1z/);
});
