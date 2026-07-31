#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 || ! -f "${2:-}" ]]; then
	printf 'usage: lib-changelog-write.sh <changelog-path> <section-file> <idempotency-key>\n' >&2
	exit 64
fi

CHANGELOG="$1"
SECTION="$2"
KEY="$3"

if [[ ! -f "$CHANGELOG" ]]; then
	printf 'changelog missing: %s (scaffold it first)\n' "$CHANGELOG" >&2
	exit 1
fi

if grep -qF "$KEY" "$CHANGELOG"; then
	printf 'section already present (key %s) in %s — refusing duplicate write\n' "$KEY" "$CHANGELOG" >&2
	exit 3
fi

TMP_FILE="$(mktemp "$CHANGELOG.tmp.XXXXXX")"
cleanup() { rm -f "$TMP_FILE"; }
trap cleanup EXIT
awk -v secfile="$SECTION" '
BEGIN {
	while ((getline line < secfile) > 0) sec = sec line "\n"
	close(secfile)
}
!done && /^## / {
	printf "%s\n", sec
	done = 1
}
{ print }
END {
	if (!done) printf "\n%s", sec
}
' "$CHANGELOG" >"$TMP_FILE"
mv "$TMP_FILE" "$CHANGELOG"

printf '%s\n' "$CHANGELOG"
