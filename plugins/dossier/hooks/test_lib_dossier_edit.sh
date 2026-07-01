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

## §X — Cross-repo state

| repo       | branch | ahead | tag | pushed | notes          |
| ---------- | ------ | ----- | --- | ------ | -------------- |
| myorg/demo | stale  | ?     | —   | ?      | keep-this-note |
| myorg/two  | stale  | ?     | —   | ?      | second note    |

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

[[ -z "$(find "$D" -name 'DOSSIER.md.*' 2>/dev/null)" ]] || fail "flip left .tmp orphan"

if "$FLIP" "$D" B1 x '[abc]' 2>/dev/null; then fail "flip must refuse §B ids (data-loss guard)"; fi

D5="$TMP/citex"
make_fixture "$D5"
DF5="$D5/DOSSIER.md"
if "$FLIP" "$D5" T3 x 2>/dev/null; then fail "flip .->x with empty cite must refuse (Vm.3)"; fi
[[ "$(state_of "$DF5" T3)" == "." ]] || fail "refused cite-for-x must not mutate state"
"$FLIP" "$D5" T3 x '[c0ffee]'
[[ "$(state_of "$DF5" T3)" == "x" ]] || fail "cite-for-x with cite must succeed"

D6="$TMP/scope"
make_fixture "$D6"
DF6="$D6/DOSSIER.md"
printf '\n| T2 | decoy | fabricated-root-cause | — | — |\n' >>"$DF6"
"$FLIP" "$D6" T2 x '[beef]'
grep -q 'fabricated-root-cause' "$DF6" || fail "flip must not touch a T-row outside §T (section scope)"

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

[[ -z "$(find "$D2" -name 'DOSSIER.md.*' 2>/dev/null)" ]] || fail "append left .tmp orphan"

HSTATE="$SCRIPT_DIR/lib-header-state.sh"
hdr_state() {
	awk '/^`.*` · `.*` · / { n = split($0, p, "`"); gsub(/^[ \t]+|[ \t]+$/, "", p[4]); print p[4]; exit }' "$1"
}
D4="$TMP/hstate"
make_fixture "$D4"
DF4="$D4/DOSSIER.md"

"$HSTATE" "$D4" paused
[[ "$(hdr_state "$DF4")" == "paused" ]] || fail "header-state ->paused failed"
"$HSTATE" "$D4" live
[[ "$(hdr_state "$DF4")" == "live" ]] || fail "header-state ->live failed"
grep -q "wire client" "$DF4" || fail "header-state clobbered body"

if "$HSTATE" "$D4" bogus 2>/dev/null; then fail "header-state bad value should error"; fi

D4b="$TMP/hstate-nometa"
mkdir -p "$D4b"
printf '# x\n\nno meta line here\n' >"$D4b/DOSSIER.md"
if "$HSTATE" "$D4b" paused 2>/dev/null; then fail "header-state no-meta should error"; fi

[[ -z "$(find "$D4" -name 'DOSSIER.md.*' 2>/dev/null)" ]] || fail "header-state left .tmp orphan"

command -v git >/dev/null || {
	printf 'ok (git absent, §X refresh skipped)\n'
	exit 0
}

XREFRESH="$SCRIPT_DIR/lib-x-refresh.sh"
DX="$TMP/xref"
make_fixture "$DX"
DFX="$DX/DOSSIER.md"

REPO="$TMP/repo"
REMOTE="$TMP/remote.git"
git init -q -b main "$REPO"
git -C "$REPO" -c user.email=t@t -c user.name=t commit -q --allow-empty -m c1
git -C "$REPO" tag v0.1
git init -q --bare "$REMOTE"
git -C "$REPO" remote add origin "$REMOTE"
git -C "$REPO" push -q -u origin main
git -C "$REPO" -c user.email=t@t -c user.name=t commit -q --allow-empty -m c2

"$XREFRESH" "$DX" "myorg/demo" "$REPO"
demo_row=$(grep -E '^\| +myorg/demo ' "$DFX" | head -1)
[[ -n "$demo_row" ]] || fail "x-refresh demo row vanished"
echo "$demo_row" | grep -q 'main' || fail "x-refresh did not set branch=main"
echo "$demo_row" | grep -q 'stale' && fail "x-refresh kept stale branch"
echo "$demo_row" | grep -qE '\| 1 \|' || fail "x-refresh ahead != 1"
echo "$demo_row" | grep -q 'v0.1' || fail "x-refresh tag missing"
echo "$demo_row" | grep -qE '\| no \|' || fail "x-refresh pushed != no"
echo "$demo_row" | grep -q 'keep-this-note' || fail "x-refresh clobbered notes"

grep -E '^\| +myorg/two ' "$DFX" | grep -q 'second note' || fail "x-refresh mutated other row"
grep -E '^\| +myorg/two ' "$DFX" | grep -q 'stale' || fail "x-refresh touched non-target row"

REPO2="$TMP/repo2"
git init -q -b main "$REPO2"
git -C "$REPO2" -c user.email=t@t -c user.name=t commit -q --allow-empty -m c1
"$XREFRESH" "$DX" "myorg/two" "$REPO2"
grep -E '^\| +myorg/two ' "$DFX" | grep -q 'no-upstream' || fail "x-refresh no-upstream not set"

if "$XREFRESH" "$DX" "myorg/absent" "$REPO" 2>/dev/null; then fail "x-refresh missing label should error"; fi

[[ -z "$(find "$DX" -name 'DOSSIER.md.*' 2>/dev/null)" ]] || fail "x-refresh left .tmp orphan"

printf 'ok\n'
