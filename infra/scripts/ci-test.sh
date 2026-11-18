#!/usr/bin/env bash
# Runs one suite of the parallel 01-test jobs, or joins their coverage (03-coverage).
# Together they run what `npm run lint`, `npm run typecheck`, `npm run test:coverage` and
# `npm audit --omit=dev --audit-level=high` run one after the other.
#
#   infra/scripts/ci-test.sh lint|typecheck|audit|unit|integration-<n>|coverage
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

suite="${1:?Usage: $0 lint|typecheck|audit|unit|integration-<n>|coverage}"

# node:test sizes its pool from os.availableParallelism(), which counts the node's threads,
# not the job's CPU limit, so the pool is capped at the CPUs the job may use.
cpus="${KUBERNETES_CPU_LIMIT:-4}"
case "$cpus" in
  '' | *[!0-9]*) cpus=4 ;;
esac

# The same coverage options as the test:coverage script in package.json. Each suite writes its
# own report; 03-coverage joins them and checks the threshold over all of them.
run_with_coverage() {
  local report="coverage/$1"
  shift
  mkdir -p "$report"
  node --test --experimental-test-coverage \
    --test-coverage-include="src/**" --test-coverage-include="public/js/**" \
    --test-reporter=spec --test-reporter-destination=stdout \
    --test-reporter=lcov --test-reporter-destination="$report/lcov.info" \
    "$@"
}

case "$suite" in
  lint)
    npm run lint
    ;;
  typecheck)
    npm run typecheck
    ;;
  audit)
    npm audit --omit=dev --audit-level=high
    ;;
  unit)
    # No database, ports or shared files: the files run side by side.
    run_with_coverage unit --test-concurrency="$cpus" "test/*.test.js" "test/unit/**/*.test.js"
    ;;
  integration-*)
    : "${INTEGRATION_SHARDS:?INTEGRATION_SHARDS is required}"
    shard="${suite#integration-}"
    case "$shard" in
      '' | *[!0-9]*)
        echo "Unknown suite: $suite" >&2
        exit 2
        ;;
    esac
    # Every file drops and recreates the public schema of the one test database, so the files
    # of a shard run one at a time. The shards are separate jobs, each with its own PostgreSQL.
    run_with_coverage "$suite" --test-concurrency=1 --test-shard="$shard/$INTEGRATION_SHARDS" \
      "test/integration/**/*.test.js"
    ;;
  coverage)
    : "${INTEGRATION_SHARDS:?INTEGRATION_SHARDS is required}"
    reports=(coverage/unit/lcov.info)
    for shard in $(seq 1 "$INTEGRATION_SHARDS"); do
      reports+=("coverage/integration-$shard/lcov.info")
    done
    node scripts/merge-coverage.js coverage/lcov.info "${reports[@]}"
    ;;
  *)
    echo "Unknown suite: $suite" >&2
    exit 2
    ;;
esac
