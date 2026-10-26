// Unit tests for the map's timeline, journey lines and palettes (ADR 0016): pure browser
// modules, and the palette tokens in css/tokens.css checked for contrast and colour-blind safety.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const load = file => import(path.join(publicDir, 'js', file));

const TODAY = '2026-10-23';
const place = (id, name, category, type, visits, extra = {}) => ({ id, name, category, type, lat: 0, lng: 0, visits, ...extra });
const visit = (startDate, endDate = '', ongoing = false) => ({ startDate, endDate, ongoing });

test('the timeline shows places by the end of a year or visited during it, leaving out undated places and wishes', async () => {
    const { placesInYear, timelineYears, visitInYear } = await load('timeline.js');
    const markers = [
        place(1, 'Lisbon, Portugal', 'City', 'visited', [visit('2019-05-01', '2019-05-05'), visit('2023-02-01', '2023-02-03')]),
        place(2, 'Germany', 'Country', 'visited', [visit('2015-01-01', '2018-06-30')], { stay: 'lived' }),
        place(3, 'Italy', 'Country', 'visited', []),
        place(4, 'Peru', 'Country', 'wishlist', [visit('2010-03-01', '2010-03-04')]),
        place(5, 'Dubai, United Arab Emirates', 'City', 'visited', [visit('2021-12-31', '2022-01-01')], { stay: 'transit' }),
        place(6, 'Tokyo, Japan', 'City', 'visited', [visit('2025-11-20', '', true)]),
        place(7, 'Oslo, Norway', 'City', 'visited', [visit('2028-06-01', '2028-06-03')])
    ];

    assert.deepEqual(timelineYears(markers, TODAY), { first: 2015, last: 2028, latest: 2025 }, 'wishes have no history; a planned visit extends the range');
    assert.equal(timelineYears([markers[2], markers[3]], TODAY), null, 'nothing dated');

    const by2019 = placesInYear(markers, { year: 2019, mode: 'by', today: TODAY });
    assert.deepEqual(by2019.markers.map(m => m.id), [1, 2], 'lived in by then, and Lisbon');
    assert.equal(by2019.undated, 1, 'Italy has no dates');
    assert.deepEqual(by2019.markers[0].visits.map(v => v.startDate), ['2019-05-01'], 'only the visits made by then');
    assert.equal(markers[0].visits.length, 2, 'the places themselves are left alone');

    const during2018 = placesInYear(markers, { year: 2018, mode: 'during', today: TODAY });
    assert.deepEqual(during2018.markers.map(m => m.id), [2], 'a stay overlapping the year counts');
    assert.deepEqual(placesInYear(markers, { year: 2019, mode: 'during', today: TODAY }).markers.map(m => m.id), [1]);
    assert.deepEqual(placesInYear(markers, { year: 2022, mode: 'during', today: TODAY }).markers.map(m => m.id), [5], 'over New Year');
    assert.deepEqual(placesInYear(markers, { year: 2026, mode: 'during', today: TODAY }).markers.map(m => m.id), [6], 'still there counts through today');

    assert.equal(visitInYear(visit('2025-11-20', '', true), 2027, 'during', TODAY), false, 'not past today');
    assert.equal(visitInYear(visit('2025-11-20'), 2026, 'during', TODAY), false, 'an unrecorded end is the first day only');
    assert.equal(visitInYear(visit('2025-11-20'), 2026, 'by', TODAY), true);
    // Older data without visits falls back to the single travel date.
    assert.deepEqual(placesInYear([{ id: 9, type: 'visited', travelDate: '2001-02-03' }], { year: 2001, today: TODAY }).markers[0].visits,
        [{ startDate: '2001-02-03' }]);
});

test('journey stops follow visits in order, at the city or the country label point', async () => {
    const { journeyStops, journeyLegs, groupTrips, routeLabel } = await load('journeys.js');
    const countries = {
        PRT: { id: 'PRT', label: [39.6, -8] },
        ESP: { id: 'ESP', label: [40.2, -3.6] },
        JPN: { id: 'JPN', label: [36.2, 138.2] },
        ARE: { id: 'ARE', label: [23.9, 54.2] }
    };
    const owner = { 1: 'PRT', 2: 'ESP', 3: 'ESP', 4: 'JPN', 5: 'ARE', 6: 'PRT' };
    const countryOf = marker => countries[owner[marker.id]];
    const markers = [
        { ...place(1, 'Lisbon, Portugal', 'City', 'visited', [visit('2023-05-01', '2023-05-04'), visit('2023-05-05', '2023-05-06')]), lat: 38.7, lng: -9.1 },
        // A country visit during a city visit in that country adds no stop.
        place(2, 'Spain', 'Country', 'visited', [visit('2023-05-08', '2023-05-12'), visit('2024-08-01', '2024-08-03')], { lat: 1, lng: 1 }),
        { ...place(3, 'Madrid, Spain', 'City', 'visited', [visit('2023-05-09', '2023-05-12')]), lat: 40.4, lng: -3.7 },
        place(4, 'Japan', 'Country', 'visited', [visit('2023-06-02', '2023-06-10')]),
        // A same-day layover on the way comes before the stay that starts that day.
        { ...place(5, 'Dubai, United Arab Emirates', 'City', 'visited', [visit('2023-06-02')], { stay: 'transit' }), lat: 25.2, lng: 55.3 },
        { ...place(6, 'Porto, Portugal', 'City', 'wishlist', [visit('2025-01-01', '', true)]), lat: 41.1, lng: -8.6 }
    ];
    const stops = journeyStops(markers, { countryOf, today: TODAY });
    assert.deepEqual(stops.map(stop => stop.name), ['Lisbon', 'Madrid', 'Dubai', 'Japan', 'Spain', 'Porto']);
    assert.equal(stops[0].endDate, '2023-05-06', 'back-to-back visits to one place are one stop');
    assert.deepEqual([stops[3].lat, stops[3].lng], [36.2, 138.2], 'a country visit is drawn at its label');
    assert.deepEqual([stops[4].lat, stops[4].lng], [40.2, -3.6]);
    assert.equal(stops[5].endDate, TODAY, 'a stay still going on lasts until today');

    assert.equal(journeyLegs(stops).length, 5);
    assert.equal(journeyLegs([stops[0], { ...stops[0], markerId: 99 }]).length, 0, 'no leg from a point to itself');

    const trips = groupTrips(stops);
    assert.deepEqual(trips.map(trip => routeLabel(trip.stops)), ['Lisbon → Madrid', 'Dubai → Japan']);
    assert.deepEqual([trips[0].startDate, trips[0].endDate], ['2023-05-01', '2023-05-12']);
    assert.equal(groupTrips(stops, 30).length, 1, 'a wider gap joins the trips');
    assert.equal(routeLabel(['A', 'B', 'B', 'C', 'D', 'E', 'F'].map(name => ({ name }))), 'A → B → C → … → F');
    assert.equal(journeyStops([place(7, 'Nowhere', 'City', 'visited', [visit('2020-01-01')], { lat: 'x' })], { countryOf: () => null, today: TODAY }).length, 0);

    // A return to the same place months later is a new stop, so it starts a trip of its own.
    const returns = journeyStops([
        { ...place(8, 'Paris, France', 'City', 'visited', [visit('2023-01-02', '2023-01-05'), visit('2023-12-01', '2023-12-05')]), lat: 48.9, lng: 2.4 },
        { ...place(9, 'Lyon, France', 'City', 'visited', [visit('2023-12-07', '2023-12-08')]), lat: 45.8, lng: 4.8 }
    ], { countryOf: () => null, today: TODAY });
    assert.deepEqual(returns.map(stop => [stop.name, stop.startDate, stop.endDate]), [
        ['Paris', '2023-01-02', '2023-01-05'], ['Paris', '2023-12-01', '2023-12-05'], ['Lyon', '2023-12-07', '2023-12-08']
    ]);
    assert.equal(journeyLegs(returns).length, 1, 'no leg from a place to itself');
    assert.deepEqual(groupTrips(returns).map(trip => [trip.startDate, routeLabel(trip.stops)]), [['2023-12-01', 'Paris → Lyon']]);
});

test('journey arcs bend to the left of the way traveled, from stop to stop', async () => {
    const { journeyArc } = await load('journeys.js');
    const there = journeyArc({ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, 4);
    assert.equal(there.length, 5);
    assert.deepEqual(there[0], [0, 0]);
    assert.deepEqual(there[4], [10, 0]);
    assert.ok(there[2][1] > 0, 'eastward arcs bulge north');
    const back = journeyArc({ lat: 0, lng: 10 }, { lat: 0, lng: 0 }, 4);
    assert.ok(back[2][1] < 0, 'the way back draws its own arc');
    const polar = journeyArc({ lat: 80, lng: -170 }, { lat: 80, lng: 170 }, 8);
    assert.ok(polar.every(([, lat]) => lat <= 85 && lat >= -85), 'arcs stay on the map');
});

test('palette ids fall back to the standard palette', async () => {
    const { PALETTES, paletteId } = await load('palettes.js');
    assert.deepEqual(PALETTES.map(palette => palette.id), ['standard', 'colorblind', 'print']);
    assert.equal(paletteId('colorblind'), 'colorblind');
    assert.equal(paletteId('neon'), 'standard');
    assert.equal(paletteId(undefined), 'standard');
});

// ---- palette tokens in css/tokens.css

// The custom properties set by each rule, with the media query around it.
function cssRules(css) {
    const rules = [];
    const stack = [];
    let prelude = '';
    for (const char of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
        if (char === '{') {
            stack.push(prelude.trim());
            prelude = '';
        } else if (char === '}') {
            const selector = stack.pop();
            if (prelude.includes(':')) rules.push({ selector, media: stack.join(' '), body: prelude });
            prelude = '';
        } else {
            prelude += char;
        }
    }
    return rules.map(({ selector, media, body }) => ({
        selector, media,
        tokens: Object.fromEntries(body.split(';').map(line => line.trim().match(/^(--[\w-]+)\s*:\s*(.+)$/)).filter(Boolean).map(([, name, value]) => [name, value.trim()]))
    }));
}

const css = fs.readFileSync(path.join(publicDir, 'css', 'tokens.css'), 'utf8');
const rules = cssRules(css);
const DARK = '@media (prefers-color-scheme: dark)';

// The tokens in effect for a palette and colour scheme, in cascade order (specificity first).
function tokensFor(palette, scheme) {
    const applies = rule => (rule.media === '' || (scheme === 'dark' && rule.media === DARK));
    const selectors = rule => rule.selector.split(',').map(part => part.trim());
    const tokens = {};
    for (const rule of rules.filter(rule => applies(rule) && selectors(rule).includes(':root'))) Object.assign(tokens, rule.tokens);
    const own = `:root[data-palette='${palette}']`;
    for (const rule of rules.filter(rule => applies(rule) && selectors(rule).includes(own))) Object.assign(tokens, rule.tokens);
    return tokens;
}

const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const luminance = rgb => {
    const [r, g, b] = rgb.map(linear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
    const [high, low] = [luminance(channels(a)), luminance(channels(b))].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
};
// Colour-vision deficiency simulation (Machado, Oliveira and Fernandes 2009, full severity).
const DEFICIENCIES = {
    protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]
};
const clamp = value => Math.min(1, Math.max(0, value));
function seenAs(hex, vision) {
    const rgb = channels(hex);
    if (vision === 'normal') return rgb;
    if (vision === 'grayscale') return Array(3).fill(gamma(luminance(rgb)));
    const lin = rgb.map(linear);
    return DEFICIENCIES[vision].map(row => gamma(clamp(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])));
}
function lab(rgb) {
    const [r, g, b] = rgb.map(linear);
    const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
// CIE76 colour difference as seen with a given vision.
const difference = (a, b, vision) => {
    const [p, q] = [lab(seenAs(a, vision)), lab(seenAs(b, vision))];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

const STATUS_FILLS = { visited: '--visited', cityOnly: '--visited-soft', wishlist: '--wishlist', lived: '--lived', home: '--home', transit: '--transit' };
const OUTLINES = [['--visited-ink', '--visited'], ['--visited-ink', '--visited-soft'], ['--wishlist-ink', '--wishlist'],
    ['--lived-ink', '--lived'], ['--home-ink', '--home'], ['--transit-ink', '--transit']];
const LAND = [1, 2, 3, 4, 5, 6, 7].map(n => `--land-${n}`);
const SCHEMES = ['light', 'dark'];

test('every palette keeps map labels and chips at WCAG AA contrast in both themes', () => {
    for (const palette of ['standard', 'colorblind', 'print']) {
        for (const scheme of SCHEMES) {
            const tokens = tokensFor(palette, scheme);
            const where = `${palette} ${scheme}`;
            // Country and town names, and chip and button text, are --ink-dark on these fills.
            const backgrounds = [...Object.values(STATUS_FILLS), '--lived-soft', '--home-soft', '--transit-soft', ...LAND];
            for (const name of backgrounds) {
                assert.ok(contrast(tokens['--ink-dark'], tokens[name]) >= 4.5, `${where}: labels on ${name}`);
            }
            // The outlines added for home, lived there and transit only stay visible on their fill (ADR 0014).
            for (const [ink, fill] of OUTLINES.slice(3)) assert.ok(contrast(tokens[ink], tokens[fill]) >= 3, `${where}: ${ink} on ${fill}`);
            assert.ok(contrast(tokens['--journey'], tokens['--journey-casing']) >= 3, `${where}: journey line on its casing`);
        }
    }
});

test('the color-blind safe and print palettes keep every status apart for every kind of color vision', () => {
    for (const palette of ['colorblind', 'print']) {
        for (const scheme of SCHEMES) {
            const tokens = tokensFor(palette, scheme);
            const where = `${palette} ${scheme}`;
            for (const [ink, fill] of OUTLINES) assert.ok(contrast(tokens[ink], tokens[fill]) >= 3, `${where}: ${ink} on ${fill}`);
            const fills = Object.entries(STATUS_FILLS);
            for (const vision of ['normal', 'protanopia', 'deuteranopia', 'tritanopia']) {
                fills.forEach(([a, aToken], i) => {
                    for (const [b, bToken] of fills.slice(i + 1)) {
                        assert.ok(difference(tokens[aToken], tokens[bToken], vision) >= 10, `${where}, ${vision}: ${a} and ${b}`);
                    }
                    for (const land of LAND) {
                        assert.ok(difference(tokens[aToken], tokens[land], vision) >= 10, `${where}, ${vision}: ${a} and ${land}`);
                    }
                });
            }
        }
    }
    // On a grayscale printer, visited countries and those seen through a city share an outline,
    // so their lightness tells them apart; every status also stands out from the paper-white land.
    const print = tokensFor('print', 'light');
    assert.ok(difference(print['--visited'], print['--visited-soft'], 'grayscale') >= 10);
    for (const [status, token] of Object.entries(STATUS_FILLS)) {
        for (const land of LAND) assert.ok(difference(print[token], print[land], 'grayscale') >= 8, `grayscale: ${status} and ${land}`);
    }
    assert.equal(print['--ocean'], '#ffffff', 'no ink spent on the sea');
    assert.deepEqual(tokensFor('print', 'dark')['--land-1'], print['--land-1'], 'the print palette stays paper-white in the dark theme');
});
