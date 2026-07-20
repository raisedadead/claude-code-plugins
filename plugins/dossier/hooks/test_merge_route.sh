#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD="$SCRIPT_DIR/../skills/build/SKILL.md"
ADAPTERS="$SCRIPT_DIR/../ADAPTERS.md"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

grep -q 'whetstone:merge-resolve' "$BUILD" || fail "build SKILL must route merge conflicts to merge-resolve"
grep -q 'verify_clean' "$BUILD" || fail "build SKILL must cite the verify_clean proof"
grep -q 'conflict=resolved-inline' "$BUILD" || fail "absent whetstone must resolve inline with §S note"
grep -qi 'rebase.*cherry-pick\|cherry-pick.*rebase' "$BUILD" || fail "build SKILL must scope rebase/cherry-pick out of the route"
grep -q 'whetstone:merge-resolve' "$ADAPTERS" || fail "ADAPTERS must document the merge-resolve skill route"
grep -qi 'merge-class only\|plain .git merge.' "$ADAPTERS" || fail "ADAPTERS must record the merge-only scope"

grep -q 'test_merge_route.sh' "$SCRIPT_DIR/../../../.github/workflows/ci.yml" || fail "ci must run this test"

printf 'ok\n'
