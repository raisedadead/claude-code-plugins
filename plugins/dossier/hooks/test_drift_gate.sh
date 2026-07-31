#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$SCRIPT_DIR/lib-drift-gate.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-drift-gate.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

new_repo() {
	local ws="$TMP/$1"
	mkdir -p "$ws/.scratchpad/dossier"
	git -C "$ws" init -q
	git -C "$ws" config user.email t@example.invalid
	git -C "$ws" config user.name t
	git -C "$ws" config core.excludesFile /dev/null
	printf 'seed\n' >"$ws/seed.txt"
	printf '%s' "$ws"
}

run_gate() {
	(cd "$1" && bash "$GATE" .scratchpad >/dev/null 2>"$TMP/err") && printf '0' || printf '%s' "$?"
}

ws="$(new_repo ignored)"
printf '.scratchpad/\n' >"$ws/.gitignore"
git -C "$ws" add .gitignore seed.txt
git -C "$ws" commit -qm seed
rc="$(run_gate "$ws")"
[[ "$rc" == "2" ]] || fail "gitignored index must refuse with exit 2, got $rc"
grep -q 'inert' "$TMP/err" || fail "refusal must name the inert gate: $(cat "$TMP/err")"

ws="$(new_repo tracked)"
git -C "$ws" add seed.txt
git -C "$ws" commit -qm seed
rc="$(run_gate "$ws")"
[[ "$rc" != "2" ]] || fail "a tracked scratchpad must not trip the inert-gate refusal: $(cat "$TMP/err")"

ws="$TMP/norepo"
mkdir -p "$ws/.scratchpad/dossier"
rc="$(run_gate "$ws")"
[[ "$rc" == "2" ]] || fail "outside a work tree the gate must refuse, got $rc"
grep -q 'work tree' "$TMP/err" || fail "refusal must name the missing work tree: $(cat "$TMP/err")"

printf 'ok\n'
