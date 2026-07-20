#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSERT="$SCRIPT_DIR/lib-assert-grill.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ds-grill.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

GRILL_DIR="$TMP/dossier/.grill"
mkdir -p "$GRILL_DIR"

if "$ASSERT" "$TMP" "2026-07-20-alpha" 2>/dev/null; then fail "missing artifact must exit non-zero"; fi

{
	printf 'FACT: repo uses bash tests cite=ci.yml\n'
	printf 'DECISION: scope recommended=narrow answer=narrow\n'
} >"$GRILL_DIR/2026-07-20-alpha.md"
if "$ASSERT" "$TMP" "2026-07-20-alpha" 2>/dev/null; then fail "artifact without footers must exit non-zero"; fi

printf 'FRONTIER: empty\n' >>"$GRILL_DIR/2026-07-20-alpha.md"
if "$ASSERT" "$TMP" "2026-07-20-alpha" 2>/dev/null; then fail "artifact without CONFIRMED must exit non-zero"; fi

printf 'CONFIRMED: 2026-07-20T19:00:00Z operator="ship it"\n' >>"$GRILL_DIR/2026-07-20-alpha.md"
"$ASSERT" "$TMP" "2026-07-20-alpha" >/dev/null || fail "complete artifact must exit 0"

{
	printf 'DECISION: budget recommended=ask-cfo answer=pending-external\n'
	printf 'FRONTIER: empty-except-external n=1\n'
	printf 'CONFIRMED: 2026-07-20T19:05:00Z operator="proceed without cfo"\n'
} >"$GRILL_DIR/2026-07-20-beta.md"
"$ASSERT" "$TMP" "2026-07-20-beta" >/dev/null || fail "empty-except-external + CONFIRMED must exit 0"

if "$ASSERT" "$TMP" "2026-07-21-alpha" 2>/dev/null; then fail "different date key must not match prior artifact"; fi

grep -q 'lib-assert-grill.sh' "$SCRIPT_DIR/../skills/new/SKILL.md" || fail "ds:new must wire the grill gate"
grep -q 'ds:grill' "$SCRIPT_DIR/../skills/new/SKILL.md" || fail "ds:new must point at ds:grill"
[[ -f "$SCRIPT_DIR/../skills/grill/SKILL.md" ]] || fail "grill skill must exist"
grep -q 'test_lib_assert_grill.sh' "$SCRIPT_DIR/../../../.github/workflows/ci.yml" || fail "ci must run this test"
grep -q 'lint_skill.py plugins/dossier/skills/grill' "$SCRIPT_DIR/../../../.github/workflows/ci.yml" || fail "ci must lint the grill skill"

printf 'ok\n'
