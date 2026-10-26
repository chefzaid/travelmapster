'use strict';

const client = require('prom-client');

// Activity is counted from accounts' last active day; each replica reports the same numbers.
const ACTIVITY_WINDOWS = ['total', 'active_1d', 'active_7d', 'active_30d', 'returning_7d'];

/**
 * Prometheus metrics. With `users` (the user repository), the scrape also reports how many
 * accounts exist and how recently they were used; nothing identifies a person.
 */
function createMetrics({ users, logger } = {}) {
    const registry = new client.Registry();
    registry.setDefaultLabels({ app: 'travelmapster' });
    client.collectDefaultMetrics({ register: registry });

    const httpDuration = new client.Histogram({
        name: 'http_server_request_duration_seconds',
        help: 'HTTP request duration in seconds.',
        labelNames: ['method', 'route', 'status'],
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
        registers: [registry]
    });

    const authEvents = new client.Counter({
        name: 'travelmapster_auth_events_total',
        help: 'Authentication events by type and outcome.',
        labelNames: ['event', 'outcome'],
        registers: [registry]
    });

    // Steps of the product funnel, counted when a traveler reaches them (paid plans come later).
    const funnel = new client.Counter({
        name: 'travelmapster_funnel_total',
        help: 'Travelers reaching each funnel step: sign_up, first_place, ten_places, first_ledger_use.',
        labelNames: ['step'],
        registers: [registry]
    });

    if (users) {
        new client.Gauge({
            name: 'travelmapster_users',
            help: 'Accounts in total and by activity: active in the last 1, 7 or 30 days, and returning (older than 30 days, active in the last 7).',
            labelNames: ['activity'],
            registers: [registry],
            async collect() {
                try {
                    const counts = await users.activity();
                    for (const activity of ACTIVITY_WINDOWS) this.set({ activity }, counts[activity]);
                } catch (err) {
                    logger?.warn({ err }, 'Could not count accounts for metrics');
                }
            }
        });
    }

    function httpMiddleware(req, res, next) {
        const end = httpDuration.startTimer();
        res.on('finish', () => {
            // Use the matched route pattern to keep label cardinality bounded.
            const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : (res.statusCode === 404 ? 'unmatched' : req.baseUrl || 'static');
            end({ method: req.method, route, status: String(res.statusCode) });
        });
        next();
    }

    return { registry, httpMiddleware, authEvents, funnel };
}

module.exports = { createMetrics };
