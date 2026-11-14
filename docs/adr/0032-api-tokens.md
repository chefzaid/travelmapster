# ADR 0032: Personal API Tokens

- Status: Accepted
- Date: 2026-11-14

## Context

Accountants and HR systems want to read a traveler's days and an organization's business-day
report on a schedule, through the documented API ([ADR 0019](0019-api-description-and-versioning.md)),
without a browser session or the traveler's password. Sessions are cookie-based with a CSRF
token ([ADR 0003](0003-sessions-and-csrf.md)), which suits browsers but not integrations.

## Decision

- **Personal tokens, read-only.** A traveler makes up to ten named tokens in Sign-in security.
  A token is `tmk_` and 32 random bytes; only its SHA-256 hash is stored, it is shown once, and
  revoking it ends it at once. Sent as `Authorization: Bearer`, it signs the request in as its
  traveler for `GET` and `HEAD` only; anything else answers 403, so a token needs no CSRF token.
- **Never sign-in security.** A token cannot read `/api/security` or `/api/api-tokens`, so a
  leaked token cannot list devices or make more tokens. It reads everything else the traveler
  can, including the account archive and the reports of organizations they manage.
- **On the record.** Making and revoking a token join the security activity. An organization
  report read with a token goes on the organization's audit log as read "through an API token",
  which every member sees. A token's last use is noted, at most once a minute.
- **Organization tokens are personal ones.** An HR integration uses a token of a manager or
  admin, whose rights it carries; no separate kind of token, so roles and the audit log stay
  the single source of who may see what.

## Consequences

- Integrations work with a plain HTTP client, and a traveler can see and end each one.
- A token is as strong as a password for reading: the UI says so, and the API keeps the
  account's rate limits per address.
- A token outlives a password change; travelers revoke tokens they no longer use. Deleting the
  account, or asking for it to be deleted, ends every token.
