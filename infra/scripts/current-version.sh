#!/bin/sh
set -eu

repository_root="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)"
revision="${CI_COMMIT_SHA:-HEAD}"
if git -C "$repository_root" cat-file -e "$revision:VERSION" 2>/dev/null; then
  base_version="$(git -C "$repository_root" show "$revision:VERSION")"
  anchor="$(git -C "$repository_root" log -1 --format=%H "$revision" -- VERSION)"
else
  base_version="$(cat "$repository_root/VERSION")"
  anchor="$(git -C "$repository_root" rev-parse "$revision")"
fi

case "$base_version" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "VERSION must contain a numeric semantic version, got: $base_version" >&2; exit 1 ;;
esac

major="${base_version%%.*}"
remainder="${base_version#*.}"
minor="${remainder%%.*}"
patch="${remainder##*.}"
for component in "$major" "$minor" "$patch"; do
  case "$component" in
    ''|*[!0-9]*|0[0-9]*) echo "VERSION must contain a canonical semantic version, got: $base_version" >&2; exit 1 ;;
  esac
done

test -n "$anchor" || {
  echo "Unable to find the VERSION baseline commit" >&2
  exit 1
}
commit_increment="$(git -C "$repository_root" rev-list --count --first-parent "$anchor..$revision")"
printf '%s.%s.%s\n' "$major" "$minor" "$((patch + commit_increment))"
