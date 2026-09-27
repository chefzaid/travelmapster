# ADR 0001: Keep The README Short And Detail In `docs/`

- Status: Accepted
- Date: 2026-09-27

## Context

The README mixed the feature list, architecture, API, configuration, security, tests and
delivery. Sibling projects (DevApp, Thoughty, Indezy) use a reader-oriented `docs/` structure.

## Decision

`README.md` is a short entry point. Details live in one guide per reader: features, architecture
with this ADR index, data model, development, testing, code quality, deployment, operations and
security. Planned work lives only in `TODO.md`; guides describe implemented behavior. Each fact
has one home and other guides link to it.

## Consequences

Readers find a stable path, and changes must update the guide that owns the fact in the same
commit. Cross-links become part of review.
