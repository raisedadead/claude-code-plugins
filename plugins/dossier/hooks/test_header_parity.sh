#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-hdrparity.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

awk_state() {
	awk '/^`.*` · `.*` · / { n=split($0,p,"`"); gsub(/^[ \t]+|[ \t]+$/,"",p[4]); print p[4]; exit }' "$1"
}

py_state() {
	python3 -c '
import sys
sys.path.insert(0, sys.argv[1])
from pathlib import Path
from dossier_header import header_state
print(header_state(Path(sys.argv[2])))
' "$SCRIPT_DIR" "$1"
}

assert_agree() {
	local body="$1" label="$2" file="$TMP/DOSSIER.md" a p
	printf '%s\n' "$body" >"$file"
	a="$(awk_state "$file")"
	p="$(py_state "$file")"
	[[ "$a" == "$p" ]] ||
		fail "$label: lib-regen-index.sh awk read [$a], dossier_header.py read [$p]"
}

assert_agree '`2026-07-01` · `live` · `P1/3`' "canonical live header"
assert_agree '`2026-07-01` · `done` · `P3/3`' "canonical done header"
assert_agree '`2026-07-01` · `paused` · `P1/3`' "canonical paused header"
assert_agree '` 2026-07-01` · `live` · `P1/3`' "leading space inside the date span"
assert_agree '`2026-07-01` · ` live ` · `P1/3`' "padded state token"
assert_agree '`2026-07-01` · `wip` · `P1/3`' "non-canonical token"
assert_agree '`2026-07-01` · `` · `P1/3`' "empty state token"
assert_agree 'no header line at all' "ledger with no header"
assert_agree '# Heading

`2026-07-01` · `live` · `P1/3`' "header not on the first line"

printf 'PASS: test_header_parity (9 fixtures, both extractors)\n'
