#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGEN="$SCRIPT_DIR/lib-regen-index.sh"
RECON="$SCRIPT_DIR/lib-reconcile-state.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-closure.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

workspace_with_closeout() {
	local name="$1" zbody="$2" slug="2026-06-01-closure"
	local ws="$TMP/$name"
	rm -rf "$ws"
	mkdir -p "$ws/.scratchpad/dossier/$slug" "$ws/.scratchpad/dossier/_archive"
	cat >"$ws/.scratchpad/dossier/$slug/DOSSIER.md" <<EOF
\`2026-06-01\` · \`live\` · \`P1/1\`

## §T — Task ledger

| T1 | P1 | x | thing | [a1] | — |

## §S — Rolling status log

2026-06-01 10:00 ds:close — START successor=— complete=true abandon=false

## §Z — Closeout

${zbody}
EOF
	printf '%s' "$ws"
}

regen_sees_closed() {
	local ws="$1"
	(cd "$ws" && "$REGEN" .scratchpad >/dev/null 2>&1 || true)
	grep -q 'drift!' "$ws/.scratchpad/INDEX.md" 2>/dev/null
}

reconcile_sees_closed() {
	local ws="$1"
	(cd "$ws" && "$RECON" .scratchpad >/dev/null 2>&1 || true)
	[[ -d "$ws/.scratchpad/dossier/_archive/2026-06-01-closure" ]]
}

assert_predicates_agree() {
	local zbody="$1" want="$2" label="$3" from_regen=no from_recon=no
	local ws_a ws_b
	ws_a="$(workspace_with_closeout regen "$zbody")"
	ws_b="$(workspace_with_closeout recon "$zbody")"
	regen_sees_closed "$ws_a" && from_regen=yes
	reconcile_sees_closed "$ws_b" && from_recon=yes
	[[ "$from_regen" == "$from_recon" ]] ||
		fail "$label: closure predicates disagree — regen=$from_regen reconcile=$from_recon"
	[[ "$from_regen" == "$want" ]] ||
		fail "$label: expected closed=$want, both reported $from_regen"
}

assert_predicates_agree "complete: true" yes "bare machine key"
assert_predicates_agree "complete: true." yes "machine key with trailing punctuation"
assert_predicates_agree "successor: 2026-07-01-next" yes "successor key"
assert_predicates_agree "abandoned: true" yes "abandoned key"
assert_predicates_agree "_(empty — written by ds:close)_" no "no machine key at all"
assert_predicates_agree "we completed: true things" no "prose that merely contains the words"

printf 'ok\n'
