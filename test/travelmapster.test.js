const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'travelmapster-test-'));
process.env.DB_PATH = path.join(testDirectory, 'markers.db');
process.env.SESSION_SECRET = 'travelmapster-test-secret';

const { app, db } = require('../server');

let server;
let baseUrl;
let sessionCookie = '';

function startServer() {
    return new Promise(resolve => {
        server = app.listen(0, () => {
            baseUrl = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });
}

function stopServer() {
    return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}

async function request(route, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (sessionCookie) headers.Cookie = sessionCookie;
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    const response = await fetch(`${baseUrl}${route}`, { ...options, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) sessionCookie = setCookie.split(';')[0];

    const text = await response.text();
    let body = text;
    if (text) {
        try {
            body = JSON.parse(text);
        } catch (error) {
            // Keep non-JSON responses as text for useful assertion failures.
        }
    }
    return { response, body };
}

test.before(async () => {
    await startServer();
});

test.after(async () => {
    await stopServer();
    db.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('auth and marker API routes protect and persist travel data', async () => {
    const username = `api-test-${Date.now()}`;
    const password = 'api-test-password';

    let result = await request('/current_user');
    assert.equal(result.response.status, 401);

    result = await request('/register', {
        method: 'POST',
        body: JSON.stringify({ username, password })
    });
    assert.equal(result.response.status, 201);

    result = await request('/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.username, username);

    result = await request('/current_user');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.profileVisibility, 'private');

    result = await request('/addMarker', {
        method: 'POST',
        body: JSON.stringify({
            lat: 48.86,
            lng: 2.35,
            type: 'visited',
            name: 'France',
            category: 'Country',
            photoUrl: 'javascript:alert(1)',
            notes: 'Unsafe link must not be stored.'
        })
    });
    assert.equal(result.response.status, 400);

    result = await request('/addMarker', {
        method: 'POST',
        body: JSON.stringify({
            lat: 48.86,
            lng: 2.35,
            type: 'visited',
            name: 'France',
            category: 'Country',
            photoUrl: 'https://example.com/france.jpg',
            notes: 'Visited in spring.'
        })
    });
    assert.equal(result.response.status, 200);
    const markerId = result.body.id;

    result = await request('/getMarkers');
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, [{
        id: markerId,
        lat: 48.86,
        lng: 2.35,
        type: 'visited',
        name: 'France',
        category: 'Country',
        photoUrl: 'https://example.com/france.jpg',
        notes: 'Visited in spring.'
    }]);

    result = await request('/profile', {
        method: 'PATCH',
        body: JSON.stringify({ profileVisibility: 'public' })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.profileVisibility, 'public');

    result = await request('/deleteMarker/' + markerId, { method: 'DELETE' });
    assert.equal(result.response.status, 204);

    result = await request('/getMarkers');
    assert.deepEqual(result.body, []);

    result = await request('/logout', { method: 'POST' });
    assert.equal(result.response.status, 204);

    result = await request('/getMarkers');
    assert.equal(result.response.status, 401);
});
