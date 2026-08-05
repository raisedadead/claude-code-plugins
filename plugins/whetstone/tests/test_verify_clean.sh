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

count_rc=0
"$VERIFY" "$clean" 128 sh -c 'exit 7' 2>"$TMP/abort.err" || count_rc=$?
[[ "${count_rc}" -eq 7 ]] || fail "count-command exit status must propagate, got ${count_rc}"
[[ ! -s "$TMP/abort.err" ]] || fail "count-command abort is silent; SKILL.md must keep naming it so"

DOC="$SCRIPT_DIR/../skills/merge-resolve/SKILL.md"
example="$(grep -m1 -oE 'verify_clean\.sh \..*' "$DOC")" ||
	fail "SKILL.md must print a runnable verify_clean.sh example"

stub="$TMP/bin"
mkdir -p "$stub"
printf '#!/bin/sh\nprintf "no tests ran\\n"\nexit 5\n' >"$stub/pytest"
chmod +x "$stub/pytest"

doc_rc=0
(
	cd "$clean" || exit 99
	PATH="$stub:$PATH"
	export PATH
	eval "\"$VERIFY\" ${example#verify_clean.sh }"
) >/dev/null 2>"$TMP/doc.err" || doc_rc=$?
[[ "${doc_rc}" -ne 99 ]] || fail "could not enter the fixture tree"
[[ "${doc_rc}" -ne 0 ]] || fail "SKILL.md example must fail when the suite reports no passes"
[[ -s "$TMP/doc.err" ]] ||
	fail "SKILL.md example aborted silently on a no-summary suite; give its count command a zero-exit fallback"

printf 'ok\n'
