#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/session-start.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-session-start.XXXXXX")"
WS="$TMP/ws"

cleanup() {
	rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

scaffold() {
	local slug="$1"
	mkdir -p "$WS/.scratchpad/dossier/$slug"
	cat >"$WS/.scratchpad/dossier/$slug/DOSSIER.md" <<'EOF'
`goal` · `repo` · `live`

## §T

| T1 | P1 | . | do thing | — | — |

## §S

started
EOF
}

run_hook() {
	local payload="$1" benv="${2:-}"
	printf '%s' "$payload" |
		(cd "$WS" && BASH_ENV="$benv" CLAUDE_PLUGIN_ROOT="$SCRIPT_DIR/.." "$HOOK") >"$TMP/out" 2>"$TMP/err" && rc=0 || rc=$?
}

title_of() {
	python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
print(d.get("hookSpecificOutput", {}).get("sessionTitle", ""))
' "$TMP/out"
}

assert_valid_json() {
	python3 -c 'import json, sys; json.load(open(sys.argv[1]))' "$TMP/out" ||
		fail "$1: output must be valid JSON"
}

scaffold "2026-06-05-foo"

run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}'
[ "$rc" -eq 0 ] || fail "startup must exit 0"
assert_valid_json "startup"
[ "$(title_of)" = "2026-06-05-foo" ] || fail "startup + empty title + live dossier must emit slug as sessionTitle"
grep -q "additionalContext" "$TMP/out" || fail "sessionTitle must not displace additionalContext"

run_hook '{"hook_event_name":"SessionStart","source":"resume","session_title":""}'
[ "$(title_of)" = "2026-06-05-foo" ] || fail "resume + empty title must emit sessionTitle"

run_hook '{"hook_event_name":"SessionStart","source":"resume","session_title":"user-set"}'
[ -z "$(title_of)" ] || fail "non-empty session_title must never be clobbered"

run_hook '{"hook_event_name":"SessionStart","source":"clear","session_title":""}'
[ -z "$(title_of)" ] || fail "clear source must not emit sessionTitle"

run_hook '{"hook_event_name":"SessionStart","source":"compact","session_title":""}'
[ -z "$(title_of)" ] || fail "compact source must not emit sessionTitle"

run_hook 'not json at all'
[ "$rc" -eq 0 ] || fail "malformed stdin must exit 0 (fail open)"
assert_valid_json "malformed-stdin"
[ -z "$(title_of)" ] || fail "malformed stdin must not emit sessionTitle"

cat >"$TMP/nojq-env" <<'EOF'
command() {
	if [[ "${1:-}" == "-v" && "${2:-}" == "jq" ]]; then
		return 1
	fi
	builtin command "$@"
}
EOF

if command -v python3 >/dev/null 2>&1; then
	run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}' "$TMP/nojq-env"
	[ "$rc" -eq 0 ] || fail "no-jq startup must exit 0"
	assert_valid_json "no-jq-startup"
	[ "$(title_of)" = "2026-06-05-foo" ] || fail "no-jq startup must emit slug via python3 fallback"

	run_hook '{"hook_event_name":"SessionStart","source":"resume","session_title":"user-set"}' "$TMP/nojq-env"
	assert_valid_json "no-jq-preset-title"
	[ -z "$(title_of)" ] || fail "no-jq non-empty session_title must never be clobbered"
else
	printf 'skip: python3 unavailable — no-jq pass skipped\n' >&2
fi

rm -rf "$WS/.scratchpad"
mkdir -p "$WS"
run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}'
[ "$rc" -eq 0 ] || fail "no dossier dir must exit 0"
assert_valid_json "no-dossier"
[ -z "$(title_of)" ] || fail "no dossier dir must not emit sessionTitle"

printf 'ok\n'
