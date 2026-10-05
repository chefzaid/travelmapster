#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

mode="${1:-verify}"
: "${APP_VERSION:?APP_VERSION is required}"
: "${REGISTRY_PUSH_HOST:?REGISTRY_PUSH_HOST is required}"
: "${KANIKO_EXECUTOR:?KANIKO_EXECUTOR is required}"

case "$mode" in
  verify)
    ;;
  publish)
    : "${CI_REGISTRY_USER:?CI_REGISTRY_USER is required}"
    : "${CI_REGISTRY_PASSWORD:?CI_REGISTRY_PASSWORD is required}"
    mkdir -p /kaniko/.docker
    jq -n --arg registry "$REGISTRY_PUSH_HOST" --arg username "$CI_REGISTRY_USER" \
      --arg password "$CI_REGISTRY_PASSWORD" \
      '{auths:{($registry):{username:$username,password:$password}}}' \
      > /kaniko/.docker/config.json
    export DOCKER_CONFIG=/kaniko/.docker
    ;;
  *)
    printf 'Usage: %s [verify|publish]\n' "$0" >&2
    exit 2
    ;;
esac

repository="$REGISTRY_PUSH_HOST/$CI_PROJECT_PATH/travelmapster"
options=(
  --context "dir://$repository_root"
  --dockerfile "$repository_root/Dockerfile"
  --destination "$repository:$APP_VERSION"
  --insecure-registry "$REGISTRY_PUSH_HOST"
  --label "org.opencontainers.image.version=$APP_VERSION"
  --label "org.opencontainers.image.revision=${CI_COMMIT_SHA:-unknown}"
  --build-arg "SECURITY_UPDATES_REFRESH=${CI_PIPELINE_ID:-$(date -u +%s)}"
)
if [[ "$mode" == publish ]]; then
  options+=(--cache=true --cache-repo "$repository/cache" --cache-ttl=720h)
else
  options+=(--no-push --cache=false)
fi
"$KANIKO_EXECUTOR" "${options[@]}"
