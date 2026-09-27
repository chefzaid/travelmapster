# ADR 0004: PostgreSQL With In-App SQL Migrations

- Status: Accepted
- Date: 2026-09-27

## Context

Users, places, trips and sessions are relational and small. The platform provides a shared
PostgreSQL service with a database per application.

## Decision

Use PostgreSQL through `pg` with hand-written SQL in `src/repositories.js`. Numbered SQL files in
`src/db/migrations/` run at startup, each in a transaction, under an advisory lock, and are
recorded in `schema_migrations`. Constraints in the schema mirror `src/validation.js`. An
Argo CD sync hook creates the database and its least-privileged role. See the
[data model](../data-model.md).

## Consequences

- No ORM or migration tool to learn; the schema is readable SQL.
- Migrations are forward-only and must stay compatible with the running release during a
  rollout or rollback.
- Startup waits for the database, retrying ten times before failing.
