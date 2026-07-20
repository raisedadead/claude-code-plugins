#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DR="$SCRIPT_DIR/../README.md"
WR="$SCRIPT_DIR/../../whetstone/README.md"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ds-grammar.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

extract() {
	sed -n '/## Verdict grammar/,/^## [^V]/p' "$1" | grep '^|' || true
}

extract "$DR" >"$TMP/d.tbl"
extract "$WR" >"$TMP/w.tbl"

[[ -s "$TMP/d.tbl" ]] || fail "dossier README must carry the verdict grammar table"
[[ -s "$TMP/w.tbl" ]] || fail "whetstone README must carry the verdict grammar table"
diff -q "$TMP/d.tbl" "$TMP/w.tbl" >/dev/null || fail "verdict grammar tables must be identical in both READMEs"

grep -q 'DOUBT: FAILURES | NO FAILURE FOUND' "$TMP/d.tbl" || fail "table must carry the doubter verdict line"
grep -q 'REVIEW: PASS | CHANGES' "$TMP/d.tbl" || fail "table must carry the reviewer verdict line"
grep -q 'verify_clean' "$TMP/d.tbl" || fail "table must carry merge-resolve's signal"
grep -q 'run_slice' "$TMP/d.tbl" || fail "table must carry tdd-cycle's signal"
grep -qi 'model-judgment' "$TMP/d.tbl" || fail "table must label model-judgment verdicts honestly"

grep -q 'test_verdict_grammar.sh' "$SCRIPT_DIR/../../../.github/workflows/ci.yml" || fail "ci must run this test"

printf 'ok\n'
