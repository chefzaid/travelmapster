// Passkeys in the browser (ADR 0027): the server's JSON options become the binary options of
// navigator.credentials, and the credentials it returns become JSON again, with every binary
// field as base64url. Pure but for `navigator.credentials`, unit tested in Node.

export function toBase64url(buffer) {
    let text = '';
    for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte);
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text) {
    const base64 = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
    return Uint8Array.from(atob(base64), character => character.charCodeAt(0)).buffer;
}

const descriptors = list => (list || []).map(item => ({ ...item, id: fromBase64url(item.id) }));

/** Options for navigator.credentials.create, from the server's registration options. */
export function creationOptions(options) {
    return {
        ...options,
        challenge: fromBase64url(options.challenge),
        user: { ...options.user, id: fromBase64url(options.user.id) },
        excludeCredentials: descriptors(options.excludeCredentials)
    };
}

/** Options for navigator.credentials.get, from the server's sign-in options. */
export function requestOptions(options) {
    return { ...options, challenge: fromBase64url(options.challenge), allowCredentials: descriptors(options.allowCredentials) };
}

/** A new or used credential as JSON for the server. */
export function credentialJson(credential) {
    const { response } = credential;
    const binary = name => (response[name] ? toBase64url(response[name]) : undefined);
    return {
        id: credential.id,
        rawId: toBase64url(credential.rawId),
        type: credential.type,
        authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
        clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
        response: {
            clientDataJSON: binary('clientDataJSON'),
            attestationObject: binary('attestationObject'),
            authenticatorData: binary('authenticatorData'),
            signature: binary('signature'),
            userHandle: binary('userHandle'),
            transports: response.getTransports?.()
        }
    };
}

/** Whether this browser can use passkeys at all. */
export function passkeysSupported() {
    return typeof globalThis.PublicKeyCredential === 'function' && Boolean(globalThis.navigator?.credentials);
}

/** Creates a passkey from registration options; null when the traveler cancels. */
export async function createPasskey(options) {
    const credential = await navigator.credentials.create({ publicKey: creationOptions(options) }).catch(cancelled);
    return credential ? credentialJson(credential) : null;
}

/** Signs in with a passkey from sign-in options; null when the traveler cancels. */
export async function usePasskey(options) {
    const credential = await navigator.credentials.get({ publicKey: requestOptions(options) }).catch(cancelled);
    return credential ? credentialJson(credential) : null;
}

// Closing the browser's passkey prompt is not an error worth a message.
function cancelled(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') return null;
    throw error;
}
