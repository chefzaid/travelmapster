'use strict';

const pino = require('pino');

function createLogger(level = 'info') {
    return pino({
        level,
        base: { app: 'travelmapster' },
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
            level: label => ({ level: label })
        },
        redact: {
            paths: [
                'req.headers.cookie',
                'req.headers.authorization',
                'req.headers["x-csrf-token"]',
                'res.headers["set-cookie"]',
                'password'
            ],
            censor: '[redacted]'
        }
    });
}

module.exports = { createLogger };
