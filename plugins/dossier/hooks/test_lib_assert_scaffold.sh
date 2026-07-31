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

D="$TMP/2026-07-07-happy"
write_full "$D"
"$ASSERT" "$D" || fail "full scaffold (dir arg) must exit 0"
"$ASSERT" "$D/DOSSIER.md" || fail "full scaffold (file arg) must exit 0"
"$ASSERT" "$D/" || fail "full scaffold (dir arg, trailing slash) must exit 0"

D2="$TMP/2026-07-07-missing"
write_full "$D2"
grep -v '^## §V — Invariants$' "$D2/DOSSIER.md" >"$D2/DOSSIER.md.tmp"
mv "$D2/DOSSIER.md.tmp" "$D2/DOSSIER.md"
if err="$("$ASSERT" "$D2" 2>&1)"; then fail "missing §V must exit non-zero"; fi
printf '%s' "$err" | grep -q '§V' || fail "error must name the missing §V section"

D3="$TMP/2026-07-07-notitle"
write_full "$D3"
grep -v '^# demo-slug$' "$D3/DOSSIER.md" >"$D3/DOSSIER.md.tmp"
mv "$D3/DOSSIER.md.tmp" "$D3/DOSSIER.md"
if "$ASSERT" "$D3" 2>/dev/null; then fail "missing title must exit non-zero"; fi

if "$ASSERT" "$TMP/nope" 2>/dev/null; then fail "missing DOSSIER.md must exit non-zero"; fi

printf 'ok\n'
