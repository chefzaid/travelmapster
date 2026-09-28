# ADR 0006: Deliver Through GitLab CI And Argo CD With Explicit Release Jobs

- Status: Accepted
- Date: 2026-09-27

## Context

swirl-cloud provides GitLab, its registry, Argo CD and Vault, and onboards applications through a
declarative contract. Releases should be deliberate, reproducible and verified in the cluster.

## Decision

Follow onboarding contract version 1: one Argo CD Application in `infra` deploys `infra/k8s` to
`apps`, with secrets from Vault. GitLab jobs have explicit, ordered names: `01-test` and
`02-package` guard every branch; `01-quality` (Sonar) and `02-security` (Trivy) report without
blocking; on `main`, the confirmed `00-image` job publishes the image with Kaniko, `01-release`
commits the image tag and tags the version, and `02-deploy` waits for Argo CD and smoke-tests.
Image publishing is separate because Kaniko's multi-stage build replaces the job container's
filesystem, removing the Git and npm tooling the release step needs. See the
[delivery flow](../deployment.md#delivery-flow).

## Consequences

- Each step has its own status, log and retry; findings stay visible without gating releases.
- Git is the deployment record: the image tag in `kustomization.yaml` is what runs, and
  rollback is a commit.
- Argo CD tracks `main`, so manifest changes apply on merge while images wait for a release.
