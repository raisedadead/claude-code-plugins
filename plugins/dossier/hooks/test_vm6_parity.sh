#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VM_CHECKS="$SCRIPT_DIR/lib-vm-checks.sh"
HOOK="$SCRIPT_DIR/session-start.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-vm6.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

fixture_with_status_log() {
	local ws="$TMP/$1" slug="2026-07-31-parity"
	shift
	rm -rf "$ws"
	mkdir -p "$ws/.scratchpad/dossier/$slug"
	{
		printf '`2026-07-31` · `live` · `P1/1`\n\n## §T\n\n| T1 | P1 | . | do thing | — | — |\n\n## §S\n\n'
		printf '%s\n' "$@"
	} >"$ws/.scratchpad/dossier/$slug/DOSSIER.md"
	printf '%s' "$ws"
}

vm_checks_reports_unpaired() {
	local out
	out="$(cd "$1" && bash "$VM_CHECKS" .scratchpad 2>&1 || true)"
	[[ "$out" == *"Vm.6"* ]]
}

session_start_reports_unpaired() {
	local out
	out="$(printf '%s' '{"hook_event_name":"SessionStart","source":"startup","session_title":""}' |
		(cd "$1" && CLAUDE_PLUGIN_ROOT="$SCRIPT_DIR/.." "$HOOK") 2>/dev/null || true)"
	[[ "$out" == *"resume needed"* ]]
}

assert_both_enforcers_agree() {
	local ws="$1" want="$2" label="$3" from_vm=no from_hook=no
	vm_checks_reports_unpaired "$ws" && from_vm=yes
	session_start_reports_unpaired "$ws" && from_hook=yes
	[[ "$from_vm" == "$from_hook" ]] ||
		fail "$label: enforcers disagree — lib-vm-checks=$from_vm session-start=$from_hook"
	[[ "$from_vm" == "$want" ]] ||
		fail "$label: expected unpaired=$want, both reported $from_vm"
}

ws="$(fixture_with_status_log pending_resolved \
	'2026-07-31 10:00 ds:backprop pending START' \
	'2026-07-31 10:05 ds:backprop B1 DONE')"
assert_both_enforcers_agree "$ws" no "normal backprop flow: pending START resolved by an id-bearing DONE"

ws="$(fixture_with_status_log unpaired \
	'2026-07-31 10:00 ds:build T3 START')"
assert_both_enforcers_agree "$ws" yes "START with no DONE anywhere"

ws="$(fixture_with_status_log exact_pair \
	'2026-07-31 10:00 ds:build T3 START' \
	'2026-07-31 10:05 ds:build T3 DONE')"
assert_both_enforcers_agree "$ws" no "START and DONE on an identical target"

ws="$(fixture_with_status_log cross_verb \
	'2026-07-31 10:00 ds:backprop pending START' \
	'2026-07-31 10:05 ds:build T3 DONE')"
assert_both_enforcers_agree "$ws" yes "a DONE for an unrelated verb must not clear a pending START"

printf 'ok\n'
