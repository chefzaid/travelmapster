#!/usr/bin/env bash
# Mark onboarding publications so an interrupted operator can identify their release.
set -euo pipefail
: "${1:?A deployment commit message is required}"
arguments=(-m "$1")
if [[ "${APP_ONBOARDING:-false}" == true ]]; then
  [[ "${CI_PIPELINE_ID:-}" =~ ^[0-9]+$ && "${CI_COMMIT_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || {
    echo 'Onboarding publication requires its pipeline ID and source revision' >&2
    exit 1
  }
  arguments+=(--allow-empty
    --trailer "Onboarding-Pipeline: $CI_PIPELINE_ID"
    --trailer "Onboarding-Source: $CI_COMMIT_SHA")
fi
git commit "${arguments[@]}"
