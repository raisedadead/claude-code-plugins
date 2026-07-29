#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/fakeimpl_stop.py"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-fakeimpl.XXXXXX")"

cleanup() {
	rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

git -C "$TMP" init -q
git -C "$TMP" config user.email t@example.com
git -C "$TMP" config user.name tester
printf 'seed\n' >"$TMP/a.txt"
git -C "$TMP" add -A
git -C "$TMP" commit -qm seed

run() {
	(cd "$TMP" && printf '{}' | env DOSSIER_FAKEIMPL_CMD="$1" python3 "$HOOK")
}

is_block() {
	[[ "$1" == *'"decision": "block"'* ]]
}

printf 'dirty\n' >>"$TMP/a.txt"

out="$(run "")"
if is_block "$out"; then fail "disabled (unset cmd) must not block"; fi

out="$(run "false")"
is_block "$out" || fail "failing cmd on a dirty tree must block"

out="$(run "true")"
if is_block "$out"; then fail "passing cmd must not block"; fi

git -C "$TMP" checkout -- a.txt
out="$(run "false")"
if is_block "$out"; then fail "clean tree must not run the cmd"; fi

printf 'PASS: test_fakeimpl_stop (4 cases)\n'
