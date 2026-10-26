// Map posters: the traveler's map as a vector SVG in a standard print size and style, with a
// title, a subtitle and a legend, from the bundled country borders. Equal Earth projection, so
// every country keeps its true size. Pure, unit tested in Node.

export const POSTER_SIZES = [
    { id: 'a4', label: 'A4 (297 × 210 mm)', width: 297, height: 210 },
    { id: 'a3', label: 'A3 (420 × 297 mm)', width: 420, height: 297 },
    { id: 'a2', label: 'A2 (594 × 420 mm)', width: 594, height: 420 },
    { id: '50x70', label: '50 × 70 cm', width: 700, height: 500 },
    { id: '18x24', label: '18 × 24 in', width: 609.6, height: 457.2 }
];

// Colours by style: background, land, borders, text and one fill per status.
export const POSTER_STYLES = {
    cartoon: {
        label: 'Cartoon', background: '#bfe6f5', land: '#fff7e8', border: '#1f3b57', text: '#1f3b57',
        visited: '#4fc3b8', lived: '#9b8ce0', transit: '#d7e7ef', wishlist: '#ffd166', home: '#f7a072'
    },
    ink: {
        label: 'Ink on paper', background: '#ffffff', land: '#ffffff', border: '#222222', text: '#111111',
        visited: '#555555', lived: '#2b2b2b', transit: '#d9d9d9', wishlist: '#b3b3b3', home: '#000000'
    },
    night: {
        label: 'Night', background: '#0f1e33', land: '#22364f', border: '#8aa0b8', text: '#f3ead8',
        visited: '#e9b949', lived: '#d98b5f', transit: '#3f5875', wishlist: '#7fb3d5', home: '#f4e1a1'
    }
};

/**
 * The status a map colours each country in, from the passport's stats: home first, then
 * lived, been, layover and wish; null for the rest.
 */
export function mapStatusOf(stats) {
    return id => {
        if (id === stats.homeId) return 'home';
        if (stats.livedIds.has(id)) return 'lived';
        if (stats.visitedIds.has(id)) return 'visited';
        if (stats.transitIds.has(id)) return 'transit';
        return stats.wishlistIds.has(id) ? 'wishlist' : null;
    };
}

const LEGEND = [['home', 'Home'], ['lived', 'Lived there'], ['visited', 'Been there'], ['transit', 'Transit only'], ['wishlist', 'Wishlist']];

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;
const RADIANS = Math.PI / 180;

/** Equal Earth projection of a [lng, lat] point, in units where the world is about 5.4 × 2.6. */
export function equalEarth([lng, lat]) {
    const theta = Math.asin(M * Math.sin(lat * RADIANS));
    const theta2 = theta * theta;
    const theta6 = theta2 * theta2 * theta2;
    return [
        (lng * RADIANS * Math.cos(theta)) / (M * (A1 + 3 * A2 * theta2 + theta6 * (7 * A3 + 9 * A4 * theta2))),
        theta * (A1 + A2 * theta2 + theta6 * (A3 + A4 * theta2))
    ];
}

const WORLD_WIDTH = 2 * equalEarth([180, 0])[0];
const WORLD_HEIGHT = 2 * equalEarth([0, 90])[1];

const escapeXml = value => String(value ?? '').replace(/[<>&"']/g, character =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]);

const round = value => Math.round(value * 100) / 100;

function ringPath(ring, toPage) {
    let path = '';
    let last = '';
    for (const [i, point] of ring.entries()) {
        const [x, y] = toPage(point).map(round);
        const step = `${x} ${y}`;
        if (step === last) continue;
        path += `${i ? 'L' : 'M'}${step}`;
        last = step;
    }
    return `${path}Z`;
}

function featurePath(geometry, toPage) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.flatMap(polygon => polygon.map(ring => ringPath(ring, toPage))).join('');
}

/**
 * The poster as SVG text. `countries` are GeoJSON features with an `id` property;
 * `statusOf(id)` gives home, lived, visited, transit, wishlist or null; `counts` are shown in
 * the legend (statuses without any are left out); `cities` ([lng, lat]) are drawn as dots.
 */
export function posterSvg({ countries, statusOf, counts = {}, cities = [], size = 'a3', style = 'cartoon', title, subtitle = '' }) {
    const page = POSTER_SIZES.find(item => item.id === size) || POSTER_SIZES[1];
    const colors = POSTER_STYLES[style] || POSTER_STYLES.cartoon;
    const { width, height } = page;
    const margin = width * 0.05;
    const titleSize = width * 0.04;
    const top = margin + titleSize * 1.6 + (subtitle ? titleSize * 0.8 : 0);
    const bottom = height - margin - titleSize * 0.9;
    const scale = Math.min((width - 2 * margin) / WORLD_WIDTH, (bottom - top) / WORLD_HEIGHT);
    const left = (width - WORLD_WIDTH * scale) / 2;
    const centerY = top + (bottom - top) / 2;
    const toPage = point => {
        const [x, y] = equalEarth(point);
        return [left + (x + WORLD_WIDTH / 2) * scale, centerY - y * scale];
    };
    const stroke = round(Math.max(0.15, width / 1500));

    const lands = countries.map(feature => {
        const status = statusOf(feature.properties.id);
        const fill = status ? colors[status] : colors.land;
        return `<path d="${featurePath(feature.geometry, toPage)}" fill="${fill}"><title>${escapeXml(feature.properties.name)}</title></path>`;
    });
    const dots = cities.map(point => {
        const [x, y] = toPage(point).map(round);
        return `<circle cx="${x}" cy="${y}" r="${round(stroke * 2.4)}" fill="${colors.text}"/>`;
    });
    const legendItems = LEGEND.filter(([status]) => counts[status]);
    const legendSize = titleSize * 0.38;
    const itemWidth = width * 0.17;
    const legendLeft = (width - legendItems.length * itemWidth) / 2;
    const legendY = height - margin - legendSize;
    const legend = legendItems.map(([status, label], i) => {
        const x = round(legendLeft + i * itemWidth);
        return `<rect x="${x}" y="${round(legendY - legendSize * 0.85)}" width="${round(legendSize)}" height="${round(legendSize)}" fill="${colors[status]}" stroke="${colors.border}" stroke-width="${stroke}"/>`
            + `<text x="${round(x + legendSize * 1.5)}" y="${round(legendY)}" font-size="${round(legendSize)}">${escapeXml(`${label} · ${counts[status]}`)}</text>`;
    });

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">`,
        `<title>${escapeXml(title)}</title>`,
        `<rect width="${width}" height="${height}" fill="${colors.background}"/>`,
        `<g fill="${colors.text}" font-family="Fredoka, Nunito, 'Trebuchet MS', sans-serif" text-anchor="middle">`,
        `<text x="${round(width / 2)}" y="${round(margin + titleSize)}" font-size="${round(titleSize)}" font-weight="600">${escapeXml(title)}</text>`,
        subtitle ? `<text x="${round(width / 2)}" y="${round(margin + titleSize * 2)}" font-size="${round(titleSize * 0.5)}">${escapeXml(subtitle)}</text>` : '',
        '</g>',
        `<g stroke="${colors.border}" stroke-width="${stroke}" stroke-linejoin="round">${lands.join('')}</g>`,
        `<g>${dots.join('')}</g>`,
        `<g fill="${colors.text}" font-family="Nunito, 'Trebuchet MS', sans-serif">${legend.join('')}</g>`,
        '</svg>',
        ''
    ].join('\n');
}
