'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { promisify } = require('node:util');

const brotli = promisify(zlib.brotliCompress);
// Text the app serves as files: scripts, styles, SVG and map data.
const TEXT_FILE = /\.(m?js|css|svg|json|geojson)$/;

/**
 * Sends static text files Brotli-compressed to browsers that accept it. Map data has a
 * best-quality copy on disk (public/data/**.br, from scripts/compress-map-data.js); scripts,
 * styles and SVG are compressed on their first request and kept in memory, as they only change
 * with a release. Mounted before the static files, with the same Cache-Control as that mount.
 */
function brotliStatic(publicDir, cacheControl, cache = new Map()) {
    const files = new Set();
    const onDisk = new Set();
    const walk = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (entry.name.endsWith('.br')) onDisk.add(file.slice(0, -3));
            else if (TEXT_FILE.test(entry.name)) files.add(file);
        }
    };
    walk(publicDir);

    async function compressed(file) {
        if (onDisk.has(file)) return `${file}.br`;
        if (!cache.has(file)) {
            const pending = fs.promises.readFile(file).then(data =>
                brotli(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } }));
            // A failure is not kept: the next request tries again.
            pending.catch(() => cache.delete(file));
            cache.set(file, pending);
        }
        return cache.get(file);
    }

    return async (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        let file;
        try {
            file = path.join(publicDir, path.normalize(decodeURIComponent(req.path)));
        } catch {
            return next();
        }
        if (!files.has(file)) return next();
        // Caches must keep the compressed and plain answers apart.
        res.vary('Accept-Encoding');
        if (!/\bbr\b/.test(req.get('Accept-Encoding') || '')) return next();
        try {
            const body = await compressed(file);
            res.type(path.extname(file));
            res.set({ 'Content-Encoding': 'br', 'Cache-Control': cacheControl });
            if (typeof body === 'string') return res.sendFile(body, { cacheControl: false });
            return res.send(body);
        } catch (err) {
            return next(err);
        }
    };
}

module.exports = { brotliStatic };
