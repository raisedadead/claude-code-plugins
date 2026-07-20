#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WRITE="$SCRIPT_DIR/lib-changelog-write.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ds-ship.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

CL="$TMP/CHANGELOG.md"
{
	printf '# Changelog\n\n'
	printf 'Ships in commit-SHA versioning mode.\n\n'
	printf '## 2026-07-07\n\nOld wave. [aaa1111..bbb2222]\n\n### Added\n\n- old thing\n'
} >"$CL"

SEC="$TMP/section.md"
{
	printf '## 2026-07-20\n\nNew wave. [ccc3333..ddd4444]\n\n### Added\n\n- new thing\n'
} >"$SEC"

"$WRITE" "$CL" "$SEC" '[ccc3333..ddd4444]' >/dev/null || fail "insert into existing changelog must exit 0"
head -1 "$CL" | grep -q '^# Changelog$' || fail "preamble first line must survive"
new_line=$(grep -n '^## 2026-07-20$' "$CL" | cut -d: -f1)
old_line=$(grep -n '^## 2026-07-07$' "$CL" | cut -d: -f1)
[[ -n "$new_line" && -n "$old_line" && "$new_line" -lt "$old_line" ]] || fail "new section must land before the first existing section"
grep -q 'old thing' "$CL" || fail "existing sections must survive"

before="$(cat "$CL")"
rc=0
"$WRITE" "$CL" "$SEC" '[ccc3333..ddd4444]' 2>/dev/null || rc=$?
[[ "$rc" -eq 3 ]] || fail "duplicate range-cite key must exit 3 (got $rc)"
[[ "$before" == "$(cat "$CL")" ]] || fail "refused write must leave changelog byte-identical"

CL2="$TMP/EMPTY.md"
printf '# Changelog\n\nPreamble only.\n' >"$CL2"
"$WRITE" "$CL2" "$SEC" '[ccc3333..ddd4444]' >/dev/null || fail "append into heading-less changelog must exit 0"
grep -q '^## 2026-07-20$' "$CL2" || fail "section must append when no headings exist"

rc=0
"$WRITE" "$TMP/missing.md" "$SEC" 'k' 2>/dev/null || rc=$?
[[ "$rc" -eq 1 ]] || fail "missing changelog must exit 1 (got $rc)"

rc=0
"$WRITE" "$CL" "$TMP/nosec.md" 'k' 2>/dev/null || rc=$?
[[ "$rc" -eq 64 ]] || fail "missing section file must exit 64 (got $rc)"

SHIP="$SCRIPT_DIR/../skills/ship/SKILL.md"
[[ -f "$SHIP" ]] || fail "ship skill must exist"
grep -q 'cat-file' "$SHIP" || fail "ship must resolve SHA cites via cat-file, not pathspec-prone log"
grep -qi 'no commit cite' "$SHIP" || fail "ship must bucket non-SHA cites explicitly"
grep -q -- '--changelog' "$SHIP" || fail "ship must support explicit --changelog for multi-changelog repos"
[[ -f "$SCRIPT_DIR/../skills/ship/reference/changelog-mapping.md" ]] || fail "mapping reference must exist"
grep -q 'ds:ship' "$SCRIPT_DIR/../skills/close/SKILL.md" || fail "ds:close must carry the ship advisory"
grep -q 'test_lib_changelog_write.sh' "$SCRIPT_DIR/../../../.github/workflows/ci.yml" || fail "ci must run this test"
grep -q 'lint_skill.py plugins/dossier/skills/grill/SKILL.md plugins/dossier/skills/ship/SKILL.md' "$SCRIPT_DIR/../../../.github/workflows/ci.yml" || fail "ci must lint the ship skill"

printf 'ok\n'
