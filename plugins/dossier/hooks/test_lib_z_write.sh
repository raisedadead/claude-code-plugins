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

printf 'ok\n'
