#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

version="${1:-}"
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
  echo "Usage: $0 <major.minor.patch>" >&2
  exit 2
}

printf '%s\n' "$version" > VERSION
npm version "$version" --no-git-tag-version --allow-same-version >/dev/null
