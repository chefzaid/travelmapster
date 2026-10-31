// Ledger tab, "Ledger health": the entries that would make the record doubtful when it matters
// (ledger-checks.js), each with the place to open and fix on the map; or that all is well.
import { h, formatDate } from './ui.js';
import { landNeighbors } from './borders.js';
import { ledgerHealth, healthCount } from './ledger-checks.js';
import { countryLabel } from './ledger-parts.js';
import { showMarker } from './cards.js';
import { t } from './i18n.js';

// A button that opens a visit's place on the map, to fix its dates on the card.
function openPlace(ctx, visit) {
    const marker = ctx.state.markers.find(item => item.id === visit.markerId);
    return marker ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => showMarker(ctx, marker) }, t('Open {place}', { place: visit.place.split(',')[0] })) : null;
}

const item = (text, detail, ...actions) => h('li', { class: 'ledger-item' },
    h('span', { class: 'ledger-item-text' }, h('strong', {}, text), detail ? h('small', {}, detail) : null), ...actions);

export function healthSection(ctx, overview) {
    const neighbors = landNeighbors(ctx.state.index.countries);
    const health = ledgerHealth(overview.ledger, { areNeighbors: (a, b) => Boolean(neighbors.get(a)?.has(b)) });
    const range = (from, to) => (from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`);
    return h('section', { 'aria-labelledby': 'health-title' },
        h('h3', { class: 'section-title', id: 'health-title' }, t('🩺 Ledger health')),
        healthCount(health)
            ? h('ul', { class: 'ledger-list', id: 'ledger-health' },
                health.unrecorded.map(visit => item(t('{place}: when did you leave?', { place: visit.place }),
                    t('Arrived on {date}; without an end, only that day counts.', { date: formatDate(visit.startDate) }), openPlace(ctx, visit))),
                health.stillThere.map(({ visit, since }) => item(t('Still in {place}?', { place: visit.place }),
                    t('Marked "still there" since {date}, but in {other} on {otherDate}.', { date: formatDate(visit.startDate), other: since.place, otherDate: formatDate(since.startDate) }),
                    openPlace(ctx, visit))),
                health.clashes.map(clash => item(
                    t('{first} and {second} on the same days', { first: countryLabel(ctx, clash.countries[0]), second: countryLabel(ctx, clash.countries[1]) }),
                    t('{dates}: no single journey covers both for that long; check the dates of these visits.', { dates: range(clash.from, clash.to) }))))
            : h('p', { class: 'muted small' }, t('All good: every visit has its end, and no two countries far apart share the same days.'))
    );
}
