'use strict';

// Packing list templates (public/js/packing-templates.js) and their validation on the account
// (src/trip-validation.js): ready-made ones, saving a trip's list, replacing and removing.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parsePackingTemplates } = require('../src/trip-validation');
const { parseProfile } = require('../src/validation');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'packing-templates.js'));

test('the ready-made templates come first, then the traveler\'s own, each with a unique key', async () => {
    const { packingTemplates } = await load();
    const all = packingTemplates([{ name: 'Weekend', items: ['Book'] }]);
    assert.deepEqual(all.map(template => template.key), ['basics', 'beach', 'city', 'business', 'ski', 'own:Weekend']);
    assert.ok(all.slice(0, 5).every(template => !template.own && template.items.length >= 6));
    assert.deepEqual(all.at(-1), { key: 'own:Weekend', name: 'Weekend', items: ['Book'], own: true });
    assert.equal(packingTemplates().length, 5);
    // Every ready-made template is one the account accepts.
    assert.ok(parsePackingTemplates(all.slice(0, 5).map(({ name, items }) => ({ name, items }))).templates);
});

test('a template keeps each item of the list once, without what was ticked off', async () => {
    const { templateFrom, TEMPLATE_NAME_MAX } = await load();
    const packing = [{ item: 'Hat', packed: true }, { item: 'hat', packed: false }, { item: 'Socks', packed: false }];
    assert.deepEqual(templateFrom('  Ski week ', packing), { name: 'Ski week', items: ['Hat', 'Socks'] });
    assert.equal(templateFrom('x'.repeat(60)).name.length, TEMPLATE_NAME_MAX);
    assert.deepEqual(templateFrom('Empty').items, []);
});

test('saving a template of a known name replaces it, and a full list takes no new one', async () => {
    const { withTemplate, withoutTemplate, TEMPLATES_MAX } = await load();
    const saved = [{ name: 'Beach week', items: ['Towel'] }];
    assert.deepEqual(withTemplate(saved, { name: 'beach WEEK', items: ['Fins'] }), { templates: [{ name: 'beach WEEK', items: ['Fins'] }], replaced: true });
    assert.deepEqual(withTemplate(saved, { name: 'City', items: ['Map'] }), { templates: [...saved, { name: 'City', items: ['Map'] }], replaced: false });
    assert.deepEqual(withTemplate(undefined, { name: 'City', items: ['Map'] }).templates, [{ name: 'City', items: ['Map'] }]);
    const full = Array.from({ length: TEMPLATES_MAX }, (_, i) => ({ name: `T${i}`, items: ['x'] }));
    assert.equal(withTemplate(full, { name: 'New', items: ['x'] }), null);
    assert.equal(withTemplate(full, { name: 't3', items: ['y'] }).replaced, true);
    assert.deepEqual(withoutTemplate(saved, 'BEACH week'), []);
    assert.deepEqual(withoutTemplate(undefined, 'x'), []);
});

test('the account accepts named templates of 1 to 200 items, each name once', () => {
    assert.deepEqual(parsePackingTemplates([{ name: ' Ski ', items: [' Gloves ', 'Goggles'] }]), { templates: [{ name: 'Ski', items: ['Gloves', 'Goggles'] }] });
    assert.deepEqual(parsePackingTemplates([]), { templates: [] });
    for (const bad of [
        'nope', Array.from({ length: 21 }, (_, i) => ({ name: `T${i}`, items: ['x'] })),
        [null], [{ name: '', items: ['x'] }], [{ name: 'x'.repeat(41), items: ['x'] }], [{ name: 'A', items: [] }],
        [{ name: 'A', items: 'x' }], [{ name: 'A', items: ['x'.repeat(81)] }], [{ name: 'A', items: [3] }],
        [{ name: 'A', items: Array.from({ length: 201 }, () => 'x') }]
    ]) assert.ok(parsePackingTemplates(bad).error, JSON.stringify(bad).slice(0, 80));
    assert.equal(parsePackingTemplates([{ name: 'A', items: ['x'] }, { name: 'a', items: ['y'] }]).error, 'Give each packing list template its own name.');
    assert.deepEqual(parseProfile({ packingTemplates: [{ name: 'A', items: ['x'] }] }), { profile: { packingTemplates: [{ name: 'A', items: ['x'] }] } });
    assert.ok(parseProfile({ packingTemplates: 'x' }).error);
});
