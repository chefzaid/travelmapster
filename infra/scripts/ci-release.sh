#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

phase="${1:-all}"

publish_image() {
  : "${APP_VERSION:?APP_VERSION is required}"
  infra/scripts/check-onboarding-revision.sh publish
  infra/scripts/ci-container-build.sh publish
}

publish_release() {
  : "${APP_VERSION:?APP_VERSION is required}"
  infra/scripts/check-onboarding-revision.sh publish

  git fetch origin "$CI_DEFAULT_BRANCH"
  test "$CI_COMMIT_SHA" = "$(git rev-parse "origin/$CI_DEFAULT_BRANCH")"
  git checkout -B "$CI_DEFAULT_BRANCH" "origin/$CI_DEFAULT_BRANCH"
  infra/scripts/set-project-version.sh "$APP_VERSION"
  infra/scripts/set-image-tags.sh "$APP_VERSION"
  git config user.name "TravelMapster GitLab CI"
  git config user.email "gitlab-ci@swirlit.dev"
  git add VERSION package.json package-lock.json infra/k8s/kustomization.yaml
  git commit -m "release: $APP_VERSION [skip ci]"
  release_revision="$(git rev-parse HEAD)"
  release_tag="v$APP_VERSION"
  git tag --annotate "$release_tag" --message "TravelMapster $APP_VERSION"

  major="${APP_VERSION%%.*}"
  remainder="${APP_VERSION#*.}"
  minor="${remainder%%.*}"
  next_version="$major.$((minor + 1)).0"
  infra/scripts/set-project-version.sh "$next_version"
  git add VERSION package.json package-lock.json
  infra/scripts/commit-deployment.sh "chore: prepare $next_version [skip ci]"
  deploy_revision="$(git rev-parse HEAD)"
  git push origin "HEAD:$CI_DEFAULT_BRANCH" "refs/tags/$release_tag"
  printf 'APP_VERSION=%s\nDEPLOY_REVISION=%s\nRELEASE_REVISION=%s\nRELEASE_TAG=%s\nNEXT_VERSION=%s\n' \
    "$APP_VERSION" "$deploy_revision" "$release_revision" "$release_tag" "$next_version" > release.env

  release_json="$(jq -n --arg tag "$release_tag" --arg name "TravelMapster $APP_VERSION" \
    --arg description "Published TravelMapster release $APP_VERSION for deployment through Argo CD." \
    '{tag_name:$tag,name:$name,description:$description}')"
  curl --fail --show-error --silent --request POST --header "JOB-TOKEN: $CI_JOB_TOKEN" \
    --header 'Content-Type: application/json' --data "$release_json" \
    "$CI_API_V4_URL/projects/$CI_PROJECT_ID/releases" >/dev/null
}

smoke_curl() {
  local url="$1" deadline response
  deadline=$(( $(date +%s) + 120 ))
  while true; do
    if response="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "$url")"; then
      printf '%s' "$response"
      return 0
    fi
    [[ "$(date +%s)" -lt "$deadline" ]] || return 1
    printf 'Waiting for smoke-check endpoint %s.\n' "$url" >&2
    sleep 5
  done
}

deploy_release() {
  if [[ -f release.env ]]; then
    # shellcheck disable=SC1091
    source release.env
  fi
  : "${DEPLOY_REVISION:?DEPLOY_REVISION is required}"

  DEPLOY_REVISION="$DEPLOY_REVISION" infra/scripts/check-onboarding-revision.sh deploy
  kubectl apply -f infra/argocd/application.yaml
  kubectl annotate application travelmapster -n infra argocd.argoproj.io/refresh=hard --overwrite
  deadline=$(( $(date +%s) + 900 ))
  revision=''
  sync=''
  health=''
  while [[ "$(date +%s)" -lt "$deadline" ]]; do
    application="$(kubectl get application travelmapster -n infra -o json 2>/dev/null || true)"
    revision="$(jq -r '.status.sync.revision // empty' <<<"$application")"
    sync="$(jq -r '.status.sync.status // empty' <<<"$application")"
    health="$(jq -r '.status.health.status // empty' <<<"$application")"
    printf 'Argo CD: revision=%s sync=%s health=%s\n' "${revision:-unknown}" "${sync:-unknown}" "${health:-unknown}"
    [[ "$revision" == "$DEPLOY_REVISION" && "$sync" == Synced && "$health" == Healthy ]] && break
    sleep 10
  done
  [[ "$revision" == "$DEPLOY_REVISION" && "$sync" == Synced && "$health" == Healthy ]]
  smoke_curl http://travelmapster.apps.svc.cluster.local:3000/readyz >/dev/null
  index="$(smoke_curl http://travelmapster.apps.svc.cluster.local:3000/)"
  grep -Fqi 'travelmapster' <<<"$index"
}

case "$phase" in
  image)
    publish_image
    ;;
  publish)
    publish_release
    ;;
  deploy)
    deploy_release
    ;;
  all)
    publish_image
    publish_release
    deploy_release
    ;;
  *)
    printf 'Usage: %s [image|publish|deploy|all]\n' "$0" >&2
    exit 2
    ;;
esac
