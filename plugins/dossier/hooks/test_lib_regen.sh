#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGEN="$SCRIPT_DIR/lib-regen-index.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-regen.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

WS="$TMP/ws"
SP="$WS/.scratchpad"
INDEX="$SP/INDEX.md"

make_dossier() {
	local rel="$1" token="$2" zbody="${3:-_(empty — written by ds:close)_}"
	local dir="$SP/dossier/$rel"
	mkdir -p "$dir"
	cat >"$dir/DOSSIER.md" <<EOF
\`2026-06-01\` · \`${token}\` · \`P1/1\`

## §T — Task ledger

| id  | P   | state | task    | cite | verify |
| --- | --- | ----- | ------- | ---- | ------ |
| T1  | P1  | x     | do it   | [a1] | V1     |

## §B — Bug ledger

| id  | bug | root cause | invariant added | fix cite |
| --- | --- | ---------- | --------------- | -------- |

## §X — Cross-repo state

| repo | branch | ahead | tag | pushed | notes |
| ---- | ------ | ----- | --- | ------ | ----- |

## §S — Rolling status log

2026-06-01 10:00 ds:new — created

## §Z — Closeout

${zbody}
EOF
}

state_of() {
	awk -F'|' -v slug="$1" '
    NR>2 && $3 ~ slug {
      s=$4; gsub(/^[ \t]+|[ \t]+$/,"",s); print s; exit
    }' "$INDEX"
}

make_dossier "2026-06-10-alive" "live"
make_dossier "2026-06-10-samedrift" "done"
make_dossier "2026-06-09-paused-ok" "paused"
make_dossier "2026-06-08-zombie" "done"
make_dossier "2026-06-07-sealed" "sealed"
make_dossier "2026-06-06-closeout-noarch" "live" "complete: true"
make_dossier "_archive/2026-06-05-gone" "done" "complete: true"
make_dossier "_archive/2026-06-04-inverse" "live" "complete: true"
make_dossier "_archive/2026-06-03-legacy" "done"

(cd "$WS" && "$REGEN" .scratchpad)

[[ -f "$INDEX" ]] || fail "regen produced no INDEX"

[[ "$(state_of alive)" == "live" ]] || fail "concordant live must render live (got '$(state_of alive)')"
[[ "$(state_of paused-ok)" == "paused" ]] || fail "concordant paused must render paused (got '$(state_of paused-ok)')"
[[ "$(state_of gone)" == "done" ]] || fail "concordant archived must render done (got '$(state_of gone)')"
[[ "$(state_of legacy)" == "done" ]] || fail "archived done-header w/ prose-only §Z (no machine key) must render done — location+header suffice (got '$(state_of legacy)')"

[[ "$(state_of zombie)" == "drift!" ]] || fail "done-header non-archived must render drift! (got '$(state_of zombie)')"
[[ "$(state_of sealed)" == "drift!" ]] || fail "non-canonical token must render drift! (got '$(state_of sealed)')"
[[ "$(state_of closeout-noarch)" == "drift!" ]] || fail "§Z-closed non-archived must render drift! (got '$(state_of closeout-noarch)')"
[[ "$(state_of inverse)" == "drift!" ]] || fail "archived live-header must render drift! (got '$(state_of inverse)')"

leaked=$(grep -E '^\|' "$INDEX" | awk -F'|' '{s=$4; gsub(/^[ \t]+|[ \t]+$/,"",s); if(s=="live"){slug=$3; gsub(/^[ \t]+|[ \t]+$/,"",slug); print slug}}' | grep -cE 'zombie|sealed|inverse|closeout-noarch' || true)
[[ "$leaked" -eq 0 ]] || fail "a drift dir leaked into a live state cell"

[[ "$(state_of samedrift)" == "drift!" ]] || fail "same-date done-header must render drift! (got '$(state_of samedrift)')"

grep -qE '<!-- drift:5' "$INDEX" || fail "INDEX missing drift trailer count=5 (got: $(grep -oE '<!-- drift:[0-9]+' "$INDEX" || echo none))"

ln_drift=$(grep -n '| samedrift ' "$INDEX" | head -1 | cut -d: -f1)
ln_alive=$(grep -n '| alive ' "$INDEX" | head -1 | cut -d: -f1)
[[ -n "$ln_drift" && -n "$ln_alive" && "$ln_drift" -lt "$ln_alive" ]] || fail "drift! must sort above live within the same date (drift@$ln_drift alive@$ln_alive)"

[[ -z "$(find "$SP" -name '*.tmp' -o -name 'INDEX.md.??????*' 2>/dev/null)" ]] || fail "regen left a tmp orphan"

WS2="$TMP/ws2"
SP2="$WS2/.scratchpad"
mkdir -p "$SP2/dossier/2026-06-01-clean"
INDEX="$SP2/INDEX.md"
cat >"$SP2/dossier/2026-06-01-clean/DOSSIER.md" <<'EOF'
`2026-06-01` · `live` · `P1/1`

## §T

| id | P  | state | task | cite | verify |
| -- | -- | ----- | ---- | ---- | ------ |
| T1 | P1 | .     | x    | —    | —      |

## §Z — Closeout

_(empty)_
EOF
(cd "$WS2" && "$REGEN" .scratchpad)
grep -qE '<!-- drift:' "$INDEX" && fail "clean tree must not emit a drift trailer"

WS3="$TMP/ws3"
SP3="$WS3/.scratchpad"
mkdir -p "$SP3/dossier/2026-06-01-punct"
INDEX="$SP3/INDEX.md"
cat >"$SP3/dossier/2026-06-01-punct/DOSSIER.md" <<'EOF'
`2026-06-01` · `live` · `P1/1`

## §Z — Closeout

complete: true.
EOF
(cd "$WS3" && "$REGEN" .scratchpad)
[[ "$(state_of punct)" == "drift!" ]] || fail "§Z 'complete: true.' (trailing punctuation) must read closed → drift! (regen/reconcile predicate parity)"

layout_row() {
	local ws="$1" header="$2" sep="$3" r1="$4" r2="$5"
	local dir="$ws/.scratchpad/dossier/2026-08-04-shape"
	mkdir -p "$dir"
	{
		# shellcheck disable=SC2016
		printf '`2026-08-04` · `live` · `P1/1`\n\n'
		printf '## §T — Task ledger\n\n%s\n%s\n%s\n%s\n\n' "$header" "$sep" "$r1" "$r2"
		printf '## §Z — Closeout\n\n_(empty)_\n'
	} >"$dir/DOSSIER.md"
	(cd "$ws" && "$REGEN" .scratchpad >/dev/null 2>&1)
	grep 'shape' "$ws/.scratchpad/INDEX.md" | awk -F'|' '{gsub(/ /,"",$6); print $6}'
}

WS4="$TMP/ws4"
legacy_count=$(layout_row "$WS4" \
	'| id  | P   | state | task | cite | verify |' \
	'| --- | --- | ----- | ---- | ---- | ------ |' \
	'| T1  | P1  | x     | a    | [a1] | V1     |' \
	'| T2  | P1  | .     | b    | —    | —      |')

WS5="$TMP/ws5"
shaped_count=$(layout_row "$WS5" \
	'| id  | state | who | task | needs | cite | verify |' \
	'| --- | ----- | --- | ---- | ----- | ---- | ------ |' \
	'| T1  | x     | A   | a    | —     | [a1] | V1     |' \
	'| T2  | .     | A   | b    | T1    | —    | —      |')

[[ "$legacy_count" == "$shaped_count" ]] ||
	fail "the done count is read by header name, so both §T layouts must agree; legacy=$legacy_count who/needs=$shaped_count"
[[ "$shaped_count" == "1/2" ]] ||
	fail "one of two rows is x, so the who/needs layout must count 1/2, got $shaped_count"

WS6="$TMP/ws6"
mkdir -p "$WS6/.scratchpad/dossier/2026-08-05-nostate"
{
	# shellcheck disable=SC2016
	printf '`2026-08-05` · `live` · `P1/1`\n\n'
	printf '## Tasks\n\n| id | status | owner | task |\n|----|--------|-------|------|\n| T1 | x      | A     | a    |\n'
} >"$WS6/.scratchpad/dossier/2026-08-05-nostate/DOSSIER.md"
nostate_err=$( (cd "$WS6" && "$REGEN" .scratchpad 2>&1 >/dev/null) || true)
printf '%s' "$nostate_err" | grep -q 'names no state column' ||
	fail "a Tasks header naming no state column must be reported, not silently counted as zero; got: $nostate_err"

WS7="$TMP/ws7"
SP7="$WS7/.scratchpad"
INDEX="$SP7/INDEX.md"
mkdir -p "$SP7/dossier/_archive/2026-07-29-prose" "$SP7/dossier/_archive/2026-07-28-handoff"
cat >"$SP7/dossier/_archive/2026-07-29-prose/DOSSIER.md" <<'EOF'
`2026-07-29` · `done` · `P1/1`

## §Z — Closeout

abandoned: true

reason: superseded

summary: carried into the successor: the age-identity exemption
EOF
cat >"$SP7/dossier/_archive/2026-07-28-handoff/DOSSIER.md" <<'EOF'
`2026-07-28` · `done` · `P1/1`

## §Z — Closeout

successor: next-wave

summary: phase 1 done
EOF
(cd "$WS7" && "$REGEN" .scratchpad)

z_of() {
	awk -F'|' -v slug="$1" '
    NR>2 && $3 ~ slug {
      s=$9; gsub(/^[ \t]+|[ \t]+$/,"",s); print s; exit
    }' "$INDEX"
}

[[ "$(z_of prose)" == "abandoned" ]] ||
	fail "abandoned: true outranks a prose 'successor:' in the same §Z; got '$(z_of prose)'"
[[ "$(z_of handoff)" == "→next-wave" ]] ||
	fail "a real successor key must still render →<slug>; got '$(z_of handoff)'"

WS8="$TMP/ws8"
SP8="$WS8/.scratchpad"
INDEX="$SP8/INDEX.md"
mkdir -p "$SP8/dossier/2026-08-02-joined"
cat >"$SP8/dossier/2026-08-02-joined/DOSSIER.md" <<'EOF'
`2026-08-02` · `done` · `P1/1`

## §Z — Closeout

2026-08-02 10:00 — closed complete: true

summary: joined by a formatter
EOF
(cd "$WS8" && "$REGEN" .scratchpad)
[[ "$(state_of joined)" == "drift!" ]] ||
	fail "a formatter-joined key reads as unclosed, so the done header over it must surface as drift!; got '$(state_of joined)'"

WS9="$TMP/ws9"
SP9="$WS9/.scratchpad"
INDEX="$SP9/INDEX.md"
mkdir -p "$SP9/dossier/_archive/2026-07-02-badslug"
cat >"$SP9/dossier/_archive/2026-07-02-badslug/DOSSIER.md" <<'EOF'
`2026-07-02` · `done` · `P1/1`

## §Z — Closeout

successor: auth_2
EOF
(cd "$WS9" && "$REGEN" .scratchpad)
[[ "$(z_of badslug)" == "—" ]] ||
	fail "a successor value outside the slug charset must fall through, not truncate to a slug that names another dossier; got '$(z_of badslug)'"

printf 'ok\n'
