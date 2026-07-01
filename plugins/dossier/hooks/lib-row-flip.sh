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

case "$ID" in
B[0-9]*)
	printf 'lib-row-flip: refuses §B rows (no state column — would destroy cells); use ds:backprop\n' >&2
	exit 1
	;;
esac

info=$(DS_ID="$ID" awk '
  BEGIN { id = ENVIRON["DS_ID"]; in_t = 0; found = 0; cite = "" }
  /^## §T/ { in_t = 1; next }
  /^## §/  { in_t = 0 }
  in_t && /^\|/ {
    n = split($0, f, "|")
    c = f[2]; gsub(/^[ \t]+|[ \t]+$/, "", c)
    if (c == id) { found++; cc = f[6]; gsub(/^[ \t]+|[ \t]+$/, "", cc); cite = cc }
  }
  END { print found "|" cite }
' "$FILE")
n_found="${info%%|*}"
cur_cite="${info#*|}"

if [[ "$n_found" -eq 0 ]]; then
	printf 'lib-row-flip: row id %s not found in §T of %s\n' "$ID" "$FILE" >&2
	exit 1
fi
if [[ "$n_found" -gt 1 ]]; then
	printf 'lib-row-flip: row id %s matches %s §T rows (ambiguous)\n' "$ID" "$n_found" >&2
	exit 1
fi

if [[ "$STATE" == "x" ]]; then
	eff_cite="$CITE"
	[[ -z "$eff_cite" ]] && eff_cite="$cur_cite"
	if [[ -z "$eff_cite" || "$eff_cite" == "—" ]]; then
		printf 'lib-row-flip: %s -> x requires a cite (Vm.3); pass one or set the row cite first\n' "$ID" >&2
		exit 1
	fi
fi

TMP="${FILE}.tmp"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

DS_ID="$ID" DS_STATE="$STATE" DS_CITE="$CITE" awk '
  BEGIN { id = ENVIRON["DS_ID"]; st = ENVIRON["DS_STATE"]; ct = ENVIRON["DS_CITE"]; in_t = 0 }
  /^## §T/ { in_t = 1; print; next }
  /^## §/  { in_t = 0; print; next }
  in_t && /^\|/ {
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
