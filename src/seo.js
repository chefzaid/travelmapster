'use strict';

// Crawler plumbing for the public pages: robots.txt, a sitemap and the link-preview tags of
// shared maps. A shared map (/?u=<name>) is listed and indexed only when its owner opts in
// (ADR 0023); others are served with a noindex header.

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

/** The sitemap: the public pages, then the shared maps whose owners opted in. */
function sitemapXml(origin, paths = PUBLIC_PAGES) {
    const urls = paths.map(page => `  <url><loc>${escapeXml(origin + page)}</loc></url>`);
    return ['<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n');
}

/**
 * The app page with a shared map's own title, description and link-preview tags (Open Graph
 * and Twitter cards), and a canonical address when it may be indexed.
 */
function pageWithMeta(html, { title, description, url, image, imageAlt, indexed }) {
    const tags = [
        `<meta property="og:url" content="${escapeXml(url)}">`,
        `<meta property="og:image" content="${escapeXml(image)}">`,
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        `<meta property="og:image:alt" content="${escapeXml(imageAlt)}">`,
        '<meta name="twitter:card" content="summary_large_image">',
        indexed ? `<link rel="canonical" href="${escapeXml(url)}">` : ''
    ].filter(Boolean).map(tag => `    ${tag}\n`).join('');
    const content = (pattern, text) => page => page.replace(pattern, (_, start) => `${start}${escapeXml(text)}`);
    return [
        content(/(<title>)[^<]*/, title),
        content(/(<meta name="description" content=")[^"]*/, description),
        content(/(<meta property="og:title" content=")[^"]*/, title),
        content(/(<meta property="og:description" content=")[^"]*/, description),
        page => page.replace('</head>', () => `${tags}</head>`)
    ].reduce((page, change) => change(page), html);
}

module.exports = { PUBLIC_PAGES, pageWithMeta, robotsTxt, sitemapXml, siteOrigin };
