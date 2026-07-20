#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADAPTERS="$SCRIPT_DIR/../ADAPTERS.md"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

grep -q '| `whetstone` plugin' "$ADAPTERS" || fail "adapter matrix missing whetstone row"
grep -q '^## §whetstone' "$ADAPTERS" || fail "missing §whetstone section"
grep -q 'whetstone:whetstone-doubter' "$ADAPTERS" || fail "detection must name the agent id"
grep -qi 'available agent types' "$ADAPTERS" || fail "detection path must check the session agent list"
grep -q "Agent type .* not found" "$ADAPTERS" || fail "fallback must document the not-found tool-error contract"
grep -qi 'graceful skip' "$ADAPTERS" || fail "absent whetstone must document graceful skip"
grep -qi 'never block' "$ADAPTERS" || fail "absent whetstone must never block the build"

scaffold="$(sed -n '/## Detection scaffold/,/## Non-goals/p' "$ADAPTERS")"
printf '%s' "$scaffold" | grep -q 'whetstone:whetstone-doubter' || fail "step-0 scaffold must include agent-availability check"

grep -q 'test_adapters_whetstone.sh' "$SCRIPT_DIR/../../../.github/workflows/ci.yml" || fail "ci must run this test"

printf 'ok\n'
