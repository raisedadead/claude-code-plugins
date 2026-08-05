#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER="$SCRIPT_DIR/../skills/flaky-test-audit/scripts/flake_runner.sh"
COMPUTE="$SCRIPT_DIR/../skills/flaky-test-audit/scripts/compute_flakiness.py"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/whet-flake.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

run_rc() {
	local rc=0
	"$@" >/dev/null 2>&1 || rc=$?
	printf '%s' "$rc"
}

cnt="$TMP/cnt"
printf '0' >"$cnt"
flip="$TMP/flip.sh"
cat >"$flip" <<EOF
#!/usr/bin/env bash
c=\$(cat "$cnt"); printf '%s' \$((c + 1)) >"$cnt"; [ \$((c % 2)) -eq 0 ]
EOF
chmod +x "$flip"

res="$TMP/results.json"
FLAKE_TEST_NAME=demo "$RUNNER" 4 "$res" "$flip"
grep -q '"demo"' "$res" || fail "results must key by FLAKE_TEST_NAME"
grep -q '"runs": 4' "$res" || fail "runs must be 4"
grep -q '"fails": 2' "$res" || fail "flip must fail 2 of 4"

if "$RUNNER" 1 "$TMP/x.json" 2>/dev/null; then fail "no command must error"; fi

quoted_id='say "hi" \ bye'
quoted="$TMP/quoted.json"
printf '0' >"$cnt"
FLAKE_TEST_NAME="$quoted_id" "$RUNNER" 4 "$quoted" "$flip"
read_key='import json,sys; print(next(iter(json.load(open(sys.argv[1])) or [""])))'
if ! key="$(python3 -c "$read_key" "$quoted" 2>/dev/null)"; then
	fail "a test id holding a quote or backslash must still be valid JSON, got $(cat "$quoted")"
fi
[[ $key == "$quoted_id" ]] || fail "the quoted id must round-trip verbatim, got $key"

Q="$TMP/quarantine.json"
absent="$TMP/no-baseline.json"

rm -f "$Q"
rc="$(run_rc python3 "$COMPUTE" "$quoted" "$absent" "$Q")"
[[ $rc == 1 ]] || fail "one newly-flaky quoted id must exit 1, got $rc"
qkey="$(python3 -c "$read_key" "$Q")"
[[ $qkey == "$quoted_id" ]] || fail "quarantine must key by the exact test id, got $qkey"

rm -f "$Q"
rc="$(run_rc python3 "$COMPUTE" "$TMP/missing_results.json" "$absent" "$Q")"
[[ $rc == 252 ]] || fail "a missing results.json must exit 252, not a flake count, got $rc"
if [[ -e $Q ]]; then fail "a missing results.json must write no quarantine.json"; fi

printf 'not json at all\n' >"$TMP/corrupt.json"
rm -f "$Q"
rc="$(run_rc python3 "$COMPUTE" "$TMP/corrupt.json" "$absent" "$Q")"
[[ $rc == 252 ]] || fail "an unparseable results.json must exit 252, got $rc"
if [[ -e $Q ]]; then fail "an unparseable results.json must write no quarantine.json"; fi

printf '{"a": 5}\n' >"$TMP/malformed.json"
rm -f "$Q"
rc="$(run_rc python3 "$COMPUTE" "$TMP/malformed.json" "$absent" "$Q")"
[[ $rc == 252 ]] || fail "a record that is not {runs, fails} must exit 252, got $rc"

printf 'not json at all\n' >"$TMP/bad-baseline.json"
rm -f "$Q"
rc="$(run_rc python3 "$COMPUTE" "$quoted" "$TMP/bad-baseline.json" "$Q")"
[[ $rc == 252 ]] || fail "an unparseable baseline must exit 252, got $rc"

rm -f "$Q"
rc="$(cd "$TMP" && run_rc python3 "$COMPUTE")"
[[ $rc == 251 ]] || fail "a usage error must exit 251, outside the 0-250 count range, got $rc"
if [[ -e $Q ]]; then fail "a usage error must write no quarantine.json"; fi

rc="$(run_rc python3 "$COMPUTE" "$quoted" "$absent" "$TMP/no-such-dir/q.json")"
[[ $rc == 253 ]] || fail "an unwritable quarantine path must exit 253, not a count, got $rc"

printf '{"a": {"runs": 5, "fails": 2}, "b": {"runs": 5, "fails": 3}}\n' >"$TMP/two.json"
rm -f "$Q"
rc="$(run_rc python3 "$COMPUTE" "$TMP/two.json" "$absent" "$Q")"
[[ $rc == 2 ]] || fail "two newly-flaky tests must exit 2, got $rc"

printf '{"a": {"runs": 5, "fails": 0}, "b": {"runs": 5, "fails": 5}}\n' >"$TMP/clean.json"
rm -f "$Q"
rc="$(run_rc python3 "$COMPUTE" "$TMP/clean.json" "$absent" "$Q")"
[[ $rc == 0 ]] || fail "a sweep with no flake must exit 0, got $rc"
if ! grep -q '^{}$' "$Q"; then fail "a clean sweep must write an empty quarantine.json"; fi

printf '{"a": {"runs": 5, "fails": 2}}\n' >"$TMP/one.json"
printf '{"a": 0.4}\n' >"$TMP/baseline.json"
rm -f "$Q"
rc="$(run_rc python3 "$COMPUTE" "$TMP/one.json" "$TMP/baseline.json" "$Q")"
[[ $rc == 0 ]] || fail "a flake already in the baseline must exit 0, got $rc"

printf 'ok\n'
