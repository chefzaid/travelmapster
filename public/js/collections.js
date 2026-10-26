// Collections to complete on the passport: the capital of every country, and every member of
// the European Union, each counted on the traveler's country list. Pure, unit tested in Node.

// Member states of the European Union as of 2026, by map code.
export const EU_MEMBERS = Object.freeze([
    'AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU', 'GRC', 'HUN', 'IRL',
    'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD', 'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE'
]);

// A saved city is a capital when it lies in the capital's country, with its name or within
// about 15 km of it.
function isCapital(marker, capital, countryId, normalize) {
    if (countryId !== capital.countryId) return false;
    if (normalize(String(marker.name).split(',')[0]) === normalize(capital.name)) return true;
    return Math.abs(marker.lat - capital.lat) < 0.15 && Math.abs(marker.lng - capital.lng) < 0.15;
}

/**
 * The collections and how far the traveler is in each: `count` of `total`, and what is still
 * `missing` (country ids). A country with several capitals counts once, for any of them.
 * `beenCities` are city places visited or lived in, `countryOf` gives a place's country id.
 */
export function computeCollections({ beenCities, countryOf, visitedIds, countedIds, capitals, normalize }) {
    const capitalCountries = [...new Set(capitals.map(capital => capital.countryId))].filter(id => countedIds.has(id));
    const seenCapitals = new Set();
    for (const marker of beenCities) {
        const countryId = countryOf(marker);
        const capital = capitals.find(item => isCapital(marker, item, countryId, normalize));
        if (capital) seenCapitals.add(capital.countryId);
    }
    const eu = EU_MEMBERS.filter(id => countedIds.has(id));
    const collection = (id, icon, title, ids, done) => ({
        id, icon, title, total: ids.length, count: ids.filter(done).length, missing: ids.filter(item => !done(item))
    });
    return [
        collection('capitals', '🏛️', 'Capitals', capitalCountries, id => seenCapitals.has(id)),
        collection('eu', '🇪🇺', 'European Union', eu, id => visitedIds.has(id))
    ];
}
