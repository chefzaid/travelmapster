// Unit tests for shareable image cards (public/js/share-cards.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'share-cards.js'));

const wellFormed = svg => {
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"'));
    assert.ok(svg.endsWith('</svg>'));
    assert.equal((svg.match(/<text /g) || []).length, (svg.match(/<\/text>/g) || []).length);
};

test('cards show counts and country names only, escaped', async () => {
    const { countryCountCard, stampsCard, yearRecapCard, svgDataUrl } = await load();
    const count = countryCountCard({ username: 'Ana <3', countries: 23, worldPercent: 9.5, shareLabel: 'of the world', continents: 4, rank: 'Explorer' });
    wellFormed(count);
    assert.ok(count.includes('Ana &lt;3&apos;s travel map'));
    assert.ok(count.includes('>23</text>') && count.includes('9.5% of the world') && count.includes('4 continents · Explorer'));
    assert.ok(countryCountCard({ username: 'a', countries: 1, worldPercent: 0.4, shareLabel: 'of the world', continents: 1, rank: 'Day tripper' }).includes('>country</text>'));

    const stamps = Array.from({ length: 50 }, (_, i) => ({ flag: '🇵🇹', name: i ? `Country number ${i}` : 'Portugal' }));
    const passport = stampsCard({ username: 'ana', stamps });
    wellFormed(passport);
    assert.equal(passport.match(/🇵🇹/g).length, 48);
    assert.ok(passport.includes('and 2 more') && passport.includes('ana · 50 countries') && passport.includes('Country numbe…'));
    assert.ok(!stampsCard({ username: 'ana', stamps: stamps.slice(0, 3) }).includes('more'));

    const recap = yearRecapCard({ username: 'ana', year: 2026, countries: 5, newCountries: 2, trips: 7, daysAway: 41, longestTrip: '12 days, Lisbon → Porto', awayWord: 'abroad' });
    wellFormed(recap);
    for (const part of ['2026 in travel', '5 countries', '2 new', '7 trips', '41 days', 'abroad', 'Longest trip: 12 days, Lisbon → Porto']) assert.ok(recap.includes(part), part);
    const long = yearRecapCard({ username: 'a', year: 2026, countries: 1, newCountries: 1, trips: 1, daysAway: 1, longestTrip: `20 days, ${'Somewhere → '.repeat(10)}`, awayWord: 'abroad' });
    assert.match(long, />Longest trip: [^<]{30,44}…</);
    assert.ok(yearRecapCard({ username: 'a', year: 2020, countries: 1, newCountries: 0, trips: 1, daysAway: 1, longestTrip: '', awayWord: 'recorded' }).includes('no new ones'));

    assert.ok(svgDataUrl('<svg>é</svg>').startsWith('data:image/svg+xml;charset=utf-8,%3Csvg%3E%C3%A9'));
});

test('the flags line lists each country\'s flag and the count', async () => {
    const { flagLine } = await load();
    assert.equal(flagLine([{ flag: '🇫🇷', name: 'France' }, { flag: '🇯🇵', name: 'Japan' }, { flag: '🇲🇦', name: 'Morocco' }]), '🇫🇷🇯🇵🇲🇦 3 countries');
    assert.equal(flagLine([{ flag: '🇵🇹', name: 'Portugal' }]), '🇵🇹 1 country');
    assert.equal(flagLine([{ flag: '', name: 'Somewhere' }, { flag: '🇪🇸', name: 'Spain' }]), '🇪🇸 2 countries', 'a territory without a flag still counts');
});

test('the countdown card shows the days to go and the flags, never the trip\'s title or dates', async () => {
    const { countdownCard } = await load();
    const card = countdownCard({ username: 'Ana', days: 12, underWay: false, flags: ['🇵🇹', '🇪🇸'] });
    wellFormed(card);
    assert.ok(card.includes('Ana&apos;s next trip') && card.includes('>12</text>') && card.includes('>days to go</text>') && card.includes('🇵🇹🇪🇸'));
    assert.ok(countdownCard({ username: 'Ana', days: 1, underWay: false, flags: [] }).includes('>day to go</text>'));
    assert.ok(countdownCard({ username: 'Ana', days: 0, underWay: false, flags: [] }).includes('Leaving today!'));
    assert.ok(countdownCard({ username: 'Ana', days: 0, underWay: true, flags: [] }).includes('On the road!'));
});
