#!/usr/bin/env bash
set -euo pipefail

DIR="${1:?usage: lib-s-append.sh <dossier-dir> <event-text...>}"
shift
EVENT="$*"
[[ -n "$EVENT" ]] || {
	printf 'lib-s-append: empty event text\n' >&2
	exit 1
}

FILE="${DIR%/}/DOSSIER.md"
[[ -f "$FILE" ]] || {
	printf 'lib-s-append: not found: %s\n' "$FILE" >&2
	exit 1
}

if [[ "${DS_TS_SECONDS:-0}" == "1" ]]; then
	TS="$(date "+%Y-%m-%d %H:%M:%S")"
else
	TS="$(date "+%Y-%m-%d %H:%M")"
fi
ENTRY="${TS} ${EVENT}"

TMP="$(mktemp "${FILE}.XXXXXX")"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

DS_ENTRY="$ENTRY" awk '
  BEGIN { e = ENVIRON["DS_ENTRY"]; done = 0 }
  /^## §Z/ && !done { printf "%s\n\n", e; done = 1 }
  { print }
  END { if (!done) printf "\n%s\n", e }
' "$FILE" >"$TMP"

mv "$TMP" "$FILE"
trap - EXIT
