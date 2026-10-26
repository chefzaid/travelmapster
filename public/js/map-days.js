// The legend's "Days" switch: the map colored by the days the ledger counts in each country
// (heat-map.js) instead of by status, for all time or the timeline's year.
import { $, h } from './ui.js';
import { localToday } from './days.js';
import { currentLedger } from './ledger-store.js';
import { heatLegend, recordedDays } from './heat-map.js';
import { formatNumber, t, tn } from './i18n.js';

// Days count for the traveler's own map and the demo; public maps share no dates.
const available = ({ state }) => Boolean(state.user || state.demo) && !state.publicUser;

/** The period the map's days cover: all time, or the timeline's year (up to its end, or during it). */
function period(view, today) {
    if (!view) return { to: today };
    const end = `${view.year}-12-31`;
    return { from: view.mode === 'during' ? `${view.year}-01-01` : undefined, to: end < today ? end : today };
}

/**
 * Days per country for the map when it is colored by days, or null when it shows statuses;
 * also shows the legend's steps or statuses to match.
 */
export function mapDays(ctx, view) {
    const { state } = ctx;
    const ledger = available(ctx) ? currentLedger(ctx).ledger : null;
    const button = $('#legend-days');
    button.hidden = !ledger || !ledger.countries.size;
    const on = !button.hidden && state.colorByDays;
    button.setAttribute('aria-pressed', String(on));
    $('#legend').classList.toggle('is-days', on);
    const scale = $('#legend-heat');
    scale.hidden = !on;
    state.mapDays = on ? recordedDays(ledger, period(view, localToday())) : null;
    if (!on) return null;
    const days = state.mapDays;
    scale.replaceChildren(...heatLegend(days).map(step => h('span', { class: 'legend-item legend-step' },
        h('span', { class: `swatch swatch-heat-${step.level}`, 'aria-hidden': 'true' }),
        h('span', { 'aria-hidden': 'true' }, step.label, ' ', h('strong', {}, formatNumber(step.countries))),
        h('span', { class: 'visually-hidden' }, tn(step.countries, '{range}: {count} country', '{range}: {count} countries', { range: step.label })))));
    scale.setAttribute('aria-label', t('Days spent in each country'));
    return days;
}

export function setupDaysLegend(ctx) {
    $('#legend-days').addEventListener('click', () => {
        ctx.state.colorByDays = !ctx.state.colorByDays;
        ctx.applyFilters();
    });
}
