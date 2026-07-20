#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD="$SCRIPT_DIR/../skills/build/SKILL.md"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

grep -qi 'identical failure twice\|same failure twice' "$BUILD" || fail "stall rule: identical failure twice must trigger strategy change"
grep -qi 'strategy' "$BUILD" || fail "stall rule must demand a strategy change, not a retry"
grep -qi 'clean landing' "$BUILD" || fail "budget ceiling must land clean"
grep -qi 'commit.*WIP\|WIP.*commit' "$BUILD" || fail "clean landing must commit WIP with handoff note"
grep -qi 'fresh context\|fresh session' "$BUILD" || fail "reset-don't-patch must route to fresh context"
grep -q 'ds:roll' "$BUILD" || fail "reset route must point at ds:roll persistence"

grep -q 'test_loop_rails.sh' "$SCRIPT_DIR/../../../.github/workflows/ci.yml" || fail "ci must run this test"

printf 'ok\n'
