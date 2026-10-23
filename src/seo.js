'use strict';

// Crawler plumbing for the public pages: robots.txt and a sitemap. Shared user maps
// (/?u=<name>) are left out and served with a noindex header until their owners can opt in.

/** Public pages worth indexing, by path. */
const PUBLIC_PAGES = ['/', '/schengen-calculator'];

const escapeXml = text => String(text).replace(/[<>&'"]/g, char => `&#${char.charCodeAt(0)};`);

/** The site's origin: PUBLIC_URL when set, otherwise the one the request came in on. */
function siteOrigin(config, req) {
    return config.publicUrl || `${req.protocol}://${req.get('host')}`;
}

function robotsTxt(origin) {
    return ['User-agent: *', 'Disallow: /api/', '', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n');
}

function sitemapXml(origin, paths = PUBLIC_PAGES) {
    const urls = paths.map(page => `  <url><loc>${escapeXml(origin + page)}</loc></url>`);
    return ['<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n');
}

module.exports = { PUBLIC_PAGES, robotsTxt, sitemapXml, siteOrigin };
