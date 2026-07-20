#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD="$SCRIPT_DIR/../skills/build/SKILL.md"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

grep -q -- '--doubt' "$BUILD" || fail "inputs must document --doubt flag"
grep -qi 'auto.*design-class' "$BUILD" || fail "doubt must auto-fire on design-class tasks without a flag"
grep -q 'design-class.*(' "$BUILD" || fail "design-class must be defined with a concrete keyword list"
grep -q '§whetstone' "$BUILD" || fail "gate must route through ADAPTERS §whetstone availability check"
grep -q 'whetstone:whetstone-doubter' "$BUILD" || fail "gate must name the doubter agent id"
grep -q 'doubt=skipped-absent' "$BUILD" || fail "absent whetstone must log doubt=skipped-absent and continue"
grep -q 'DOUBT: FAILURES | NO FAILURE FOUND' "$BUILD" || fail "verdict contract must be documented"
grep -qi 'one doubt cycle' "$BUILD" || fail "doubt cycle cap must be documented"

grep -q 'test_build_doubt_gate.sh' "$SCRIPT_DIR/../../../.github/workflows/ci.yml" || fail "ci must run this test"

printf 'ok\n'
