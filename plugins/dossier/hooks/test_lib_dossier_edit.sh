#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FLIP="$SCRIPT_DIR/lib-row-flip.sh"
APPEND="$SCRIPT_DIR/lib-s-append.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-edit.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

make_fixture() {
	local dir="$1"
	mkdir -p "$dir"
	cat >"$dir/DOSSIER.md" <<'EOF'
`2026-06-01` · `live` · `P1/2`

## §T — Task ledger

| id  | P   | state | task          | cite | verify     |
| --- | --- | ----- | ------------- | ---- | ---------- |
| T1  | P1  | x     | scaffold pkg  | [a1] | go test    |
| T2  | P1  | ~     | wire client   | —    | V1         |
| T3  | P1  | .     | clamp ttl     | —    | V3         |

## §B — Bug ledger

| id  | bug | root cause | invariant added | fix cite |
| --- | --- | ---------- | --------------- | -------- |

## §S — Rolling status log

2026-06-01 10:00 ds:new — created slug=demo phase=P1

## §Z — Closeout

_(empty)_
EOF
}

state_of() {
	awk -v id="$2" '
    /^\|/ {
      n = split($0, f, "|")
      c2 = f[2]; gsub(/^[ \t]+|[ \t]+$/, "", c2)
      if (c2 == id) {
        s = f[4]; gsub(/^[ \t]+|[ \t]+$/, "", s)
        print s; exit
      }
    }' "$1"
}
cite_of() {
	awk -v id="$2" '
    /^\|/ {
      n = split($0, f, "|")
      c2 = f[2]; gsub(/^[ \t]+|[ \t]+$/, "", c2)
      if (c2 == id) {
        s = f[6]; gsub(/^[ \t]+|[ \t]+$/, "", s)
        print s; exit
      }
    }' "$1"
}

D="$TMP/flip"
make_fixture "$D"
DF="$D/DOSSIER.md"

"$FLIP" "$D" T3 '~'
[[ "$(state_of "$DF" T3)" == "~" ]] || fail "flip T3 .->~ did not set state"

"$FLIP" "$D" T3 x '[deadbee]'
[[ "$(state_of "$DF" T3)" == "x" ]] || fail "flip T3 ->x did not set state"
[[ "$(cite_of "$DF" T3)" == "[deadbee]" ]] || fail "flip T3 cite not set"

[[ "$(state_of "$DF" T1)" == "x" ]] || fail "T1 state mutated"
[[ "$(state_of "$DF" T2)" == "~" ]] || fail "T2 state mutated"
grep -q "scaffold pkg" "$DF" || fail "T1 task text lost"

if "$FLIP" "$D" T99 x 2>/dev/null; then fail "missing id should error"; fi

if "$FLIP" "$D" T1 z 2>/dev/null; then fail "bad state should error"; fi

[[ -z "$(find "$D" -name '*.tmp' 2>/dev/null)" ]] || fail "flip left .tmp orphan"

D2="$TMP/append"
make_fixture "$D2"
DF2="$D2/DOSSIER.md"

"$APPEND" "$D2" "ds:build T3 START"
grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} ds:build T3 START$' "$DF2" ||
	fail "append entry missing or no timestamp"

seed_ln=$(grep -n 'ds:new — created' "$DF2" | head -1 | cut -d: -f1)
new_ln=$(grep -n 'ds:build T3 START' "$DF2" | head -1 | cut -d: -f1)
z_ln=$(grep -n '^## §Z' "$DF2" | head -1 | cut -d: -f1)
[[ "$seed_ln" -lt "$new_ln" && "$new_ln" -lt "$z_ln" ]] || fail "append not placed in §S before §Z"

above=$(sed -n "$((new_ln - 1))p" "$DF2")
below=$(sed -n "$((new_ln + 1))p" "$DF2")
[[ -z "$above" ]] || fail "no blank line before §S entry"
[[ -z "$below" ]] || fail "no blank line after §S entry"

DS_TS_SECONDS=1 "$APPEND" "$D2" "ds:build T3 DONE"
grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} ds:build T3 DONE$' "$DF2" ||
	fail "DS_TS_SECONDS did not produce second-granular ts"

D3="$TMP/no-z"
mkdir -p "$D3"
printf '## §S — Rolling status log\n\n2026-06-01 10:00 ds:new — x\n' >"$D3/DOSSIER.md"
"$APPEND" "$D3" "ds:check — drift=0"
grep -q 'ds:check — drift=0' "$D3/DOSSIER.md" || fail "append-EOF fallback failed"

[[ -z "$(find "$D2" -name '*.tmp' 2>/dev/null)" ]] || fail "append left .tmp orphan"

printf 'ok\n'
