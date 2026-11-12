#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/coverage-floor.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

table() {
	printf -- '-----------|---------|---------|\n'
	printf 'File       | %% Funcs | %% Lines | Uncovered Line #s\n'
	printf -- '-----------|---------|---------|\n'
	printf 'All files  |   %s |   %s |\n' "$1" "$2"
	printf ' a.ts      |   50.00 |   10.00 | 1-9\n'
}

check() {
	table "$1" "$2" | bash "$ROOT/tools/coverage_floor.sh" demo 96 93 >"$TMP/out.log" 2>&1
}

check 96.32 93.90 || fail "a total above both floors was refused: $(cat "$TMP/out.log")"
check 96.00 93.00 || fail "a total equal to both floors was refused: $(cat "$TMP/out.log")"
grep -q '^COVERAGE: demo funcs 96.00 lines 93.00, floor 96 93$' "$TMP/out.log" || fail "the pass line is wrong: $(cat "$TMP/out.log")"

for below in '95.99 99.00' '99.00 92.99'; do
	# shellcheck disable=SC2086
	if check $below; then
		fail "a total under a floor passed: $below"
	fi
	grep -q '^COVERAGE: demo FAIL ' "$TMP/out.log" || fail "the refusal does not say FAIL: $(cat "$TMP/out.log")"
done

if printf 'no coverage table\n' | bash "$ROOT/tools/coverage_floor.sh" demo 96 93 >"$TMP/out.log" 2>&1; then
	fail "input with no All files row passed"
fi
grep -q '^COVERAGE: demo FAIL no All files row' "$TMP/out.log" || fail "the missing-table refusal is wrong: $(cat "$TMP/out.log")"

printf 'ok\n'
