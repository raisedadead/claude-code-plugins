#!/usr/bin/env bash
set -euo pipefail

DIR="${1:?usage: lib-row-flip.sh <dossier-dir> <row-id> <new-state> [cite]}"
ID="${2:?row-id required (e.g. T3)}"
STATE="${3:?new-state required (. ~ x ! ?)}"
CITE="${4:-}"

FILE="${DIR%/}/DOSSIER.md"
[[ -f "$FILE" ]] || {
	printf 'lib-row-flip: not found: %s\n' "$FILE" >&2
	exit 1
}

case "$STATE" in
. | '~' | x | '!' | '?') ;;
*)
	printf 'lib-row-flip: invalid state "%s" (want . ~ x ! ?)\n' "$STATE" >&2
	exit 1
	;;
esac

if ! awk -v id="$ID" '
  /^\|/ {
    n = split($0, f, "|")
    c = f[2]; gsub(/^[ \t]+|[ \t]+$/, "", c)
    if (c == id) found = 1
  }
  END { exit(found ? 0 : 1) }
' "$FILE"; then
	printf 'lib-row-flip: row id %s not found in %s\n' "$ID" "$FILE" >&2
	exit 1
fi

TMP="${FILE}.tmp"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

DS_ID="$ID" DS_STATE="$STATE" DS_CITE="$CITE" awk '
  BEGIN { id = ENVIRON["DS_ID"]; st = ENVIRON["DS_STATE"]; ct = ENVIRON["DS_CITE"] }
  /^\|/ {
    nf = split($0, f, "|")
    c2 = f[2]; gsub(/^[ \t]+|[ \t]+$/, "", c2)
    if (c2 == id) {
      f[4] = " " st " "
      if (ct != "") f[6] = " " ct " "
      out = ""
      for (i = 2; i < nf; i++) out = out "|" f[i]
      print out "|"
      next
    }
  }
  { print }
' "$FILE" >"$TMP"

mv "$TMP" "$FILE"
trap - EXIT
