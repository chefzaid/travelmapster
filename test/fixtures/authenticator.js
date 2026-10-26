'use strict';

// A software passkey for the tests: it answers WebAuthn registration and sign-in options as a
// platform authenticator would, with a P-256 key, "none" attestation and user verification.
const crypto = require('node:crypto');

// Just enough CBOR (RFC 8949) for attestation objects and COSE keys.
function cbor(value) {
    const head = (major, length) => {
        if (length < 24) return Buffer.from([(major << 5) | length]);
        if (length < 256) return Buffer.from([(major << 5) | 24, length]);
        const buffer = Buffer.alloc(3);
        buffer[0] = (major << 5) | 25;
        buffer.writeUInt16BE(length, 1);
        return buffer;
    };
    if (Number.isInteger(value)) return value >= 0 ? head(0, value) : head(1, -1 - value);
    if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
    if (typeof value === 'string') return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)]);
    if (value instanceof Map) {
        return Buffer.concat([head(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)])]);
    }
    throw new Error(`Cannot encode ${typeof value}`);
}

const b64url = buffer => Buffer.from(buffer).toString('base64url');
const sha256 = data => crypto.createHash('sha256').update(data).digest();

function createAuthenticator({ origin }) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const credentialId = crypto.randomBytes(16);
    let counter = 0;

    const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
    const authData = (rpId, flags, extra = Buffer.alloc(0)) => {
        const count = Buffer.alloc(4);
        count.writeUInt32BE(counter);
        return Buffer.concat([sha256(rpId), Buffer.from([flags]), count, extra]);
    };

    return {
        id: b64url(credentialId),
        /** The response to registration options, as the browser would send it. */
        register(options) {
            const coseKey = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
            const idLength = Buffer.alloc(2);
            idLength.writeUInt16BE(credentialId.length);
            const attested = Buffer.concat([Buffer.alloc(16), idLength, credentialId, coseKey]);
            // User present, user verified, attested credential data.
            const data = authData(options.rp.id, 0x45, attested);
            const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', data]]));
            return {
                id: b64url(credentialId), rawId: b64url(credentialId), type: 'public-key', clientExtensionResults: {},
                response: {
                    clientDataJSON: b64url(clientData('webauthn.create', options.challenge)),
                    attestationObject: b64url(attestationObject), transports: ['internal']
                }
            };
        },
        /** The response to sign-in options, signed with the key. */
        signIn(options, { verified = true } = {}) {
            counter += 1;
            const data = authData(options.rpId, verified ? 0x05 : 0x01);
            const client = clientData('webauthn.get', options.challenge);
            const signature = crypto.sign('sha256', Buffer.concat([data, sha256(client)]), privateKey);
            return {
                id: b64url(credentialId), rawId: b64url(credentialId), type: 'public-key', clientExtensionResults: {},
                response: { clientDataJSON: b64url(client), authenticatorData: b64url(data), signature: b64url(signature) }
            };
        }
    };
}

module.exports = { createAuthenticator };
