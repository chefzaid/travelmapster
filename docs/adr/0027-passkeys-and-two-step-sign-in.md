# ADR 0027: Passkeys And Two-Step Sign-In

- Status: Accepted
- Date: 2026-10-26

## Context

An account holds years of travels and, with the day ledger, records a traveler may show a tax
adviser or a border officer. A username and password is its only protection, and the Teams
tier ([ADR 0022](0022-teams.md)) will need stronger sign-in for administrators. Two standard
ways exist: passkeys (WebAuthn), which replace the password with a key held by the device and
cannot be phished, and a second step with a time-based code (TOTP, RFC 6238) from an
authenticator app.

## Decision

- **Passkeys.** A signed-in traveler adds passkeys in **Sign-in security** (a name, the device
  creates the key; at most 10), and can sign in with one from the login form, without a
  username or password. Keys must be discoverable and verify the user (`residentKey` and
  `userVerification` required); attestation is not asked for. The server checks registrations
  and sign-ins with `@simplewebauthn/server` (MIT, a new dependency): verifying CBOR attestation
  objects, COSE keys and signatures is easy to get subtly wrong, while the browser side is a
  few lines of `navigator.credentials` in `public/js/webauthn.js`. Each passkey stores its
  credential id, public key, signature counter and transports; the challenge lives in the
  session for five minutes. The relying party is `PUBLIC_URL`'s host, or the request's.
- **Two-step sign-in.** A traveler can turn on a second step: the server makes a secret, shown
  as a QR code (drawn by `public/js/qr.js`, no dependency) and as text, and turns the step on
  once a code from the app matches. Codes are six digits over 30 seconds, accepted one step
  either side, and each step only once. Ten single-use recovery codes are shown once and stored
  as SHA-256 hashes. A password sign-in then waits for a code or a recovery code, for five
  minutes and five tries, before the session is opened; a passkey sign-in needs no second step,
  as the passkey already proves both. Turning the step off needs the password.
- **Secrets at rest.** TOTP secrets are stored encrypted with AES-256-GCM under a key derived
  (HKDF) from `TOTP_ENCRYPTION_KEY`, or from `SESSION_SECRET` when that is not set, so a copy
  of the database alone cannot produce codes. Rotating the key without re-encrypting leaves
  travelers with their recovery codes, which still work.
- **Limits.** Every route shares the sign-in rate limit; the account archive lists passkey names
  and whether the second step is on, never keys or secrets.

## Consequences

- Migration `017_sign_in_security.sql` adds `passkeys`, `totp_secrets` and `recovery_codes`,
  each deleted with the account; additive, as the previous release never reads them
  ([ADR 0004](0004-postgres-and-migrations.md)).
- `@simplewebauthn/server` and its ASN.1 and CBOR helpers join the image and the dependency
  checks; `jsqr` is a development dependency that reads the QR codes back in tests.
- Passkeys need a domain name: browsers refuse them on an IP address, so local runs use
  `localhost`.
- Requiring these for Teams administrators follows with the Teams tier.
