#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGEN="$SCRIPT_DIR/lib-regen-index.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-hdrparity.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

regen_says_live() {
	local ws="$1" state
	(cd "$ws" && "$REGEN" .scratchpad >/dev/null 2>&1 || true)
	state="$(awk -F'|' '/^\| 2026-/ { gsub(/^[ \t]+|[ \t]+$/,"",$4); print $4; exit }' \
		"$ws/.scratchpad/INDEX.md" 2>/dev/null || true)"
	[[ "$state" == "live" || "$state" == "paused" ]]
}

python_says_live() {
	python3 -c '
import sys
sys.path.insert(0, sys.argv[1])
from dossier_header import has_active_dossier
sys.exit(0 if has_active_dossier(sys.argv[2]) else 1)
' "$SCRIPT_DIR" "$1"
}

assert_agree() {
	local body="$1" label="$2" ws="$TMP/case" from_regen=no from_py=no
	rm -rf "$ws"
	mkdir -p "$ws/.scratchpad/dossier/2026-07-31-x"
	printf '%s\n' "$body" >"$ws/.scratchpad/dossier/2026-07-31-x/DOSSIER.md"
	regen_says_live "$ws" && from_regen=yes
	python_says_live "$ws" && from_py=yes
	[[ "$from_regen" == "$from_py" ]] ||
		fail "$label: lib-regen-index.sh live=$from_regen, dossier_header live=$from_py"
}

preamble() {
	local n="$1" i
	for ((i = 1; i <= n; i++)); do printf 'preamble line %s\n' "$i"; done
}

assert_agree '`2026-07-31` · `live` · `P1/3`' "canonical live header"
assert_agree '`2026-07-31` · `done` · `P3/3`' "canonical done header"
assert_agree '`2026-07-31` · `paused` · `P1/3`' "canonical paused header"
assert_agree '` 2026-07-31` · `live` · `P1/3`' "leading space inside the date span"
assert_agree '`2026-07-31` · ` live ` · `P1/3`' "padded state token"
assert_agree '`2026-07-31` · `wip` · `P1/3`' "non-canonical token"
assert_agree '`2026-07-31` · `` · `P1/3`' "empty state token"
assert_agree 'no header line at all' "ledger with no header"
assert_agree "$(preamble 9)
\`2026-07-31\` · \`live\` · \`P1/3\`" "header below the old 8-line bound"
assert_agree "$(preamble 60)
\`2026-07-31\` · \`live\` · \`P1/3\`" "header far down a long preamble"

printf 'PASS: test_header_parity (10 fixtures, real lib-regen-index.sh vs dossier_header)\n'
