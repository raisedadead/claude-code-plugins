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

rc=0
"$ASSERT" "$TMP" alpha 2>/dev/null || rc=$?
[[ "$rc" -eq 1 ]] || fail "missing artifact must exit 1 (got $rc)"

{
	printf 'FACT: repo uses bash tests cite=ci.yml\n'
	printf 'DECISION: scope recommended=narrow answer=narrow\n'
} >"$GRILL_DIR/2026-07-18-alpha.md"
rc=0
"$ASSERT" "$TMP" alpha 2>/dev/null || rc=$?
[[ "$rc" -eq 2 ]] || fail "artifact without footers must exit 2 (got $rc)"

printf 'FRONTIER: empty-except-external\n' >>"$GRILL_DIR/2026-07-18-alpha.md"
rc=0
"$ASSERT" "$TMP" alpha 2>/dev/null || rc=$?
[[ "$rc" -eq 2 ]] || fail "empty-except-external without n= must exit 2 (got $rc)"

printf 'FRONTIER: empty\nCONFIRMED: 2026-07-20T19:00:00Z operator="ship it"\n' >>"$GRILL_DIR/2026-07-18-alpha.md"
out="$("$ASSERT" "$TMP" alpha)" || fail "complete artifact found across dates must exit 0"
[[ "$out" == "$GRILL_DIR/2026-07-18-alpha.md" ]] || fail "must print resolved artifact path"

{
	printf 'DECISION: budget recommended=ask-cfo answer=pending-external\n'
	printf 'FRONTIER: empty-except-external n=1\n'
	printf 'CONFIRMED: 2026-07-20T19:05:00Z operator="proceed without cfo"\n'
} >"$GRILL_DIR/2026-07-19-beta.md"
"$ASSERT" "$TMP" beta >/dev/null || fail "empty-except-external n=1 + CONFIRMED must exit 0"

{
	printf 'FRONTIER: empty\n'
	printf 'CONFIRMED: 2026-07-20T20:00:00Z operator="go"\n'
} >"$GRILL_DIR/2026-07-20-alpha.md"
out="$("$ASSERT" "$TMP" alpha)" || fail "two artifacts same slug must still exit 0"
[[ "$out" == "$GRILL_DIR/2026-07-20-alpha.md" ]] || fail "must resolve newest artifact by date"

"$ASSERT" --consume "$TMP" alpha "2026-07-20-alpha" >/dev/null || fail "consume on complete artifact must exit 0"
grep -q '^CONSUMED: 2026-07-20-alpha$' "$GRILL_DIR/2026-07-20-alpha.md" || fail "consume must stamp the dossier dir key"
rc=0
"$ASSERT" --consume "$TMP" alpha "2026-07-20-alpha-again" 2>/dev/null || rc=$?
[[ "$rc" -eq 4 ]] || fail "double consume must exit 4 (got $rc)"
rc=0
"$ASSERT" "$TMP" alpha 2>/dev/null || rc=$?
[[ "$rc" -eq 4 ]] || fail "consumed newest must exit 4, never fall back to older (got $rc)"

rc=0
"$ASSERT" "$TMP" alpha-2 2>/dev/null || rc=$?
[[ "$rc" -eq 1 ]] || fail "bumped slug must not inherit base-slug artifact (got $rc)"

grep -q 'lib-assert-grill.sh' "$SCRIPT_DIR/../skills/new/SKILL.md" || fail "ds:new must wire the grill gate"
grep -q 'ds:grill' "$SCRIPT_DIR/../skills/new/SKILL.md" || fail "ds:new must point at ds:grill"
grep -q -- '--consume' "$SCRIPT_DIR/../skills/new/SKILL.md" || fail "ds:new must stamp consumption via the helper"
[[ -f "$SCRIPT_DIR/../skills/grill/SKILL.md" ]] || fail "grill skill must exist"
grep -q 'test_lib_assert_grill.sh' "$SCRIPT_DIR/../../../.github/workflows/ci.yml" || fail "ci must run this test"
grep -q 'lint_skill.py plugins/dossier/skills/grill' "$SCRIPT_DIR/../../../.github/workflows/ci.yml" || fail "ci must lint the grill skill"

printf 'ok\n'
