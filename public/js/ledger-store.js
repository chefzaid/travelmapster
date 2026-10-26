// The day ledger's state in the app: the overview counted from places and settings (cleared
// whenever they change), the alert badge and toast, and the date history fetched when needed.
import { $, toast, formatDate } from './ui.js';
import { ledgerOverview, localToday } from './days.js';

export const emptyLedger = () => ({ settings: { dayRule: 'presence', rules: [], planned: [] }, changes: null, overview: null, alerted: false });

export function currentLedger(ctx) {
    const { state } = ctx;
    if (!state.ledger.overview) {
        state.ledger.overview = ledgerOverview({
            markers: state.markers,
            countryOf: marker => state.stats.markerCountry.get(marker.id),
            settings: state.ledger.settings,
            today: localToday(),
            nameOf: id => state.index.byId.get(id)?.name || id,
            formatDay: formatDate
        });
    }
    return state.ledger.overview;
}

export function updateLedgerBadge(ctx) {
    const badge = $('#ledger-alert-count');
    const count = ctx.state.user ? currentLedger(ctx).alerts.length : 0;
    badge.hidden = !count;
    badge.querySelector('[aria-hidden]').textContent = count;
    badge.querySelector('.visually-hidden').textContent = ` (${count} ${count === 1 ? 'alert' : 'alerts'})`;
}

// In-app alerts: once per session, a nudge toward the Ledger tab.
export function announceLedgerAlerts(ctx) {
    const { alerts } = currentLedger(ctx);
    if (ctx.state.ledger.alerted || !alerts.length) return;
    ctx.state.ledger.alerted = true;
    toast(alerts.length === 1 ? `Day ledger: ${alerts[0].message}` : `Day ledger: ${alerts.length} alerts need a look.`, {
        tone: 'error',
        duration: 8000,
        action: { label: 'Open ledger', run: () => ctx.selectTab('ledger') }
    });
}

let changesRequest = null;

/** The history of visit dates, fetched once after each change to places or visits. */
export function loadVisitChanges(ctx) {
    const { ledger } = ctx.state;
    if (ledger.changes) return Promise.resolve(ledger.changes);
    if (!changesRequest) {
        changesRequest = ctx.api.getVisitChanges()
            .then(changes => {
                ctx.state.ledger.changes = changes;
                return changes;
            })
            .finally(() => { changesRequest = null; });
    }
    return changesRequest;
}
