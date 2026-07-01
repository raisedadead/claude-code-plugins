#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$SCRIPT_DIR/marker_guard.py"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-marker-guard.XXXXXX")"

cleanup() {
	rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

guard() {
	local tool="$1" path="$2" content="$3"
	python3 -c '
import json, sys
tool, path, content = sys.argv[1], sys.argv[2], sys.argv[3]
key = "content" if tool == "Write" else "new_string"
print(json.dumps({"tool_name": tool, "tool_input": {"file_path": path, key: content}}))
' "$tool" "$path" "$content" |
		CLAUDE_PROJECT_DIR="$TMP" python3 "$GUARD" >"$TMP/out" 2>"$TMP/err" && rc=0 || rc=$?
}

advises() {
	grep -q "additionalContext" "$TMP/out"
}

cd "$TMP"

guard Edit "src/foo.ts" "// PH3-B7: known-bug guard"
[ "$rc" -eq 0 ] || fail "audit-id PH3-B7 must exit 0 (advisory, never block)"
advises || fail "audit-id PH3-B7 should emit an advisory"
grep -q '"hookEventName": "PreToolUse"' "$TMP/out" || fail "advisory must be a PreToolUse hookSpecificOutput"

guard Edit "src/foo.py" "# PH12-A1: invariant"
[ "$rc" -eq 0 ] || fail "audit-id PH12-A1 must exit 0"
advises || fail "audit-id PH12-A1 should advise"

guard Edit "src/foo.ts" "// Phase 1: validate input"
[ "$rc" -eq 0 ] || fail "bare Phase 1 must exit 0"
! advises || fail "bare 'Phase 1:' must NOT advise (narrowed regex)"

guard Write "k8s/backup-cronjob.yaml" "          # Step 1: dump the database"
[ "$rc" -eq 0 ] || fail "infra Step 1 comment must exit 0"
! advises || fail "'# Step 1: dump' must NOT advise (the artemis regression)"

guard Edit "ci.yaml" "# Stage 3: integration tests"
! advises || fail "'Stage 3' must NOT advise"

guard Edit "src/foo.test.ts" "// V11 (Phase 3 / A7): SSR banner"
! advises || fail "'V11 (Phase 3 / A7)' must NOT advise (no PH-audit-id form)"

guard Edit "src/foo.ts" "// workaround for upstream bug #1234"
! advises || fail "clean why-comment must NOT advise"

guard Write ".scratchpad/dossier/2026-01-01-foo/DOSSIER.md" "| B1 | bug | PH3-B7 | open |"
! advises || fail "DOSSIER.md ledger may carry audit ids without advisory"

DOSSIER_MARKER_GUARD=off guard Edit "src/foo.ts" "// PH3-B7: bypass"
! advises || fail "DOSSIER_MARKER_GUARD=off should suppress the advisory"

python3 -c '
import json
print(json.dumps({
    "tool_name": "MultiEdit",
    "tool_input": {"file_path": "src/foo.ts", "edits": [
        {"old_string": "a", "new_string": "// safe rename"},
        {"old_string": "b", "new_string": "// PH4-A1: extract"},
    ]},
}))
' | CLAUDE_PROJECT_DIR="$TMP" python3 "$GUARD" >"$TMP/out" 2>"$TMP/err" || fail "MultiEdit must exit 0"
grep -q "additionalContext" "$TMP/out" || fail "MultiEdit with PH-form chunk should advise"

printf '{"tool_name":"Bash","tool_input":{"command":"echo PH3-B7"}}\n' |
	CLAUDE_PROJECT_DIR="$TMP" python3 "$GUARD" >"$TMP/out" 2>"$TMP/err" || fail "non-Edit tool must exit 0"
! grep -q "additionalContext" "$TMP/out" || fail "non-Edit tool must be ignored"

DOSS=".scratchpad/dossier/2026-01-01-foo/DOSSIER.md"
guard Write "$DOSS" '`2026-01-01` · `sealed` · `P1/1`'
[ "$rc" -eq 2 ] || fail "non-canonical header token 'sealed' must block (exit 2, got $rc)"
grep -q 'non-canonical header' "$TMP/err" || fail "header block must explain on stderr"

guard Write "$DOSS" '`2026-01-01` · `live` · `P1/1`'
[ "$rc" -eq 0 ] || fail "canonical header token 'live' must pass (got $rc)"

guard Edit "$DOSS" '2026-01-01 10:00 ds:build T1 START'
[ "$rc" -eq 0 ] || fail "a normal §S edit (no header line) must not block"

guard Edit "src/app.ts" '`const` · `x` · `y`'
[ "$rc" -eq 0 ] || fail "header-shaped line in a non-DOSSIER file must not block"

guard Edit "$DOSS" '`lib-regen-index.sh` emits `drift!` not a live state'
[ "$rc" -eq 0 ] || fail "inline-code prose naming a state must NOT block (no date/middot header shape)"

guard Edit "$DOSS" '- `drift!` is a derived sentinel · never a header token'
[ "$rc" -eq 0 ] || fail "prose with a middot but no date-led backtick field must not block"

printf '["not","a","dict"]\n' |
	CLAUDE_PROJECT_DIR="$TMP" python3 "$GUARD" >"$TMP/out" 2>"$TMP/err" || fail "JSON array stdin must exit 0 (dict guard)"

printf 'ok\n'
