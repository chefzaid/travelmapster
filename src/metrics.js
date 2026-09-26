'use strict';

const client = require('prom-client');

function createMetrics() {
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

    function httpMiddleware(req, res, next) {
        const end = httpDuration.startTimer();
        res.on('finish', () => {
            // Use the matched route pattern to keep label cardinality bounded.
            const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : (res.statusCode === 404 ? 'unmatched' : req.baseUrl || 'static');
            end({ method: req.method, route, status: String(res.statusCode) });
        });
        next();
    }

    return { registry, httpMiddleware, authEvents };
}

module.exports = { createMetrics };
