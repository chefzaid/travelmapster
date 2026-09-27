# Roadmap

Planned work only; shipped behavior is listed in [features](docs/features.md). Keep the
[product principles](docs/features.md#product-principles) when adding features, and record
material design changes as an [ADR](docs/architecture.md#adr-process).

## Product

- [ ] Google and Facebook login
- [ ] Travel albums: give each pinned place a description and a photo album instead of a single photo link
- [ ] Multiple visits per place: record each visit with its own dates, description and photos, and show how many times you have been
- [ ] Account settings: change password and delete the account with all its data

## Technical

- [ ] Refuse to run integration tests against a database that is not a dedicated test database (they drop the `public` schema; see [testing](docs/testing.md#test-database))
- [ ] Automated accessibility checks (axe contrast and semantics) in the Playwright suite
- [ ] Share rate-limit counters and the geocoder throttle across replicas before enabling the [HA profile](docs/deployment.md#high-availability)
- [ ] Restore drill for the `travelmapster` database from the platform backup
