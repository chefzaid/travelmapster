# Deployment Guide

TravelMapster runs in the `apps` namespace of the swirl-cloud platform, which supplies GitLab and
its registry, Argo CD, Vault with External Secrets, the shared PostgreSQL service, Traefik
ingress, DNS and monitoring. Everything application-specific lives in this repository.

## Infrastructure Layout

| Path | Purpose |
|---|---|
| `infra/onboarding.json` | Onboarding contract: inputs, rendered files, Vault secrets, DNS, required jobs |
| `infra/onboarding-values.json` | Values rendered by the last onboarding (hostname, registry, GitLab project) |
| `infra/argocd/application.yaml` | Argo CD Application `travelmapster` (in `infra`, deploying to `apps`) |
| `infra/k8s/` | Kubernetes resources, image tags pinned in `kustomization.yaml` |
| `infra/overlays/ha/` | Optional [high-availability](#high-availability) profile |
| `infra/compose/` | Local stack ([development](development.md#local-start)) |
| `infra/scripts/` | Versioning, image build, release and deploy helpers used by CI |
| `.gitlab-ci.yml` | Delivery pipeline |

## Kubernetes Resources

| Resource | Role |
|---|---|
| `ExternalSecret`s | `travelmapster-secret` (`PGPASSWORD`, `SESSION_SECRET` from Vault `apps/travelmapster/runtime`), registry pull credentials (`apps/travelmapster/registry`) and the database admin login used by the setup hook |
| `travelmapster-db-setup` Job | Argo CD sync hook: creates or updates the `travelmapster_user` role and `travelmapster` database in the shared PostgreSQL |
| ConfigMap `travelmapster-config` | Non-secret settings: database host, `TRUST_PROXY` (pod network), geocoder User-Agent |
| Deployment and Service | One replica with 192Mi/384Mi memory (the town index takes about 90 MB); non-root, read-only filesystem, all capabilities dropped; startup and readiness on `/readyz`, liveness on `/healthz`; metrics on port 9464 |
| Ingress and Middleware | TLS host through Traefik, 4 MiB body limit (bulk import), intranet homepage annotations |
| NetworkPolicy | Ingress only from Traefik (3000), Prometheus (9464) and CI smoke-test pods (3000) |

Argo CD tracks `HEAD` of `main` with automated sync, prune and self-heal: a manifest change
merged to `main` is applied without a release. Only the image tag waits for a release.

## Onboarding

swirl-cloud's `add-repos.sh` onboards the repository through contract version 1
([platform guide](https://github.com/chefzaid/swirl-cloud/blob/main/docs/guides/repository-onboarding.md)).
It imports the GitHub repository into GitLab and sets up two-way synchronization, generates the
database password and session secret in Vault, renders the platform values into the files listed
in `infra/onboarding.json`, creates DNS for `APP_SUBDOMAIN` (default `travelmapster`), and runs a
pipeline whose `00-image`, `01-release` and `02-deploy` jobs must succeed. Rerun it to change the
hostname or repair setup; existing Vault values are kept.

## Delivery Flow

Every branch pipeline runs `01-test` (lint, coverage, audit) and `02-package` (image build
without push); quality and security reports are described in [code quality](code-quality.md).
On `main`:

1. **`00-image`** (manual, asks for confirmation) builds and pushes the image with Kaniko,
   tagged with the current version.
2. **`01-release`** commits `release: X.Y.Z [skip ci]` with the new image tag, tags `vX.Y.Z`,
   commits the next minor baseline, pushes, and creates a GitLab release.
3. **`02-deploy`** applies the Argo CD Application, waits up to 15 minutes for the release
   revision to be `Synced` and `Healthy`, then smoke-tests `/readyz` and the home page.

A pipeline started from the GitLab UI on `main` with `PIPELINE_MODE=full` runs the whole
release automatically. Image publishing is its own job because Kaniko's multi-stage build
replaces the job container's filesystem ([ADR 0006](adr/0006-gitlab-argocd-delivery.md)).

GitHub and GitLab mirror each other through the platform-managed `sync-gitlab.yml` workflow.
Commits containing `[skip ci]` pushed to GitHub skip that workflow, so they reach GitLab with
the next sync; run the "Sync GitHub and GitLab" workflow manually when needed.

## Version Lifecycle

[VERSION](../VERSION) holds the baseline. The released version is that baseline plus the number
of first-parent commits since it changed, so every build is uniquely numbered. After a release,
the next minor baseline (`X.Y+1.0`) is committed. To change the major version, run
`infra/scripts/set-project-version.sh X.0.0` (updates `VERSION` and `package.json`) and commit.

## Verification And Rollback

```bash
kubectl get application travelmapster -n infra
kubectl rollout status deployment/travelmapster -n apps
curl -fsS https://travelmapster.swirlit.dev/readyz
```

To roll back, pin the previous image and commit it to `main`; Argo CD deploys it within its
sync interval (released images stay in the registry):

```bash
infra/scripts/set-image-tags.sh 1.2.0   # the version to return to
git commit -am "Roll back to 1.2.0" && git push
```

Schema migrations are
forward-only, so a rollback must stay compatible with the migrated schema
([data model](data-model.md#migrations)). Operational checks are in the [runbook](operations.md).

## Public DNS

Onboarding owns the proxied Cloudflare record for the hostname; the wildcard certificate in
`swirlit-dev-tls` covers it. Changing `APP_SUBDOMAIN` does not remove the old record. See the
platform's [application DNS ownership](https://github.com/chefzaid/swirl-cloud/blob/main/docs/dns.md#application-dns-ownership).

## High Availability

`infra/overlays/ha/` runs two replicas spread across nodes, with a PodDisruptionBudget and
zero-downtime rolling updates. Sessions, data, rate-limit counters and the geocoder throttle
live in PostgreSQL and migrations serialize on an advisory lock, so replicas are interchangeable.
To enable it,
point the Application's `path` at `infra/overlays/ha` on a multi-node cluster
([platform HA](https://github.com/chefzaid/swirl-cloud/blob/main/docs/guides/high-availability.md)).
