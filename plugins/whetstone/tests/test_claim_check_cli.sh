#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECK="$SCRIPT_DIR/../bin/claim-check"
FIXTURES="$SCRIPT_DIR/fixtures"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

run() {
	rc=0
	out="$("$CHECK" "$@" 2>&1)" || rc=$?
}

run_stdin() {
	local text="$1"
	shift
	rc=0
	out="$(printf '%s' "$text" | "$CHECK" --stdin "$@" 2>&1)" || rc=$?
}

run "$FIXTURES/claims-false.md"
[[ "$rc" -eq 1 ]] || fail "an unbacked claim must exit 1, got $rc"
[[ "$out" == *"claims-false.md:3: "* ]] || fail "the flagged line must name file and line: $out"
[[ "$out" == *"CLAIMS: FLAGGED 3" ]] || fail "the verdict must count every claim: $out"

run "$FIXTURES/claims-true.md" "$FIXTURES/claims-quiet.md"
[[ "$rc" -eq 0 ]] || fail "backed claims and quiet prose must exit 0, got $rc"
[[ "$out" == "CLAIMS: CLEAN 2 files" ]] || fail "a clean run must count its files: $out"

run "$FIXTURES/claims-labelled.md"
[[ "$out" == "CLAIMS: CLEAN 1 file" ]] || fail "one clean file must read singular: $out"

run "$FIXTURES/claims-false.md" "$FIXTURES/claims-true.md"
[[ "$out" == *"CLAIMS: FLAGGED 3" ]] || fail "several files must be summed: $out"

run
[[ "$rc" -eq 64 ]] || fail "no paths must exit 64, got $rc"

run "$FIXTURES/no-such-file.md"
[[ "$rc" -eq 64 ]] || fail "a missing file must exit 64, got $rc"

run --help "$FIXTURES/claims-true.md"
[[ "$rc" -eq 64 ]] || fail "an unknown option must exit 64, got $rc"
[[ "$out" == *"--help"* ]] || fail "an unknown option must be named: $out"

run_stdin $'filler\nThe hook blocks the write.\n'
[[ "$rc" -eq 1 ]] || fail "stdin with an unbacked claim must exit 1, got $rc"
[[ "$out" == *"<stdin>:2: "* ]] || fail "stdin must name the line, not a path: $out"
[[ "$out" == *"CLAIMS: FLAGGED 1" ]] || fail "stdin verdict: $out"

run_stdin $'The hook blocks the write, exit 2.\n'
[[ "$rc" -eq 0 && "$out" == "CLAIMS: CLEAN stdin" ]] || fail "stdin with a backed claim must be clean: $out"

run_stdin ''
[[ "$rc" -eq 0 ]] || fail "empty stdin must exit 0, got $rc"

run_stdin $'The hook blocks the write.\n' "$FIXTURES/claims-true.md"
[[ "$rc" -eq 64 ]] || fail "stdin and a path together must exit 64, got $rc"

printf 'ok test_claim_check_cli\n'
