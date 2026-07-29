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

printf 'PASS: test_slop_guard (9 cases)\n'
