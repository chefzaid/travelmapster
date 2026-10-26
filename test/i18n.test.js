'use strict';

// Translations (ADR 0031): public/js/i18n.js, the catalogs in public/locales against every key
// in the code and the pages (scripts/i18n.js), and countries named in each language.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LOCALES, checkCatalog, collect } = require('../scripts/i18n.js');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));

test('texts fall back to English and fill their placeholders', async () => {
    const { t, tn, tk, tParts, useCatalog, locale, isRtl } = await load('i18n.js');
    useCatalog('en');
    assert.equal(t('Removed {name}.', { name: 'Lisbon' }), 'Removed Lisbon.');
    assert.equal(t('Hello {who}'), 'Hello {who}', 'a missing value stays visible');
    assert.equal(tn(1, '{count} day', '{count} days'), '1 day');
    assert.equal(tn(1200, '{count} day', '{count} days'), '1,200 days');
    assert.equal(tk('Wishlist'), 'Wishlist');

    useCatalog('fr', {
        'Removed {name}.': '{name} supprimé.',
        '{count} days': { one: '{count} jour', many: '{count} de jours', other: '{count} jours' },
        'Used {days} so far': 'Déjà {days}',
        'Empty translation': ''
    });
    assert.equal(locale(), 'fr');
    assert.equal(isRtl(), false);
    assert.equal(t('Removed {name}.', { name: 'Lisbonne' }), 'Lisbonne supprimé.');
    assert.equal(t('Empty translation'), 'Empty translation', 'an empty entry falls back to English');
    assert.equal(tn(0, '{count} day', '{count} days'), '0 jour', 'French counts zero as singular');
    assert.equal(tn(5, '{count} day', '{count} days'), '5 jours');
    assert.equal(tn(1_000_000, '{count} day', '{count} days'), '1 000 000 de jours');
    assert.equal(tn(2, '{count} night', '{count} nights'), '2 nights', 'no entry: English plural');
    assert.deepEqual(tParts('Used {days} so far', { days: 12 }), ['Déjà ', 12]);

    useCatalog('ar', { '{count} days': { zero: 'لا أيام', one: 'يوم واحد', two: 'يومان', few: '{count} أيام', many: '{count} يومًا', other: '{count} يوم' } });
    assert.equal(isRtl(), true);
    assert.deepEqual([0, 1, 2, 3, 11, 100].map(count => tn(count, '{count} day', '{count} days')),
        ['لا أيام', 'يوم واحد', 'يومان', `${(3).toLocaleString('ar')} أيام`, `${(11).toLocaleString('ar')} يومًا`, `${(100).toLocaleString('ar')} يوم`]);
    useCatalog('xx', { a: 'b' });
    assert.equal(locale(), 'en', 'an unknown language is English');
    assert.equal(t('a'), 'a');
});

test('the browser\'s languages pick the closest one the app speaks', async () => {
    const { matchLocale } = await load('i18n.js');
    assert.equal(matchLocale(['fr-CA', 'en']), 'fr');
    assert.equal(matchLocale(['pt-BR', 'es-MX']), 'es');
    assert.equal(matchLocale(['AR']), 'ar');
    assert.equal(matchLocale(['ja']), 'en');
    assert.equal(matchLocale([]), 'en');
});

test('every catalog translates every key of the code and the pages, with the same placeholders', () => {
    const { keys, problems } = collect();
    assert.deepEqual(problems, []);
    assert.ok(keys.size > 1000, 'keys were found');
    for (const locale of LOCALES) {
        const { missing, stale, broken } = checkCatalog(locale, keys);
        assert.deepEqual({ missing: missing.slice(0, 5), stale: stale.slice(0, 5), broken: broken.slice(0, 5) }, { missing: [], stale: [], broken: [] }, locale);
    }
    const plurals = [...keys].filter(([, info]) => info.plural).map(([key]) => key);
    for (const locale of LOCALES) {
        const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'locales', `${locale}.json`), 'utf8'));
        const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
        for (const key of plurals) {
            for (const category of categories) assert.ok(catalog[key][category], `${locale}: "${key}" has its ${category} form`);
        }
    }
});

test('countries are named in the interface\'s language and found by any of their names', async () => {
    const { createCountryIndex } = await load('geo.js');
    const geojson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'countries.geojson'), 'utf8'));
    const english = createCountryIndex(geojson);
    const german = createCountryIndex(geojson, { locale: 'de' });
    assert.equal(english.byId.get('DEU').name, 'Germany');
    assert.equal(german.byId.get('DEU').name, 'Deutschland');
    assert.equal(german.byId.get('DEU').englishName, 'Germany');
    for (const name of ['Germany', 'Deutschland', 'Allemagne', 'Alemania', 'ألمانيا']) {
        assert.equal(english.findByName(name)?.id, 'DEU', name);
        assert.equal(german.findByName(name)?.id, 'DEU', name);
    }
    assert.equal(createCountryIndex(geojson, { locale: 'fr' }).byId.get('USA').name, 'États-Unis');
    for (const feature of geojson.features) {
        for (const locale of LOCALES) assert.ok(feature.properties.names?.[locale], `${feature.properties.id} has a ${locale} name`);
    }
});
