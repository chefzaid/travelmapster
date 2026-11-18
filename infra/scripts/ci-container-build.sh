#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

mode="${1:-verify}"
: "${APP_VERSION:?APP_VERSION is required}"
: "${REGISTRY_PUSH_HOST:?REGISTRY_PUSH_HOST is required}"
: "${KANIKO_EXECUTOR:?KANIKO_EXECUTOR is required}"

# Registry credentials for Kaniko, gathered here and written once below; never printed.
auths='{}'
add_auth() {
  auths="$(jq -c --arg registry "$1" --arg username "$2" --arg password "$3" \
    '.[$registry] = {username: $username, password: $password}' <<<"$auths")"
}

# Docker Hub base images come through the GitLab group's Dependency Proxy, which avoids
# Docker Hub's anonymous pull limit; Kaniko falls back to Docker Hub if the mirror fails.
# The proxy answers on its server name with and without :443.
mirror_options=()
if [[ -n "${CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX:-}" && -n "${CI_DEPENDENCY_PROXY_SERVER:-}" &&
      -n "${CI_DEPENDENCY_PROXY_USER:-}" && -n "${CI_DEPENDENCY_PROXY_PASSWORD:-}" ]]; then
  mirror_options+=(--registry-mirror "$CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX")
  add_auth "$CI_DEPENDENCY_PROXY_SERVER" "$CI_DEPENDENCY_PROXY_USER" "$CI_DEPENDENCY_PROXY_PASSWORD"
  add_auth "${CI_DEPENDENCY_PROXY_SERVER%:443}" "$CI_DEPENDENCY_PROXY_USER" "$CI_DEPENDENCY_PROXY_PASSWORD"
fi

case "$mode" in
  verify)
    ;;
  publish)
    : "${CI_REGISTRY_USER:?CI_REGISTRY_USER is required}"
    : "${CI_REGISTRY_PASSWORD:?CI_REGISTRY_PASSWORD is required}"
    add_auth "$REGISTRY_PUSH_HOST" "$CI_REGISTRY_USER" "$CI_REGISTRY_PASSWORD"
    ;;
  *)
    printf 'Usage: %s [verify|publish]\n' "$0" >&2
    exit 2
    ;;
esac

if [[ "$auths" != '{}' ]]; then
  mkdir -p /kaniko/.docker
  (umask 077 && jq '{auths: .}' <<<"$auths" > /kaniko/.docker/config.json)
  export DOCKER_CONFIG=/kaniko/.docker
fi

repository="$REGISTRY_PUSH_HOST/$CI_PROJECT_PATH/travelmapster"
options=(
  --context "dir://$repository_root"
  --dockerfile "$repository_root/Dockerfile"
  --destination "$repository:$APP_VERSION"
  --insecure-registry "$REGISTRY_PUSH_HOST"
  --label "org.opencontainers.image.version=$APP_VERSION"
  --label "org.opencontainers.image.revision=${CI_COMMIT_SHA:-unknown}"
  --build-arg "SECURITY_UPDATES_REFRESH=${CI_PIPELINE_ID:-$(date -u +%s)}"
  "${mirror_options[@]}"
)
if [[ "$mode" == publish ]]; then
  options+=(--cache=true --cache-repo "$repository/cache" --cache-ttl=720h)
else
  options+=(--no-push --cache=false)
fi
"$KANIKO_EXECUTOR" "${options[@]}"
