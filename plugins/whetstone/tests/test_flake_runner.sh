#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER="$SCRIPT_DIR/../skills/flaky-test-audit/scripts/flake_runner.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/whet-flake.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
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

printf 'ok\n'
