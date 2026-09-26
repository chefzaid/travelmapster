// Pure geography and statistics helpers. No DOM or Leaflet access, so they can be unit tested in Node.

export const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'];

export const CONTINENT_EMOJI = {
    Africa: '🦁',
    Asia: '🏯',
    Europe: '🏰',
    'North America': '🗽',
    Oceania: '🏝️',
    'South America': '🦜'
};

// Common names people type that Natural Earth spells differently.
const EXTRA_ALIASES = {
    USA: ['usa', 'us', 'united states', 'america'],
    GBR: ['uk', 'great britain', 'britain', 'england', 'scotland', 'wales'],
    CZE: ['czech republic'],
    CIV: ['ivory coast', "cote d'ivoire"],
    COD: ['dr congo', 'drc', 'congo kinshasa', 'democratic republic of the congo'],
    COG: ['republic of the congo', 'congo brazzaville'],
    KOR: ['south korea', 'korea'],
    PRK: ['north korea'],
    RUS: ['russia'],
    MMR: ['burma'],
    SWZ: ['swaziland'],
    MKD: ['macedonia'],
    NLD: ['holland'],
    ARE: ['uae', 'emirates'],
    TLS: ['east timor'],
    BIH: ['bosnia'],
    TZA: ['tanzania'],
    SRB: ['republic of serbia'],
    GNB: ['guinea bissau'],
    BHS: ['the bahamas', 'bahamas'],
    CYN: ['northern cyprus'],
    PSX: ['palestine', 'west bank'],
    FLK: ['falkland islands'],
    ATF: ['french southern and antarctic lands'],
    SAH: ['western sahara'],
    VAT: ['vatican city', 'holy see'],
    CPV: ['cape verde'],
    TUR: ['turkey', 'turkiye']
};

export function normalizeName(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[.'’]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

export function flagEmoji(iso2) {
    if (!/^[A-Z]{2}$/.test(iso2 || '')) return '🏳️';
    return String.fromCodePoint(...[...iso2].map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

function ringsOf(geometry) {
    if (!geometry) return [];
    return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

function computeBounds(geometry) {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const polygon of ringsOf(geometry)) {
        for (const [lng, lat] of polygon[0] || []) {
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
        }
    }
    return [minLng, minLat, maxLng, maxLat];
}

// Bounds of the polygon holding the label point, so France frames Europe rather than French Guiana too.
function computeMainBounds(geometry, label) {
    const polygons = ringsOf(geometry);
    const [lat, lng] = label || [];
    const main = polygons.find(([outer]) => outer && pointInRing(lng, lat, outer))
        || polygons.reduce((best, polygon) => (polygon[0]?.length || 0) > (best?.[0]?.length || 0) ? polygon : best, null);
    return main ? computeBounds({ type: 'Polygon', coordinates: main }) : computeBounds(geometry);
}

function pointInRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

export function geometryContains(geometry, lat, lng) {
    return ringsOf(geometry).some(([outer, ...holes]) =>
        outer && pointInRing(lng, lat, outer) && !holes.some(hole => pointInRing(lng, lat, hole))
    );
}

export function createCountryIndex(geojson) {
    const byId = new Map();
    const byName = new Map();
    const countries = [];

    for (const feature of geojson.features) {
        const p = feature.properties;
        const country = {
            id: p.id,
            name: p.name,
            iso2: p.iso2,
            flag: flagEmoji(p.iso2),
            continent: p.continent,
            subregion: p.subregion,
            population: p.population,
            color: p.color,
            labelZoom: p.labelZoom,
            label: p.label,
            bounds: computeBounds(feature.geometry),
            mainBounds: computeMainBounds(feature.geometry, p.label),
            feature
        };
        countries.push(country);
        byId.set(country.id, country);
        const names = [p.name, ...(p.aliases || []), ...(EXTRA_ALIASES[p.id] || [])];
        for (const name of names) {
            const key = normalizeName(name);
            if (key && !byName.has(key)) byName.set(key, country);
        }
    }

    function findByName(name) {
        const key = normalizeName(name);
        if (!key) return null;
        return byName.get(key) || byName.get(key.replace(/^the /, '')) || null;
    }

    function findAt(lat, lng) {
        const matches = countries.filter(({ bounds: [minLng, minLat, maxLng, maxLat] }) =>
            lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat
        );
        return matches.find(country => geometryContains(country.feature.geometry, lat, lng)) || null;
    }

    function search(query, limit = 8) {
        const key = normalizeName(query);
        if (!key) return [];
        const scored = [];
        for (const country of countries) {
            const name = normalizeName(country.name);
            let score = -1;
            if (name === key) score = 0;
            else if (name.startsWith(key)) score = 1;
            else if (name.includes(` ${key}`)) score = 2;
            else if (findByName(query) === country) score = 1;
            if (score >= 0) scored.push({ country, score });
        }
        return scored
            .sort((a, b) => a.score - b.score || a.country.name.localeCompare(b.country.name))
            .slice(0, limit)
            .map(({ country }) => country);
    }

    return { countries, byId, findByName, findAt, search };
}

// Works out which country a saved marker belongs to.
export function resolveMarkerCountry(index, marker) {
    if (marker.category === 'Country') {
        return index.findByName(marker.name) || index.findAt(Number(marker.lat), Number(marker.lng));
    }
    const located = index.findAt(Number(marker.lat), Number(marker.lng));
    if (located) return located;
    const suffix = String(marker.name || '').split(',').pop();
    return index.findByName(suffix);
}

export function searchCities(cities, query, limit = 8) {
    const key = normalizeName(query);
    if (!key) return [];
    const [cityPart, countryPart] = key.split(/\s*,\s*|\s+in\s+/);
    return cities
        .map(city => {
            const name = normalizeName(city.name);
            let score = -1;
            if (name === cityPart) score = 0;
            else if (name.startsWith(cityPart)) score = 1;
            else if (name.includes(cityPart)) score = 3;
            if (score >= 0 && countryPart && !normalizeName(city.country).startsWith(countryPart)) score = -1;
            return { city, score };
        })
        .filter(({ score }) => score >= 0)
        .sort((a, b) => a.score - b.score || b.city.population - a.city.population)
        .slice(0, limit)
        .map(({ city }) => city);
}

export const ACHIEVEMENTS = [
    { id: 'first-stamp', icon: '🛂', title: 'First stamp', description: 'Visit your first country', test: s => s.visitedCountries >= 1 },
    { id: 'explorer', icon: '🧭', title: 'Explorer', description: 'Visit 5 countries', test: s => s.visitedCountries >= 5 },
    { id: 'globetrotter', icon: '🌍', title: 'Globetrotter', description: 'Visit 15 countries', test: s => s.visitedCountries >= 15 },
    { id: 'world-citizen', icon: '🏅', title: 'World citizen', description: 'Visit 30 countries', test: s => s.visitedCountries >= 30 },
    { id: 'legend', icon: '👑', title: 'Legend', description: 'Visit 50 countries', test: s => s.visitedCountries >= 50 },
    { id: 'continent-hopper', icon: '✈️', title: 'Continent hopper', description: 'Visit 3 continents', test: s => s.visitedContinents >= 3 },
    { id: 'six-for-six', icon: '🌐', title: 'Six for six', description: 'Visit every inhabited continent', test: s => s.visitedContinents >= CONTINENTS.length },
    { id: 'city-slicker', icon: '🏙️', title: 'City slicker', description: 'Visit 10 cities', test: s => s.visitedCities >= 10 },
    { id: 'dreamer', icon: '💭', title: 'Dreamer', description: 'Add 10 places to your wishlist', test: s => s.wishlistPlaces >= 10 },
    { id: 'storyteller', icon: '📝', title: 'Storyteller', description: 'Write notes on 5 places', test: s => s.placesWithNotes >= 5 },
    { id: 'shutterbug', icon: '📸', title: 'Shutterbug', description: 'Add photos to 5 places', test: s => s.placesWithPhotos >= 5 },
    { id: 'planner', icon: '🗓️', title: 'Planner', description: 'Plan your first trip', test: s => s.trips >= 1 }
];

const RANKS = [
    { min: 0, title: 'Armchair traveler' },
    { min: 1, title: 'Day tripper' },
    { min: 5, title: 'Wanderer' },
    { min: 15, title: 'Explorer' },
    { min: 30, title: 'Globetrotter' },
    { min: 50, title: 'Legend of the map' }
];

export function rankFor(visitedCountries) {
    return RANKS.filter(rank => visitedCountries >= rank.min).pop();
}

export function nextRankFor(visitedCountries) {
    return RANKS.find(rank => rank.min > visitedCountries) || null;
}

export function computeStats(markers, index, { trips = 0 } = {}) {
    const visited = new Set();
    const wishlist = new Set();
    const cityCountries = new Set();
    const markerCountry = new Map();

    for (const marker of markers) {
        const country = resolveMarkerCountry(index, marker);
        markerCountry.set(marker.id, country);
        if (!country) continue;
        if (marker.type === 'visited') {
            visited.add(country.id);
            if (marker.category === 'City') cityCountries.add(country.id);
        } else {
            wishlist.add(country.id);
        }
    }
    for (const id of visited) wishlist.delete(id);

    const continents = CONTINENTS.map(name => {
        const total = index.countries.filter(country => country.continent === name).length;
        const count = [...visited].filter(id => index.byId.get(id)?.continent === name).length;
        return { name, emoji: CONTINENT_EMOJI[name], total, visited: count, percent: total ? Math.round((count / total) * 100) : 0 };
    });

    const years = new Map();
    for (const marker of markers) {
        if (marker.type !== 'visited' || !marker.travelDate) continue;
        const year = marker.travelDate.slice(0, 4);
        years.set(year, (years.get(year) || 0) + 1);
    }

    const stats = {
        visitedCountries: visited.size,
        wishlistCountries: wishlist.size,
        visitedCities: new Set(markers.filter(m => m.type === 'visited' && m.category === 'City').map(m => m.name)).size,
        wishlistPlaces: markers.filter(m => m.type === 'wishlist').length,
        totalPlaces: markers.length,
        placesWithNotes: markers.filter(m => m.notes).length,
        placesWithPhotos: markers.filter(m => m.photoUrl).length,
        visitedContinents: continents.filter(c => c.visited > 0).length,
        worldPercent: index.countries.length ? Math.round((visited.size / index.countries.length) * 1000) / 10 : 0,
        totalCountries: index.countries.length,
        trips,
        continents,
        years: [...years.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, count]) => ({ year, count })),
        visitedIds: visited,
        wishlistIds: wishlist,
        cityOnlyIds: cityCountries,
        markerCountry
    };
    stats.rank = rankFor(stats.visitedCountries);
    stats.nextRank = nextRankFor(stats.visitedCountries);
    stats.achievements = ACHIEVEMENTS.map(({ test, ...achievement }) => ({ ...achievement, unlocked: test(stats) }));
    return stats;
}

export function formatPopulation(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 'Unknown';
    if (number >= 1e9) return `${(number / 1e9).toFixed(1)} billion`;
    if (number >= 1e6) return `${(number / 1e6).toFixed(1)} million`;
    if (number >= 1e3) return `${Math.round(number / 1e3)} thousand`;
    return String(number);
}
