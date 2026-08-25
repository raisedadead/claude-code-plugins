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
`2026-06-05` · `live` · `P1/1`

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

export DOSSIER_SESSION_TITLE=1

(unset DOSSIER_SESSION_TITLE && run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}')
assert_valid_json "flag-unset"
[ -z "$(title_of)" ] || fail "unset DOSSIER_SESSION_TITLE must not emit sessionTitle"
grep -q "additionalContext" "$TMP/out" || fail "opt-out must not displace additionalContext"

DOSSIER_SESSION_TITLE=0 run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}'
assert_valid_json "flag-zero"
[ -z "$(title_of)" ] || fail "DOSSIER_SESSION_TITLE=0 must not emit sessionTitle"
grep -q "additionalContext" "$TMP/out" || fail "flag-zero must not displace additionalContext"

run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}'
[ "$rc" -eq 0 ] || fail "startup must exit 0"
assert_valid_json "startup"
[ "$(title_of)" = "2026-06-05-foo" ] || fail "startup + empty title + live dossier must emit slug as sessionTitle"
grep -q "additionalContext" "$TMP/out" || fail "sessionTitle must not displace additionalContext"

run_hook '{"hook_event_name":"SessionStart","source":"resume","session_title":""}'
[ "$(title_of)" = "2026-06-05-foo" ] || fail "resume + empty title must emit sessionTitle"

run_hook '{"hook_event_name":"SessionStart","source":"fork","session_title":""}'
[ "$(title_of)" = "2026-06-05-foo" ] || fail "fork + empty title must emit sessionTitle (2.1.216 split fork out of resume)"

run_hook '{"hook_event_name":"SessionStart","source":"fork","session_title":"user-set"}'
[ -z "$(title_of)" ] || fail "fork must not clobber a non-empty session_title"

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

	DOSSIER_SESSION_TITLE=0 run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}' "$TMP/nojq-env"
	assert_valid_json "no-jq-flag-zero"
	[ -z "$(title_of)" ] || fail "no-jq flag-zero must not emit sessionTitle"
	grep -q "additionalContext" "$TMP/out" || fail "no-jq flag-zero must not displace additionalContext"
else
	printf 'skip: python3 unavailable — no-jq pass skipped\n' >&2
fi

sys_of() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("systemMessage",""))' "$TMP/out"; }
ctx_of() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("hookSpecificOutput",{}).get("additionalContext",""))' "$TMP/out"; }

rm -rf "$WS/.scratchpad"
scaffold "2026-06-05-foo"
mkdir -p "$WS/.scratchpad/dossier/2026-06-04-zombie"
cat >"$WS/.scratchpad/dossier/2026-06-04-zombie/DOSSIER.md" <<'EOF'
`2026-06-04` · `sealed` · `P1/1`

## §T — Task ledger

| T1 | P1 | x | done thing | [a1] | — |

## §S — Rolling status log

2026-06-04 09:00 ds:close — START successor=— complete=true abandon=false

## §Z — Closeout

_(empty)_
EOF

run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}'
[ "$rc" -eq 0 ] || fail "drift present must still exit 0"
assert_valid_json "drift"
[ "$(title_of)" = "2026-06-05-foo" ] || fail "drift dir must not displace true-live slug as title"
sys_of | grep -qi 'drift' || fail "drift dossier must raise a drift systemMessage"
sys_of | grep -q 'zombie' || fail "drift systemMessage must name the drift slug"
sys_of | grep -qE '[0-9]+ live' && fail "drift dir must not be counted as live"
ctx_of | grep -qi 'resume' || fail "interrupted ds:close on a non-current dir must surface a resume hint"
ctx_of | grep -q 'ds:close' || fail "resume hint must identify the interrupted close op"

rm -rf "$WS/.scratchpad"
scaffold "2026-06-05-foo"
cat >>"$WS/.scratchpad/dossier/2026-06-05-foo/DOSSIER.md" <<'EOF'

2026-06-05 10:00 ds:build T2 START

2026-06-05 10:05 ds:build T3 START

2026-06-05 10:06 ds:build T3 DONE
EOF
run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}'
assert_valid_json "resume-pairing"
ctx_of | grep -q 'T2' || fail "unpaired build START (T2) must surface as resume"
ctx_of | grep -qE 'resume[^A-Za-z]*needed.*T3' && fail "paired build (T3 START+DONE) must not surface as resume"

rm -rf "$WS/.scratchpad"
scaffold "2026-06-05-foo"
cat >>"$WS/.scratchpad/dossier/2026-06-05-foo/DOSSIER.md" <<'EOF'

2026-06-05 11:00 ds:backprop pending START

2026-06-05 11:04 ds:backprop B1 DONE
EOF
run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}'
assert_valid_json "backprop-pairing"
ctx_of | grep -qiE 'resume needed.*ds:backprop' && fail "a completed new-bug backprop (pending START → B1 DONE) must not phantom-resume"

rm -rf "$WS/.scratchpad"
scaffold "2026-06-05-foo"
cat >>"$WS/.scratchpad/dossier/2026-06-05-foo/DOSSIER.md" <<'EOF'

2026-06-05 11:00 ds:backprop pending START

2026-06-05 11:02 ds:backprop B9 START

2026-06-05 11:04 ds:backprop B1 DONE
EOF
run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}'
assert_valid_json "backprop-interleave"
ctx_of | grep -qE 'resume needed.*B9' || fail "an in-flight concrete backprop (B9 START) must survive a completed sibling's DONE"

rm -rf "$WS/.scratchpad"
scaffold "2026-06-08-zprose"
cat >>"$WS/.scratchpad/dossier/2026-06-08-zprose/DOSSIER.md" <<'EOF'

## §Z — Closeout

discuss the T2 phase START
EOF
run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}'
assert_valid_json "z-prose"
ctx_of | grep -q 'phase START' && fail "§Z prose with a field-5 START must not trigger a resume hint (scan is §S-scoped)"

cat >"$TMP/nojq-nopy-env" <<'EOF'
command() {
	if [[ "${1:-}" == "-v" && ( "${2:-}" == "jq" || "${2:-}" == "python3" ) ]]; then
		return 1
	fi
	builtin command "$@"
}
python3() { return 1; }
EOF

rm -rf "$WS/.scratchpad"
scaffold "2026-06-05-foo"
run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}' "$TMP/nojq-nopy-env"
[ "$rc" -eq 0 ] || fail "no-jq no-python3 must exit 0"
assert_valid_json "no-jq-no-python3 fallback must be valid JSON"

rm -rf "$WS/.scratchpad"
scaffold "2026-06-07-current"
mkdir -p "$WS/.scratchpad/dossier/2026-06-06-closed"
cat >"$WS/.scratchpad/dossier/2026-06-06-closed/DOSSIER.md" <<'EOF'
`2026-06-06` · `done` · `P1/1`

## §T — Task ledger

| T1 | P1 | x | done | [a1] | — |

## §S — Rolling status log

2026-06-06 09:00 ds:close — §Z=written

## §Z — Closeout

complete: true
EOF
run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}'
assert_valid_json "self-heal"
[ -f "$WS/.scratchpad/dossier/_archive/2026-06-06-closed/DOSSIER.md" ] || fail "§Z-closed zombie must self-heal into _archive at session-start"
[ ! -e "$WS/.scratchpad/dossier/2026-06-06-closed" ] || fail "healed zombie must leave the live tree"
sys_of | grep -qi 'drift' && fail "a fully self-healed tree must not warn drift"
grep -q 'ds:reconcile' "$WS/.scratchpad/dossier/_archive/2026-06-06-closed/DOSSIER.md" || fail "self-heal must leave a §S breadcrumb"

rm -rf "$WS/.scratchpad"
mkdir -p "$WS"
run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}'
[ "$rc" -eq 0 ] || fail "no dossier dir must exit 0"
assert_valid_json "no-dossier"
[ -z "$(title_of)" ] || fail "no dossier dir must not emit sessionTitle"

ledger_with() {
	local slug="$1" tasks="$2" status="$3"
	rm -rf "$WS/.scratchpad"
	mkdir -p "$WS/.scratchpad/dossier/$slug"
	{
		# shellcheck disable=SC2016
		printf '`2026-08-05` · `live` · `P1/1`\n\n'
		printf '%s\n\n' "$tasks"
		printf '| id | state | who | task    | needs | cite | verify |\n'
		printf '|----|-------|-----|---------|-------|------|--------|\n'
		printf '| T1 | x     | A   | first   | —     | ab12 | —      |\n'
		printf '| T2 | .     | A   | second  | T1    | —    | —      |\n\n'
		printf '%s\n\n' "$status"
		printf '2026-08-05 10:00 ds:new — created slug=%s\n\n' "$slug"
		printf '2026-08-05 10:05 ds:build T1 DONE\n'
	} >"$WS/.scratchpad/dossier/$slug/DOSSIER.md"
}

for spelling in "## §T — Task ledger|## §S — Rolling status log" "## Tasks|## Status"; do
	tasks_h="${spelling%%|*}"
	status_h="${spelling##*|}"
	ledger_with "2026-08-05-sitrep" "$tasks_h" "$status_h"
	run_hook '{"hook_event_name":"SessionStart","source":"startup"}'
	assert_valid_json "sitrep $tasks_h"
	ctx_of | grep -q 'Tasks: 1/2 done' ||
		fail "$tasks_h: task summary must count by header name, got: $(ctx_of)"
	[[ "$(ctx_of | grep -c 'just did:')" == "2" ]] ||
		fail "$status_h: the two most recent Status entries must reach the sit-rep, got: $(ctx_of)"
done

rm -rf "$WS/.scratchpad"
scaffold "2026-06-05-foo"
run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}'
assert_valid_json "live-nudge"
sys_of | grep -q '2026-06-05-foo' || fail "one live dossier must raise a systemMessage naming the slug, got: $(sys_of)"
sys_of | grep -q 'ds:status\|/dossier:status' || fail "the live nudge must route to the sit-rep"
sys_of | grep -q 'P1/1 · T 0/1 · B 0' || fail "the live nudge must carry the INDEX P/T/B cells in that order, got: $(sys_of)"

for src in resume fork clear; do
	run_hook "{\"hook_event_name\":\"SessionStart\",\"source\":\"$src\",\"session_title\":\"\"}"
	assert_valid_json "live-nudge-$src"
	sys_of | grep -q '2026-06-05-foo' || fail "$src must raise the live nudge — it is a session the operator started"
done

run_hook '{"hook_event_name":"SessionStart","source":"compact","session_title":""}'
assert_valid_json "live-nudge-compact"
[ -z "$(sys_of)" ] || fail "compact must not re-raise the live nudge mid-session, got: $(sys_of)"
ctx_of | grep -q '2026-06-05-foo' || fail "compact must still hand the live dossier to the model via additionalContext"

DOSSIER_LIVE_NUDGE=0 run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}'
assert_valid_json "live-nudge-optout"
[ -z "$(sys_of)" ] || fail "DOSSIER_LIVE_NUDGE=0 must suppress the live nudge, got: $(sys_of)"
grep -q "additionalContext" "$TMP/out" || fail "the opt-out must not displace additionalContext"

rm -rf "$WS/.scratchpad"
scaffold "2026-06-05-foo"
scaffold "2026-06-06-bar"
run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}'
assert_valid_json "two-live"
sys_of | grep -q '2 live' || fail "two live dossiers must still raise the consolidate warning, got: $(sys_of)"

rm -rf "$WS/.scratchpad"
mkdir -p "$WS/.scratchpad/dossier/_archive"
run_hook '{"hook_event_name":"SessionStart","source":"startup","session_title":""}'
assert_valid_json "no-live-nudge"
[ -z "$(sys_of)" ] || fail "no live dossier must raise no systemMessage, got: $(sys_of)"

printf 'ok\n'
