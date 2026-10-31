'use strict';

// Rule templates (public/js/rule-templates.js): each one, as the dialog starts from it, is a rule
// the ledger and the API accept, with an official source.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseLedgerSettings } = require('../src/validation');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));

test('every template becomes a valid rule of its kind, with its source', async () => {
    const { RULE_TEMPLATES, templatesOf, templateDraft } = await load('rule-templates.js');
    const { checkRule, newId } = await load('ledger-rules.js');
    assert.equal(new Set(RULE_TEMPLATES.map(template => template.id)).size, RULE_TEMPLATES.length);
    assert.deepEqual([...templatesOf('stay'), ...templatesOf('threshold')].length, RULE_TEMPLATES.length);
    const rules = RULE_TEMPLATES.map(template => {
        assert.match(template.source, /^https:\/\//, template.id);
        const draft = templateDraft(template);
        assert.equal(draft.id, undefined, 'a template is a new rule');
        const countries = draft.countries.length ? draft.countries : ['FRA'];
        const { rule, error } = checkRule({ ...draft, id: newId() }, countries);
        assert.equal(error, undefined, `${template.id}: ${error}`);
        assert.equal(rule.kind, template.kind);
        return rule;
    });
    assert.equal(parseLedgerSettings({ dayRule: 'presence', rules }).error, undefined, 'the API accepts them all at once');
    const uk = rules.find(rule => rule.name.startsWith('UK residence test: 16'));
    assert.deepEqual([uk.period, uk.yearStart, uk.maxDays, uk.countries], ['year', '04-06', 16, ['GBR']]);
});
