#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VM="$SCRIPT_DIR/lib-vm-checks.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-vm.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

NOW=$(date +%s)
iso_ago() {
	local e=$((NOW - $1))
	date -u -r "$e" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$e" +%Y-%m-%dT%H:%M:%SZ
}

write_clean() {
	local dir="$1"
	mkdir -p "$dir"
	{
		printf '# clean\n\n'
		# shellcheck disable=SC2016
		printf '`2026-07-07` · `live` · `P1/1`\n\n'
		cat <<'EOF'
## §T — Task ledger

| id | P  | state | task  | cite   | verify |
|----|----|-------|-------|--------|--------|
| T1 | P1 | x     | do it | abc123 | —      |

## §S — Rolling status log

2026-07-07 12:00 ds:new — created slug=clean phase=P1

2026-07-07 12:01 ds:build T1 START

2026-07-07 12:05 ds:build T1 DONE → x cite=abc123
EOF
	} >"$dir/DOSSIER.md"
}

write_dirty() {
	local dir="$1"
	mkdir -p "$dir"
	{
		printf '# dirty\n\n'
		# shellcheck disable=SC2016
		printf '`2026-07-07` · `live` · `P1/1`\n\n'
		cat <<'EOF'
## §T — Task ledger

| id | P  | state | task   | cite | verify |
|----|----|-------|--------|------|--------|
| T3 | P1 | x     | broken |      | —      |

## §S — Rolling status log

2026-07-07 12:00 ds:new — created slug=dirty phase=P1

ds:build T2 START

2026-07-07 12:10 ds:build T9 START
EOF
	} >"$dir/DOSSIER.md"
	: >"$dir/DOSSIER.md.tmp"
	printf '{"started": "%s", "skill": "ds:build"}' "$(iso_ago 3600)" >"$dir/.ds-lock"
}

CLEAN_ROOT="$TMP/clean/.scratchpad"
write_clean "$CLEAN_ROOT/dossier/2026-07-07-clean"
clean_out="$("$VM" "$CLEAN_ROOT" 2>&1)" || fail "clean tree must exit 0"
[[ -z "$clean_out" ]] || fail "clean tree must emit no findings, got: $clean_out"

DIRTY_ROOT="$TMP/dirty/.scratchpad"
write_dirty "$DIRTY_ROOT/dossier/2026-07-07-dirty"
if dirty_out="$("$VM" "$DIRTY_ROOT" 2>&1)"; then fail "dirty tree must exit non-zero"; fi
printf '%s' "$dirty_out" | grep -q 'Vm.2' || fail "must flag Vm.2 (missing §S timestamp)"
printf '%s' "$dirty_out" | grep -q 'CRITICAL Vm.3' || fail "must flag Vm.3 critical (x-row empty cite)"
printf '%s' "$dirty_out" | grep -q 'Vm.6' || fail "must flag Vm.6 (START without DONE)"
printf '%s' "$dirty_out" | grep -q 'Vm.8' || fail "must flag Vm.8 (orphan temp file)"
printf '%s' "$dirty_out" | grep -q 'Vm.9' || fail "must flag Vm.9 (stale lock)"

write_shaped() {
	local dir="$1" header="$2" sep="$3" row="$4" heading="${5:-## §T — Task ledger}"
	mkdir -p "$dir"
	{
		printf '# shaped\n\n'
		# shellcheck disable=SC2016
		printf '`2026-08-04` · `live`\n\n'
		printf '%s\n\n%s\n%s\n%s\n' "$heading" "$header" "$sep" "$row"
	} >"$dir/DOSSIER.md"
}

assert_vm3_by_header_name() {
	local label="$1" root="$2" want="$3" out
	out="$("$VM" "$root" 2>&1)" || true
	if [[ "$want" == yes ]]; then
		printf '%s' "$out" | grep -q 'CRITICAL Vm.3' ||
			fail "$label: state and cite are read by header name, so an x-row with an empty cite must flag Vm.3; got: $out"
	else
		printf '%s' "$out" | grep -q 'CRITICAL Vm.3' &&
			fail "$label: state and cite are read by header name, so a cited x-row must not flag Vm.3; got: $out"
	fi
	return 0
}

LEGACY="$TMP/legacy/.scratchpad"
write_shaped "$LEGACY/dossier/2026-08-04-legacy" \
	'| id | P  | state | task  | cite | verify |' \
	'|----|----|-------|-------|------|--------|' \
	'| T1 | P1 | x     | do it | —    | —      |'
assert_vm3_by_header_name "legacy id/P/state/task/cite layout" "$LEGACY" yes

SHIFTED="$TMP/shifted/.scratchpad"
write_shaped "$SHIFTED/dossier/2026-08-04-shifted" \
	'| id | state | who | task  | needs | cite | verify |' \
	'|----|-------|-----|-------|-------|------|--------|' \
	'| T1 | x     | A   | do it | —     | —    | —      |'
assert_vm3_by_header_name "who/needs layout, uncited" "$SHIFTED" yes

SHIFTED_OK="$TMP/shifted-ok/.scratchpad"
write_shaped "$SHIFTED_OK/dossier/2026-08-04-shifted-ok" \
	'| id | state | who | task  | needs | cite   | verify |' \
	'|----|-------|-----|-------|-------|--------|--------|' \
	'| T1 | x     | A   | do it | —     | abc123 | —      |'
assert_vm3_by_header_name "who/needs layout, cited" "$SHIFTED_OK" no

WORDED="$TMP/worded/.scratchpad"
write_shaped "$WORDED/dossier/2026-08-04-worded" \
	'| id | state | who | task  | needs | cite | verify |' \
	'|----|-------|-----|-------|-------|------|--------|' \
	'| T1 | x     | A   | do it | —     | —    | —      |' \
	'## Tasks'
assert_vm3_by_header_name "worded Tasks heading, uncited" "$WORDED" yes

WORDED_OK="$TMP/worded-ok/.scratchpad"
write_shaped "$WORDED_OK/dossier/2026-08-04-worded-ok" \
	'| id | state | who | task  | needs | cite   | verify |' \
	'|----|-------|-----|-------|-------|--------|--------|' \
	'| T1 | x     | A   | do it | —     | abc123 | —      |' \
	'## Tasks'
assert_vm3_by_header_name "worded Tasks heading, cited" "$WORDED_OK" no

write_worded_pair() {
	local dir="$1" tasks_heading="$2" status_heading="$3"
	mkdir -p "$dir"
	{
		printf '# wp\n\n'
		# shellcheck disable=SC2016
		printf '`2026-08-04` · `live`\n\n'
		printf '%s\n\n' "$tasks_heading"
		printf '| id | state | who | task | needs | cite | verify |\n'
		printf '|----|-------|-----|------|-------|------|--------|\n'
		printf '| T1 | x     | A   | a    | —     |      | —      |\n\n'
		printf '%s\n\n' "$status_heading"
		printf 'ds:build T9 START\n'
	} >"$dir/DOSSIER.md"
}

assert_three_findings() {
	local label="$1" root="$2" out
	out="$("$VM" "$root" 2>&1 || true)"
	printf '%s' "$out" | grep -q 'CRITICAL Vm.3' || fail "$label: Vm.3 must fire; got: $out"
	printf '%s' "$out" | grep -q 'Vm.2' || fail "$label: Vm.2 must fire, so the Status pattern is exercised; got: $out"
	printf '%s' "$out" | grep -q 'Vm.6' || fail "$label: Vm.6 must fire, so START/DONE pairing reads the Status section; got: $out"
}

for spelling in "## Tasks|## Status" "## Tasks — Task ledger|## Status — Rolling status log" "## §T — Task ledger|## §S — Rolling status log"; do
	th="${spelling%%|*}"
	sh_="${spelling##*|}"
	slug="$(printf '%s' "$th" | tr -c '[:alnum:]' '-')"
	root="$TMP/pair$slug/.scratchpad"
	write_worded_pair "$root/dossier/2026-08-04-pair" "$th" "$sh_"
	assert_three_findings "heading pair '$th'" "$root"
done

LOOKALIKE="$TMP/lookalike/.scratchpad"
write_worded_pair "$LOOKALIKE/dossier/2026-08-04-lookalike" '## Taskslist' '## Statusline'
lookalike_out="$("$VM" "$LOOKALIKE" 2>&1 || true)"
printf '%s' "$lookalike_out" | grep -q 'Vm\.' &&
	fail "a heading that merely starts with the section word is not that section; got: $lookalike_out"

SIGIL_LOOKALIKE="$TMP/sigil-lookalike/.scratchpad"
write_worded_pair "$SIGIL_LOOKALIKE/dossier/2026-08-04-sigil" '## §Task ledger' '## §Status log'
sigil_out="$("$VM" "$SIGIL_LOOKALIKE" 2>&1 || true)"
printf '%s' "$sigil_out" | grep -q 'Vm\.' &&
	fail "## §Task must not be read as the Tasks section; got: $sigil_out"

UNNAMED="$TMP/unnamed/.scratchpad"
write_shaped "$UNNAMED/dossier/2026-08-04-unnamed" \
	'| id | status | owner | task |' \
	'|----|--------|-------|------|' \
	'| T1 | x      | A     | do   |'
unnamed_out="$("$VM" "$UNNAMED" 2>&1 || true)"
printf '%s' "$unnamed_out" | grep -q 'names no state or cite column' ||
	fail "a §T header naming neither column must say so, and name both; got: $unnamed_out"
printf '%s' "$unnamed_out" | grep -q 'CRITICAL Vm.3' &&
	fail "an unreadable §T header must not also emit a row-level verdict; got: $unnamed_out"

printf 'ok\n'
