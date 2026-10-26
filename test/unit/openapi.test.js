'use strict';

// The OpenAPI description (docs/api/openapi.json) lists exactly the routes the app mounts, and
// every reference in it resolves (ADR 0019).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'api', 'openapi.json'), 'utf8'));
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// "METHOD /api/path" for every route, read from where routers are mounted and defined.
function appRoutes() {
    const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
    const routeFiles = fs.readdirSync(path.join(root, 'src', 'routes')).map(file => fs.readFileSync(path.join(root, 'src', 'routes', file), 'utf8'));
    const routes = new Set();
    for (const [, method, route] of app.matchAll(/api\.(get|post|put|patch|delete)\('([^']+)'/g)) routes.add(`${method.toUpperCase()} /api${route}`);
    // A mount may span lines, but never reaches into the next one.
    for (const [, mount, factory] of app.matchAll(/api\.use\('([^']+)'(?:(?!api\.use)[\s\S])*?(create\w+Router)\(/g)) {
        const source = routeFiles.find(text => text.includes(`function ${factory}(`));
        assert.ok(source, `${factory} is defined in src/routes`);
        const start = source.indexOf(`function ${factory}(`);
        const rest = source.slice(start + 1);
        const end = rest.search(/\n(?:async )?function |\nmodule\.exports/);
        const body = rest.slice(0, end < 0 ? undefined : end);
        for (const [, method, route] of body.matchAll(/router\.(get|post|put|patch|delete)\('([^']+)'/g)) {
            const full = `/api${mount}${route === '/' ? '' : route}`.replace(/:(\w+)/g, '{$1}');
            routes.add(`${method.toUpperCase()} ${full}`);
        }
    }
    return routes;
}

function specRoutes() {
    const routes = new Set();
    for (const [route, item] of Object.entries(spec.paths)) {
        for (const method of METHODS) if (item[method]) routes.add(`${method.toUpperCase()} ${route}`);
    }
    return routes;
}

test('the API description lists every route the app serves, and nothing else', () => {
    const app = appRoutes();
    assert.ok(app.size > 20, 'routes were found in the source');
    assert.deepEqual([...specRoutes()].sort(), [...app].sort());
});

test('the API description is OpenAPI 3.1, with every reference resolving and every operation answering errors', () => {
    assert.equal(spec.openapi, '3.1.0');
    assert.match(spec.info.version, /^1\.\d+\.\d+$/, 'the API stays at major version 1');
    const refs = JSON.stringify(spec).matchAll(/"\$ref":"#\/([^"]+)"/g);
    for (const [, pointer] of refs) {
        const target = pointer.split('/').reduce((node, key) => node?.[key], spec);
        assert.ok(target, `#/${pointer} resolves`);
    }
    for (const [route, item] of Object.entries(spec.paths)) {
        for (const method of METHODS.filter(name => item[name])) {
            const operation = item[method];
            assert.ok(operation.summary && operation.tags?.length, `${method} ${route} has a summary and a tag`);
            assert.ok(Object.keys(operation.responses).some(status => status.startsWith('2')), `${method} ${route} has a success response`);
            if (method !== 'get') assert.ok(operation.responses['403'], `${method} ${route} documents the CSRF check`);
        }
    }
});
