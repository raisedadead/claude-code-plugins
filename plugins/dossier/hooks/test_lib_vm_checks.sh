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

printf 'ok\n'
