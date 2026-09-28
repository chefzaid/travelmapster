# TravelMapster

![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![MapLibre GL](https://img.shields.io/badge/MapLibre%20GL-6-396CB2?logo=maplibre&logoColor=white)
![CI](https://github.com/chefzaid/travelmapster/actions/workflows/ci.yml/badge.svg)

TravelMapster is a playful travel atlas. Color in the countries you have visited, pin the
cities you love, keep a wishlist of dream trips and plan day-by-day itineraries. One Node.js
service serves the cartoon map and its JSON API from PostgreSQL, and runs on the platform
supplied by [`swirl-cloud`](https://github.com/chefzaid/swirl-cloud).

## Quick Start

Run the whole stack in containers, then open <http://localhost:3000> and sign up:

```bash
docker compose -f infra/compose/compose.yaml up --build
```

For a fast edit loop with Node.js 22.12+ against the compose database, and for tests, see
the [development guide](docs/development.md#local-start) and the
[testing guide](docs/testing.md).

## Delivery

The repository follows swirl-cloud's [onboarding contract](docs/deployment.md#onboarding).
GitHub and GitLab stay in sync; GitLab CI tests every branch, and a release on `main` starts
with the manual `00-image` job, then tags the version and deploys through Argo CD. See the
[delivery flow](docs/deployment.md#delivery-flow).

## Documentation

- [Features](docs/features.md)
- [Architecture and ADR index](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Development](docs/development.md)
- [Testing](docs/testing.md)
- [Code quality](docs/code-quality.md)
- [Deployment](docs/deployment.md)
- [Operations runbook](docs/operations.md)
- [Security](docs/security.md)

Planned work is tracked in [TODO.md](TODO.md).
