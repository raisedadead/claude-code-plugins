#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SLICE="$SCRIPT_DIR/../skills/tdd-cycle/scripts/run_slice.sh"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

"$SLICE" red false || fail "red with a failing test must exit 0 (RED confirmed)"
if "$SLICE" red true 2>/dev/null; then fail "red with a passing test must exit non-zero"; fi

if "$SLICE" red /nonexistent/command 2>/dev/null; then fail "red with a command that did not run must exit non-zero"; fi

"$SLICE" green true || fail "green with a passing test must exit 0"
if "$SLICE" green false 2>/dev/null; then fail "green with a failing test must exit non-zero"; fi

"$SLICE" full true || fail "full with a green suite must exit 0"
if "$SLICE" full false 2>/dev/null; then fail "full with a failing suite must exit non-zero"; fi

if "$SLICE" bogus true 2>/dev/null; then fail "unknown phase must exit non-zero"; fi
if "$SLICE" red 2>/dev/null; then fail "no command must exit non-zero"; fi

OUT="$(mktemp)"
ERR="$(mktemp)"
trap 'rm -f "$OUT" "$ERR"' EXIT

expect_exit() {
	local want="$1" name="$2"
	shift 2
	local rc=0
	"$SLICE" "$@" >"$OUT" 2>"$ERR" || rc=$?
	[[ "${rc}" -eq "${want}" ]] || fail "${name}: want exit ${want}, got ${rc}"
}

expect_exit 0 "red --expect with a matching failure" red --expect boom sh -c 'echo boom; exit 1'
grep -q boom "$OUT" || fail "red --expect must still print the test output"

expect_exit 1 "red --expect with another failure" red --expect boom sh -c 'echo other; exit 1'
grep -q 'does not match --expect' "$ERR" || fail "red --expect with another failure must say the output does not match"

expect_exit 1 "red --expect with a passing test" red --expect boom sh -c 'echo boom; exit 0'
grep -q PASSED "$ERR" || fail "red --expect with a passing test must say it PASSED"

expect_exit 1 "red --expect with a command that did not run" red --expect boom /nonexistent/command
grep -q 'did not run' "$ERR" || fail "red --expect with a command that did not run must say so"

expect_exit 2 "red --expect with no pattern" red --expect
expect_exit 2 "red --expect with an empty pattern" red --expect '' false
expect_exit 2 "red --expect with a pattern that is not an ERE" red --expect '(' sh -c 'echo "boom (x"; exit 1'
expect_exit 2 "green --expect" green --expect boom true
expect_exit 2 "full --expect" full --expect boom true

printf 'ok\n'
