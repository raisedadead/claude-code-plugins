#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECK="$SCRIPT_DIR/lib-ds-check.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-check.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

mk() {
	local rel="$1" token="$2" zbody="${3:-_(empty)_}"
	local dir="$TMP/.scratchpad/dossier/$rel"
	mkdir -p "$dir"
	cat >"$dir/DOSSIER.md" <<EOF
\`2026-06-01\` · \`${token}\` · \`P1/1\`

## §Z — Closeout

${zbody}
EOF
}

mk "2026-06-02-good" "live"
if ! "$CHECK" "$TMP/.scratchpad" 2>"$TMP/err"; then fail "clean tree must exit 0"; fi

mk "2026-06-03-zombie" "done" "complete: true"
if "$CHECK" "$TMP/.scratchpad" 2>"$TMP/err2"; then fail "drift present must exit non-zero"; fi
grep -q 'zombie' "$TMP/err2" || fail "ds:check must name the drift slug on stderr"
grep -qi 'drift' "$TMP/err2" || fail "ds:check must report DRIFT"

printf 'ok\n'
