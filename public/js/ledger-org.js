// Ledger tab, employer side (ADR 0029): the rules of each of the traveler's organizations,
// counted on the visits marked as business trips for it, as its managers see them.
import { h, formatDate } from './ui.js';
import { ledgerOverview, localToday, stayRuleStatus } from './days.js';
import { meter, statusChip } from './ledger-parts.js';
import { t } from './i18n.js';

/** The places with only their business visits for one organization. */
export function businessMarkers(markers, orgId) {
    return markers
        .map(marker => ({ ...marker, visits: (marker.visits || []).filter(visit => visit.purpose === 'business' && visit.organizationId === orgId) }))
        .filter(marker => marker.visits.length);
}

function ruleItem({ rule, count, status, text }) {
    return h('li', { class: 'ledger-item' }, h('span', { class: 'ledger-item-text' },
        h('strong', {}, rule.name, ' ', statusChip(status)),
        meter(count, rule.maxDays, t('{name}: {count} of {maxDays} business days', { name: rule.name, count, maxDays: rule.maxDays })),
        h('small', {}, text)));
}

export function orgRulesSections(ctx) {
    const { state } = ctx;
    return (state.orgs || []).filter(org => org.rules.length).map(org => {
        const overview = ledgerOverview({
            markers: businessMarkers(state.markers, org.id),
            countryOf: marker => state.stats.markerCountry.get(marker.id),
            settings: { dayRule: 'presence', rules: org.rules, planned: [] },
            today: localToday()
        });
        const items = [
            ...overview.stays.filter(item => !item.rule.builtIn).map(item => ({
                rule: item.rule, count: item.used, status: stayRuleStatus(item),
                text: t('{used} of {maxDays} days in any {windowDays}, {remaining} left today', { used: item.used, maxDays: item.rule.maxDays, windowDays: item.rule.windowDays, remaining: item.remaining })
            })),
            ...overview.thresholds.filter(item => !item.rule.builtIn).map(item => ({
                rule: item.rule, count: item.count, status: item.status,
                text: t('{count} of {maxDays} days from {from} to {to}', { count: item.count, maxDays: item.rule.maxDays, from: formatDate(item.period.from), to: formatDate(item.period.to) })
            }))
        ];
        const titleId = `org-rules-${org.id}`;
        return h('section', { 'aria-labelledby': titleId },
            h('h3', { class: 'section-title', id: titleId }, `💼 ${org.name}`, h('span', { class: 'count' }, items.length)),
            h('p', { class: 'muted small' }, t('Its rules, counted on the visits you mark as business trips for it. Its managers see these counts, never your places.')),
            h('ul', { class: 'ledger-list' }, items.map(ruleItem)));
    });
}
