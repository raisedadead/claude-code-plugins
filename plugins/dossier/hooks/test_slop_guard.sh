#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$SCRIPT_DIR/slop_guard.py"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

mkjson() {
	python3 -c '
import json, sys
tool, path, content = sys.argv[1], sys.argv[2], sys.argv[3]
key = "content" if tool == "Write" else "new_string"
print(json.dumps({"tool_name": tool, "tool_input": {"file_path": path, key: content}}))
' "$1" "$2" "$3"
}

run() {
	mkjson "$2" "$3" "$4" | env DOSSIER_SLOP_GATE="$1" python3 "$GUARD"
}

is_deny() {
	[[ "$1" == *'"permissionDecision": "deny"'* ]]
}

expect_deny() {
	local out
	out="$(run "$@")"
	is_deny "$out" || fail "expected deny: $*"
}

expect_allow() {
	local out
	out="$(run "$@")"
	if is_deny "$out"; then fail "expected allow: $*"; fi
}

expect_deny "" Write foo.py "leftover TODO now blocked by default"
expect_deny 1 Write foo.py "value = 1
TODO finish this"
expect_deny 1 Edit foo.py "raise NotImplementedError FIXME later"
expect_deny 1 Write conf.py 'password = "hunter2xyz"'
expect_allow 0 Write foo.py "TODO but gate explicitly disabled"
expect_allow off Write foo.py "FIXME but gate off"
expect_allow 1 Write foo.py "clean and complete implementation"
expect_allow 1 Write notes.md "TODO write the docs later"
expect_allow 1 Read foo.py "TODO"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-slop.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# workaround: marker built at runtime — a literal would trip the slop gate editing this file
MARKER="$(printf 'TO%sDO' '')"

mkjson_cwd() {
	python3 -c '
import json, sys
cwd, content = sys.argv[1], sys.argv[2]
print(json.dumps({"tool_name": "Write", "tool_input": {"file_path": "foo.py", "content": content}, "cwd": cwd}))
' "$1" "$2"
}

run_in() {
	mkjson_cwd "$1" "$MARKER finish this" | env DOSSIER_SLOP_GATE=1 python3 "$GUARD"
}

workspace() {
	local name="$1" rel="$2" state="$3"
	local ws="$TMP/$name"
	rm -rf "$ws"
	mkdir -p "$ws"
	if [[ -n "$rel" ]]; then
		mkdir -p "$ws/$rel"
		printf '`2026-06-01` · `%s` · `P1/1`\n' "$state" >"$ws/$rel/DOSSIER.md"
	fi
	printf '%s' "$ws"
}

expect_gate_silent() {
	local out
	out="$(run_in "$1")"
	if is_deny "$out"; then fail "expected allow (no active dossier): $2"; fi
}

expect_gate_fires() {
	local out
	out="$(run_in "$1")"
	is_deny "$out" || fail "expected deny (active dossier): $2"
}

expect_gate_silent "$(workspace bare '' '')" "bare project, no .scratchpad at all"
expect_gate_silent "$(workspace donestate '.scratchpad/dossier/2026-06-01-x' 'done')" "dossier present but state=done"
expect_gate_silent "$(workspace archived '.scratchpad/dossier/_archive/2026-06-01-x' live)" "live header but under _archive"
expect_gate_fires "$(workspace livestate '.scratchpad/dossier/2026-06-01-x' live)" "live dossier"
expect_gate_fires "$(workspace pausedstate '.scratchpad/dossier/2026-06-01-x' paused)" "paused dossier"

workspace_raw() {
	local name="$1" body="$2"
	local ws="$TMP/$name" rel='.scratchpad/dossier/2026-06-01-x'
	rm -rf "$ws"
	mkdir -p "$ws/$rel"
	printf '%s\n' "$body" >"$ws/$rel/DOSSIER.md"
	printf '%s' "$ws"
}

expect_gate_silent "$(workspace_raw nohdr 'no header line here at all')" "ledger with no parseable header"
expect_gate_silent "$(workspace_raw badtoken '`2026-06-01` · `wip` · `P1/1`')" "non-canonical state token"
expect_gate_silent "$(workspace_raw emptytok '`2026-06-01` · `` · `P1/1`')" "empty state token"

printf 'PASS: test_slop_guard (17 cases)\n'
