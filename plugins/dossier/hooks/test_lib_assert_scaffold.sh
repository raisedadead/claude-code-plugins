#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSERT="$SCRIPT_DIR/lib-assert-scaffold.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-scaffold.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

write_full() {
	local dir="$1"
	mkdir -p "$dir"
	{
		printf '# demo-slug\n\n'
		# shellcheck disable=SC2016
		printf '`2026-07-07` · `live` · `P1/1`\n\n'
		cat <<'EOF'
## §G — Goal

do the thing

## §C — Constraints

none

## §I — Interfaces

_(empty)_

## §V — Invariants

| id | invariant | check |
|----|-----------|-------|

## §T — Task ledger

| id | P | state | task | cite | verify |
|----|---|-------|------|------|--------|

## §B — Bug ledger

| id | bug | root cause | invariant added | fix cite |
|----|-----|------------|-----------------|----------|

## §X — Cross-repo state

| repo | branch | ahead | tag | pushed | notes |
|------|--------|-------|-----|--------|-------|

## §S — Rolling status log

2026-07-07 12:00 ds:new — created slug=demo-slug phase=P1

## §Z — Closeout

_(empty)_
EOF
	} >"$dir/DOSSIER.md"
}

write_worded() {
	local dir="$1"
	mkdir -p "$dir"
	cat >"$dir/DOSSIER.md" <<'EOF'
# demo-slug

`2026-08-05` · `live` · `P1/1`

## Goal

do the thing

Scope:

- one thing

## Constraints

- none

## Interfaces

_(empty — populate when first contract lands)_

## Invariants

| id | invariant | check |
|----|-----------|-------|

## Tasks

| id | state | who | task | needs | cite | verify |
|----|-------|-----|------|-------|------|--------|

## Bugs

| id | bug | root cause | invariant added | fix cite |
|----|-----|------------|-----------------|----------|

## Repos

| repo | branch | ahead | tag | pushed | notes |
|------|--------|-------|-----|--------|-------|

## Status

2026-08-05 12:00 ds:new — created slug=demo-slug

## Closeout

_(empty — written by ds:close)_
EOF
}

assert_section_required() {
	local writer="$1" heading="$2" tag="$3"
	local slot
	slot="$(printf %s "$heading" | cksum | cut -d" " -f1)"
	local dir="$TMP/req-$slot-${writer#write_}"
	local err
	"$writer" "$dir"
	grep -vxF "$heading" "$dir/DOSSIER.md" >"$dir/DOSSIER.md.tmp"
	mv "$dir/DOSSIER.md.tmp" "$dir/DOSSIER.md"
	if err="$("$ASSERT" "$dir" 2>&1)"; then
		fail "dropping '$heading' must exit non-zero"
	fi
	printf '%s' "$err" | grep -qF "$tag" || fail "error for dropped '$heading' must name $tag"
}

SIGIL_SECTIONS=(
	'## §G — Goal|Goal'
	'## §C — Constraints|Constraints'
	'## §I — Interfaces|Interfaces'
	'## §V — Invariants|Invariants'
	'## §T — Task ledger|Tasks'
	'## §B — Bug ledger|Bugs'
	'## §X — Cross-repo state|Repos'
	'## §S — Rolling status log|Status'
	'## §Z — Closeout|Closeout'
)

WORDED_SECTIONS=(
	'## Goal|Goal'
	'## Constraints|Constraints'
	'## Interfaces|Interfaces'
	'## Invariants|Invariants'
	'## Tasks|Tasks'
	'## Bugs|Bugs'
	'## Repos|Repos'
	'## Status|Status'
	'## Closeout|Closeout'
)

D="$TMP/2026-07-07-happy"
write_full "$D"
"$ASSERT" "$D" || fail "full scaffold (dir arg) must exit 0"
"$ASSERT" "$D/DOSSIER.md" || fail "full scaffold (file arg) must exit 0"
"$ASSERT" "$D/" || fail "full scaffold (dir arg, trailing slash) must exit 0"

DW="$TMP/2026-08-05-worded"
write_worded "$DW"
"$ASSERT" "$DW" || fail "worded scaffold as ds:new writes it must exit 0"

for pair in "${SIGIL_SECTIONS[@]}"; do
	assert_section_required write_full "${pair%%|*}" "${pair##*|}"
done

for pair in "${WORDED_SECTIONS[@]}"; do
	assert_section_required write_worded "${pair%%|*}" "${pair##*|}"
done

D3="$TMP/2026-07-07-notitle"
write_full "$D3"
grep -v '^# demo-slug$' "$D3/DOSSIER.md" >"$D3/DOSSIER.md.tmp"
mv "$D3/DOSSIER.md.tmp" "$D3/DOSSIER.md"
if "$ASSERT" "$D3" 2>/dev/null; then fail "missing title must exit non-zero"; fi

if "$ASSERT" "$TMP/nope" 2>/dev/null; then fail "missing DOSSIER.md must exit non-zero"; fi

printf 'ok\n'
