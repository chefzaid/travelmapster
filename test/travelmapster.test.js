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
            notes: 'Unsafe link must not be stored.',
            travelDate: '2026-02-30'
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
            notes: 'Visited in spring.',
            travelDate: '2026-02-14'
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
        notes: 'Visited in spring.',
        travelDate: '2026-02-14'
    }]);

    result = await request('/profile', {
        method: 'PATCH',
        body: JSON.stringify({ profileVisibility: 'public' })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.profileVisibility, 'public');

    result = await request('/updateMarker/' + markerId, {
        method: 'PATCH',
        body: JSON.stringify({
            lat: 51.5,
            lng: -0.12,
            type: 'wishlist',
            name: 'London',
            category: 'City',
            photoUrl: '',
            notes: 'Updated note.',
            travelDate: '2026-06-01'
        })
    });
    assert.equal(result.response.status, 204);

    result = await request('/getMarkers');
    assert.deepEqual(result.body, [{
        id: markerId,
        lat: 51.5,
        lng: -0.12,
        type: 'wishlist',
        name: 'London',
        category: 'City',
        photoUrl: '',
        notes: 'Updated note.',
        travelDate: '2026-06-01'
    }]);

    result = await request('/deleteMarker/' + markerId, { method: 'DELETE' });
    assert.equal(result.response.status, 204);

    result = await request('/getMarkers');
    assert.deepEqual(result.body, []);

    result = await request('/logout', { method: 'POST' });
    assert.equal(result.response.status, 204);

    result = await request('/getMarkers');
    assert.equal(result.response.status, 401);
});

test('static serving only exposes the public frontend', async () => {
    for (const route of ['/markers.db', '/server.js', '/package.json']) {
        const result = await request(route);
        assert.equal(result.response.status, 404, `${route} must not be served`);
    }
    const index = await request('/');
    assert.equal(index.response.status, 200);
    const countries = await request('/data/countries.geojson');
    assert.equal(countries.response.status, 200);
});

test('trip itineraries are validated, owned and editable', async () => {
    const username = `trip-test-${Date.now()}`;
    const password = 'trip-test-password';
    await request('/register', { method: 'POST', body: JSON.stringify({ username, password }) });
    await request('/login', { method: 'POST', body: JSON.stringify({ username, password }) });

    let result = await request('/trips', { method: 'POST', body: JSON.stringify({ title: 'No plan', destination: 'Lisbon', plan: [] }) });
    assert.equal(result.response.status, 400);

    result = await request('/trips', {
        method: 'POST',
        body: JSON.stringify({ title: 'Lisbon weekend', destination: 'Lisbon', startDate: '2026-02-30', plan: [{}] })
    });
    assert.equal(result.response.status, 400);

    result = await request('/trips', {
        method: 'POST',
        body: JSON.stringify({
            title: ' Lisbon weekend ',
            destination: 'Lisbon',
            startDate: '2026-10-10',
            plan: [{ morning: 'Tram 28', afternoon: 'Belém', evening: 'Fado', extra: 'dropped' }, {}]
        })
    });
    assert.equal(result.response.status, 201);
    const trip = result.body;
    assert.equal(trip.title, 'Lisbon weekend');
    assert.deepEqual(trip.plan, [
        { morning: 'Tram 28', afternoon: 'Belém', evening: 'Fado' },
        { morning: '', afternoon: '', evening: '' }
    ]);

    result = await request(`/trips/${trip.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...trip, plan: [...trip.plan, { morning: 'Sintra' }] })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.plan.length, 3);

    result = await request('/trips');
    assert.equal(result.body.length, 1);
    assert.equal(result.body[0].plan[2].morning, 'Sintra');

    // Another user cannot see or change this trip.
    await request('/logout', { method: 'POST' });
    const other = `trip-other-${Date.now()}`;
    await request('/register', { method: 'POST', body: JSON.stringify({ username: other, password }) });
    await request('/login', { method: 'POST', body: JSON.stringify({ username: other, password }) });
    result = await request('/trips');
    assert.deepEqual(result.body, []);
    result = await request(`/trips/${trip.id}`, { method: 'PUT', body: JSON.stringify(trip) });
    assert.equal(result.response.status, 404);

    await request('/logout', { method: 'POST' });
    await request('/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    result = await request(`/trips/${trip.id}`, { method: 'DELETE' });
    assert.equal(result.response.status, 204);
    result = await request('/trips');
    assert.deepEqual(result.body, []);
    await request('/logout', { method: 'POST' });
});

test('public travel maps are read-only and respect profile visibility', async () => {
    const username = `public-test-${Date.now()}`;
    const password = 'public-test-password';
    await request('/register', { method: 'POST', body: JSON.stringify({ username, password }) });
    await request('/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    await request('/addMarker', {
        method: 'POST',
        body: JSON.stringify({ lat: 35.68, lng: 139.69, type: 'visited', name: 'Japan', category: 'Country', notes: 'Private note' })
    });
    await request('/logout', { method: 'POST' });

    let result = await request(`/public/${username}`);
    assert.equal(result.response.status, 404, 'private maps are hidden');

    await request('/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    await request('/profile', { method: 'PATCH', body: JSON.stringify({ profileVisibility: 'public' }) });
    await request('/logout', { method: 'POST' });

    result = await request(`/public/${username}`);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.username, username);
    assert.equal(result.body.markers.length, 1);
    assert.equal(result.body.markers[0].name, 'Japan');
    assert.equal(result.body.markers[0].notes, undefined, 'notes stay private');

    result = await request('/public/nobody-here');
    assert.equal(result.response.status, 404);
});
