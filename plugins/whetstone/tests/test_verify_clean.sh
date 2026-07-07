#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERIFY="$SCRIPT_DIR/../skills/merge-resolve/scripts/verify_clean.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/whet-merge.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

clean="$TMP/clean"
mkdir -p "$clean"
printf 'resolved line\nanother\n' >"$clean/app.txt"

dirty="$TMP/dirty"
mkdir -p "$dirty"
{
	printf 'top\n'
	printf '<<<<<<< HEAD\n'
	printf 'ours\n'
	printf '=======\n'
	printf 'theirs\n'
	printf '>>>>>>> branch\n'
} >"$dirty/app.txt"

"$VERIFY" "$clean" 3 printf 5 || fail "clean tree + count>=baseline must exit 0"
"$VERIFY" "$clean" - printf 0 || fail "baseline '-' must skip the count check"
if "$VERIFY" "$dirty" - true 2>/dev/null; then fail "conflict markers must exit non-zero"; fi
if "$VERIFY" "$clean" 5 printf 3 2>/dev/null; then fail "pass-count regression must exit non-zero"; fi

printf 'ok\n'
