#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLEAR="$SCRIPT_DIR/lib-clear-stale-locks.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-locks.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

NOW=$(date +%s)
iso_ago() {
	local e=$((NOW - $1))
	date -u -r "$e" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$e" +%Y-%m-%dT%H:%M:%SZ
}

DD="$TMP/dossier"
mklock() {
	mkdir -p "$DD/$1"
	printf '%s' "$2" >"$DD/$1/.ds-lock"
}

(:) &
deadpid=$!
wait "$deadpid" 2>/dev/null || true

mklock deadpid "{\"pid\": ${deadpid}, \"started\": \"$(iso_ago 60)\", \"skill\": \"ds:build\"}"
mklock livefresh "{\"pid\": $$, \"started\": \"$(iso_ago 60)\", \"skill\": \"ds:build\"}"
mklock oldstale "{\"started\": \"$(iso_ago 3600)\", \"skill\": \"ds:build\"}"
mklock unparse "{\"started\": \"not-a-date\", \"skill\": \"ds:build\"}"
mklock malformed "{\"skill\": \"ds:build\"}"

"$CLEAR" "$DD" 2>/dev/null

[[ ! -e "$DD/deadpid/.ds-lock" ]] || fail "dead-pid lock must be cleared"
[[ -e "$DD/livefresh/.ds-lock" ]] || fail "live-pid fresh lock must survive"
[[ ! -e "$DD/oldstale/.ds-lock" ]] || fail ">30min lock must be cleared"
[[ ! -e "$DD/unparse/.ds-lock" ]] || fail "unparseable-started lock must be cleared"
[[ ! -e "$DD/malformed/.ds-lock" ]] || fail "malformed lock (no pid, no started) must be cleared"

mklock tzstale "{\"started\": \"$(iso_ago 2400)\", \"skill\": \"ds:build\"}"
TZ=Asia/Kolkata "$CLEAR" "$DD" 2>/dev/null
[[ ! -e "$DD/tzstale/.ds-lock" ]] || fail "40min-old UTC lock must read stale under a non-UTC TZ (TZ=UTC parse)"

printf 'ok\n'
