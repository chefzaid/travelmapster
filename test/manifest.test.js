// The installable app's manifest points at icons that exist, at the sizes it states (ADR 0021).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8'));

// Width and height from a PNG file's header.
function pngSize(file) {
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG', `${file} is a PNG`);
    return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

test('the manifest makes the app installable, with icons that exist at their stated sizes', () => {
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.display, 'standalone');
    assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/);
    for (const size of ['192x192', '512x512']) {
        for (const purpose of ['any', 'maskable']) {
            assert.ok(manifest.icons.some(icon => icon.sizes === size && icon.purpose === purpose), `${purpose} icon ${size}`);
        }
    }
    for (const icon of manifest.icons) assert.equal(pngSize(path.join(publicDir, icon.src)), icon.sizes, icon.src);
    assert.equal(pngSize(path.join(publicDir, 'icons', 'apple-touch-icon.png')), '180x180');
});
