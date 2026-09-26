'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    {
        ignores: ['node_modules/', 'coverage/', 'playwright-report/', 'test-results/', 'public/data/', 'public/vendor/']
    },
    js.configs.recommended,
    {
        files: ['src/**/*.js', 'test/**/*.js', 'eslint.config.js', 'playwright.config.js'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'commonjs',
            globals: { ...globals.node }
        },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            eqeqeq: ['error', 'always'],
            'no-var': 'error',
            'prefer-const': 'error'
        }
    },
    {
        // Browser ES modules; Leaflet is loaded as a classic script global.
        files: ['public/js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: { ...globals.browser, L: 'readonly' }
        },
        rules: {
            eqeqeq: ['error', 'always'],
            'no-var': 'error',
            'no-redeclare': ['error', { builtinGlobals: false }],
            'no-unused-vars': ['error', { ignoreRestSiblings: true }],
            'prefer-const': ['error', { ignoreReadBeforeAssign: true }]
        }
    },
    {
        files: ['scripts/**/*.js'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'commonjs',
            globals: { ...globals.node }
        }
    }
];
