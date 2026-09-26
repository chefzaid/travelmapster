#!/usr/bin/env bash
set -euo pipefail

[[ "${APP_ONBOARDING:-false}" == true ]] || exit 0
phase="${1:?Expected build, publish or deploy}"
fail() { printf 'Onboarding revision check failed: %s\n' "$*" >&2; exit 1; }

[[ "${CI_PIPELINE_SOURCE:-}" == api && "${SONAR_SCAN_ONLY:-false}" != true &&
   -n "${CI_DEFAULT_BRANCH:-}" && "${CI_COMMIT_BRANCH:-}" == "$CI_DEFAULT_BRANCH" ]] ||
  fail 'Only an explicit API onboarding pipeline on the default branch may activate onboarding.'
[[ "${ONBOARDING_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ &&
   "${CI_COMMIT_SHA:-}" == "$ONBOARDING_EXPECTED_SHA" ]] ||
  fail 'The pipeline must match the exact configured and pushed onboarding commit.'

git fetch --quiet --no-tags origin "$CI_DEFAULT_BRANCH"
remote_revision="$(git rev-parse "refs/remotes/origin/$CI_DEFAULT_BRANCH")"
case "$phase" in
  build|publish)
    [[ "$(git rev-parse HEAD)" == "$ONBOARDING_EXPECTED_SHA" &&
       "$remote_revision" == "$ONBOARDING_EXPECTED_SHA" ]] ||
      fail 'The repository moved before publication. If this pipeline already pushed its marked release, repair its failed publication step before retrying deployment; otherwise rerun onboarding.'
    ;;
  deploy)
    [[ "${DEPLOY_REVISION:-}" =~ ^[0-9a-f]{40}$ &&
       "$remote_revision" == "$DEPLOY_REVISION" ]] ||
      fail 'The released revision is no longer the default branch tip.'
    git merge-base --is-ancestor "$ONBOARDING_EXPECTED_SHA" "$DEPLOY_REVISION" ||
      fail 'The release does not descend from the configured onboarding commit.'
    ;;
  *) fail 'Expected build, publish or deploy.' ;;
esac
