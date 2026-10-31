// Ledger tab: the US Substantial Presence Test (us-presence.js) among the tax-residency
// thresholds, once the ledger has days in the United States in the last three years.
import { h } from './ui.js';
import { substantialPresence, US } from './us-presence.js';
import { countryLabel, meter, statusChip } from './ledger-parts.js';
import { formatNumber, t } from './i18n.js';

export function usPresenceItem(ctx, overview, today) {
    const test = substantialPresence(overview.presence, today);
    if (!test) return null;
    const total = formatNumber(Math.floor(test.total));
    return h('li', { class: 'ledger-item', id: 'us-presence' },
        h('span', { class: 'ledger-item-text' },
            h('strong', {}, countryLabel(ctx, US), ' ', t('Substantial Presence Test')),
            meter(Math.min(test.total, test.needed), test.needed, t('US Substantial Presence Test: {total} of {needed} days', { total, needed: test.needed })),
            h('small', {}, t('{current} days in {year}, a third of {last} in {lastYear} and a sixth of {before} in {beforeYear}: {total} of {needed}, with at least 31 this year.', {
                current: test.current, year: test.year, last: test.last, lastYear: test.year - 1, before: test.before, beforeYear: test.year - 2, total, needed: test.needed
            })),
            h('small', {}, t('Days the IRS leaves out, such as an exempt student\'s or a transit of under a day, are counted here.'))),
        statusChip(test.status));
}
