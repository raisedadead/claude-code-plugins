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

"$SLICE" green true || fail "green with a passing test must exit 0"
if "$SLICE" green false 2>/dev/null; then fail "green with a failing test must exit non-zero"; fi

"$SLICE" full true || fail "full with a green suite must exit 0"
if "$SLICE" full false 2>/dev/null; then fail "full with a failing suite must exit non-zero"; fi

if "$SLICE" bogus true 2>/dev/null; then fail "unknown phase must exit non-zero"; fi
if "$SLICE" red 2>/dev/null; then fail "no command must exit non-zero"; fi

printf 'ok\n'
