#!/usr/bin/env bash
set -euo pipefail

DIR="${1:?usage: lib-header-state.sh <dossier-dir> <live|done|paused>}"
STATE="${2:?new-state required (live|done|paused)}"

FILE="${DIR%/}/DOSSIER.md"
[[ -f "$FILE" ]] || {
	printf 'lib-header-state: not found: %s\n' "$FILE" >&2
	exit 1
}

case "$STATE" in
live | done | paused) ;;
*)
	printf 'lib-header-state: invalid state "%s" (want live|done|paused)\n' "$STATE" >&2
	exit 1
	;;
esac

TMP="$(mktemp "${FILE}.XXXXXX")"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

if ! DS_STATE="$STATE" awk '
  BEGIN { st = ENVIRON["DS_STATE"]; flipped = 0 }
  !flipped && /^`.*` · `.*` · / {
    n = split($0, p, "`")
    p[4] = st
    out = p[1]
    for (i = 2; i <= n; i++) out = out "`" p[i]
    print out
    flipped = 1
    next
  }
  { print }
  END { exit(flipped ? 0 : 3) }
' "$FILE" >"$TMP"; then
	printf 'lib-header-state: header metadata line not found in %s\n' "$FILE" >&2
	exit 1
fi

mv "$TMP" "$FILE"
trap - EXIT
