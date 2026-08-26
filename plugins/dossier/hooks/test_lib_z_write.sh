#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ZW="$SCRIPT_DIR/lib-z-write.sh"
REGEN="$SCRIPT_DIR/lib-regen-index.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-zwrite.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

mkdoss() {
	local dir="$1"
	mkdir -p "$dir"
	cat >"$dir/DOSSIER.md" <<'EOF'
`2026-06-01` · `live` · `P1/1`

## §S — Rolling status log

2026-06-01 10:00 ds:new — created

## §Z — Closeout

_(empty — written by ds:close)_
EOF
}

D1="$TMP/complete"
mkdoss "$D1"
"$ZW" "$D1" complete — "P1 shipped" "[a1], [b2]"
grep -q '^complete: true$' "$D1/DOSSIER.md" || fail "complete kind must write complete: true"
grep -q '^summary: P1 shipped$' "$D1/DOSSIER.md" || fail "summary not written"
grep -q '^key cites: \[a1\], \[b2\]$' "$D1/DOSSIER.md" || fail "cites not written"
grep -q 'ds:new — created' "$D1/DOSSIER.md" || fail "content before §Z (the §S log) must be preserved"
[[ -z "$(find "$D1" -name 'DOSSIER.md.*')" ]] || fail "z-write left a temp orphan"

D2="$TMP/successor"
mkdoss "$D2"
"$ZW" "$D2" successor auth-2 "phase 1 done" "[c3]"
grep -q '^successor: auth-2$' "$D2/DOSSIER.md" || fail "successor kind must write successor: <slug>"

D3="$TMP/abandoned"
mkdoss "$D3"
"$ZW" "$D3" abandoned "superseded by valkey" "P1 only" "—"
grep -q '^abandoned: true$' "$D3/DOSSIER.md" || fail "abandoned kind must write abandoned: true"
grep -q '^reason: superseded by valkey$' "$D3/DOSSIER.md" || fail "abandoned must write reason"

blanks_ok=$(awk '/^complete: true$/ { if (prev != "" ) bad=1 } { prev=$0 } END { print (bad?"no":"yes") }' "$D1/DOSSIER.md")
[[ "$blanks_ok" == "yes" ]] || fail "§Z fields must be blank-line separated (formatter-resistant)"

SP="$TMP/sp/.scratchpad"
mkdir -p "$SP/dossier/2026-06-01-c"
cp "$D1/DOSSIER.md" "$SP/dossier/2026-06-01-c/DOSSIER.md"
(cd "$TMP/sp" && "$REGEN" .scratchpad)
grep -q 'drift!' "$SP/INDEX.md" || fail "live-located §Z-complete dossier must regen drift! (z_closed detected from lib-z-write output)"

if "$ZW" "$D1" bogus x 2>/dev/null; then fail "invalid kind must error"; fi
if "$ZW" "$D2" successor "" 2>/dev/null; then fail "successor without slug must error"; fi

D4="$TMP/prose-key"
mkdoss "$D4"
if "$ZW" "$D4" abandoned "superseded" "$(printf 'P1 shipped\nsuccessor: auth-2')" 2>/dev/null; then
	fail "a summary line that opens with a §Z closure key must be refused, not written"
fi
grep -q '_(empty — written by ds:close)_' "$D4/DOSSIER.md" || fail "a refused close must leave §Z untouched"

D5="$TMP/prose-ok"
mkdoss "$D5"
"$ZW" "$D5" abandoned "valkey took over" "carried into the successor: the age-identity exemption" "—"
grep -q '^abandoned: true$' "$D5/DOSSIER.md" || fail "a mid-sentence 'successor:' in prose must still close"

D6="$TMP/badslug"
mkdoss "$D6"
if "$ZW" "$D6" successor "The Big Rewrite" "phase 1 done" "[c3]" 2>/dev/null; then
	fail "a successor value the readers reject must not be written as a close"
fi
if "$ZW" "$D6" successor "$(printf 'auth-2\nabandoned: true')" "phase 1 done" "[c3]" 2>/dev/null; then
	fail "a newline in the successor value must be refused — its second line anchors as a key"
fi
"$ZW" "$D6" successor "2026-07-01-next-wave" "phase 1 done" "[c3]"
grep -q '^successor: 2026-07-01-next-wave$' "$D6/DOSSIER.md" || fail "a date-prefixed slug is a valid successor"

D7="$TMP/summary-key"
mkdoss "$D7"
"$ZW" "$D7" abandoned "dropped" "complete: true never came back from CI" "[a1]"
grep -q '^summary: complete: true never came back from CI$' "$D7/DOSSIER.md" ||
	fail "the rendered line carries a field prefix, so a summary opening with a key must still write"

printf 'ok\n'
