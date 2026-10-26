// Unit tests for passkeys in the browser (public/js/webauthn.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'webauthn.js'));

test('binary fields travel as base64url both ways', async () => {
    const { toBase64url, fromBase64url } = await load();
    const bytes = Uint8Array.from([0, 251, 255, 62, 63, 1]);
    assert.equal(toBase64url(bytes), Buffer.from(bytes).toString('base64url'));
    assert.deepEqual(new Uint8Array(fromBase64url(toBase64url(bytes))), bytes);
    assert.deepEqual(new Uint8Array(fromBase64url('AQ')), Uint8Array.from([1]));
});

test('server options become credential options, and credentials become JSON', async () => {
    const { creationOptions, requestOptions, credentialJson } = await load();
    const created = creationOptions({
        challenge: 'AAEC', rp: { id: 'travel.test', name: 'TravelMapster' }, user: { id: 'AwQ', name: 'zaid', displayName: 'zaid' },
        excludeCredentials: [{ id: 'BQY', type: 'public-key', transports: ['internal'] }], pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
    });
    assert.deepEqual(new Uint8Array(created.challenge), Uint8Array.from([0, 1, 2]));
    assert.deepEqual(new Uint8Array(created.user.id), Uint8Array.from([3, 4]));
    assert.deepEqual(new Uint8Array(created.excludeCredentials[0].id), Uint8Array.from([5, 6]));
    assert.deepEqual(created.excludeCredentials[0].transports, ['internal']);
    assert.equal(created.rp.id, 'travel.test');
    const requested = requestOptions({ challenge: 'AAEC', rpId: 'travel.test' });
    assert.deepEqual(requested.allowCredentials, []);
    assert.equal(requested.rpId, 'travel.test');

    const buffer = values => Uint8Array.from(values).buffer;
    const json = credentialJson({
        id: 'BQY', rawId: buffer([5, 6]), type: 'public-key', authenticatorAttachment: 'platform',
        getClientExtensionResults: () => ({ credProps: { rk: true } }),
        response: { clientDataJSON: buffer([1]), attestationObject: buffer([2]), getTransports: () => ['internal'] }
    });
    assert.deepEqual(json, {
        id: 'BQY', rawId: 'BQY', type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: { credProps: { rk: true } },
        response: { clientDataJSON: 'AQ', attestationObject: 'Ag', authenticatorData: undefined, signature: undefined, userHandle: undefined, transports: ['internal'] }
    });
    const signedIn = credentialJson({ id: 'x', rawId: buffer([9]), type: 'public-key', response: { clientDataJSON: buffer([1]), authenticatorData: buffer([3]), signature: buffer([4]), userHandle: null } });
    assert.deepEqual([signedIn.response.authenticatorData, signedIn.response.signature, signedIn.response.userHandle, signedIn.clientExtensionResults], ['Aw', 'BA', undefined, {}]);
});

test('closing the passkey prompt is not an error', async () => {
    const { createPasskey, usePasskey, passkeysSupported } = await load();
    assert.equal(passkeysSupported(), false, 'Node has no passkeys');
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const refuse = name => () => Promise.reject(Object.assign(new Error(name), { name }));
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { credentials: { create: refuse('NotAllowedError'), get: refuse('AbortError') } } });
    try {
        assert.equal(await createPasskey({ challenge: 'AA', user: { id: 'AA' } }), null);
        assert.equal(await usePasskey({ challenge: 'AA' }), null);
        globalThis.navigator.credentials.get = refuse('SecurityError');
        await assert.rejects(usePasskey({ challenge: 'AA' }), { name: 'SecurityError' });
    } finally {
        if (original) Object.defineProperty(globalThis, 'navigator', original);
        else delete globalThis.navigator;
    }
});
