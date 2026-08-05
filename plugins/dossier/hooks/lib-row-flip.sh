#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib-sections.sh disable=SC1091
source "${HERE}/lib-sections.sh"

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
	printf 'lib-row-flip: refuses Bugs rows (no state column — would destroy cells); use ds:backprop\n' >&2
	exit 1
	;;
esac

info=$(DS_ID="$ID" awk -v any="$DS_SEC_ANY" -v sec_t="$DS_SEC_TASKS" '
  function trim(s){ gsub(/^[ \t]+|[ \t]+$/,"",s); return s }
  BEGIN { id = ENVIRON["DS_ID"]; in_t = 0; found = 0; cite = ""; hdr = 0; cs = 0; cc = 0 }
  $0 ~ sec_t { in_t = 1; hdr = 0; cs = 0; cc = 0; next }
  $0 ~ any   { in_t = 0 }
  in_t && /^\|/ {
    n = split($0, f, "|")
    if (!hdr) {
      hdr = 1
      for (i = 2; i < n; i++) {
        if (trim(f[i]) == "state") cs = i
        if (trim(f[i]) == "cite")  cc = i
      }
      next
    }
    if (trim(f[2]) == id) { found++; rownf = n; cite = (cc ? trim(f[cc]) : "") }
  }
  END { print found "|" cs "|" cc "|" rownf+0 "|" cite }
' "$FILE")
IFS='|' read -r n_found COL_STATE COL_CITE ROW_NF cur_cite <<<"$info"

if [[ "$COL_STATE" == "0" || "$COL_CITE" == "0" ]]; then
	printf 'lib-row-flip: Tasks header in %s names no state/cite column; refusing to edit by position\n' "$FILE" >&2
	exit 1
fi

if [[ "$n_found" -eq 1 && ("$COL_STATE" -ge "$ROW_NF" || "$COL_CITE" -ge "$ROW_NF") ]]; then
	printf 'lib-row-flip: row %s has %s cells, fewer than the header names; refusing to write past its end\n' "$ID" "$((ROW_NF - 2))" >&2
	exit 1
fi

if [[ "$n_found" -eq 0 ]]; then
	printf 'lib-row-flip: row id %s not found in the Tasks section of %s\n' "$ID" "$FILE" >&2
	exit 1
fi
if [[ "$n_found" -gt 1 ]]; then
	printf 'lib-row-flip: row id %s matches %s Tasks rows (ambiguous)\n' "$ID" "$n_found" >&2
	exit 1
fi

if [[ "$STATE" == "x" ]]; then
	eff_cite="${CITE:-$cur_cite}"
	eff_norm=$(printf '%s' "$eff_cite" | tr -d '[:space:]')
	if [[ -z "$eff_norm" || "$eff_norm" == "—" || "$eff_norm" == "-" ]]; then
		printf 'lib-row-flip: %s -> x requires a cite (Vm.3); lib-vm-checks.sh reads "", "—" and "-" alike as empty, so pass a real cite or set the row cite first\n' "$ID" >&2
		exit 1
	fi
fi

TMP="$(mktemp "${FILE}.XXXXXX")"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

DS_ID="$ID" DS_STATE="$STATE" DS_CITE="$CITE" DS_CS="$COL_STATE" DS_CC="$COL_CITE" awk -v any="$DS_SEC_ANY" -v sec_t="$DS_SEC_TASKS" '
  BEGIN { id = ENVIRON["DS_ID"]; st = ENVIRON["DS_STATE"]; ct = ENVIRON["DS_CITE"];
          cs = ENVIRON["DS_CS"] + 0; cc = ENVIRON["DS_CC"] + 0; in_t = 0; hdr = 0 }
  $0 ~ sec_t { in_t = 1; hdr = 0; print; next }
  $0 ~ any   { in_t = 0; print; next }
  in_t && /^\|/ {
    nf = split($0, f, "|")
    if (!hdr) { hdr = 1; print; next }
    c2 = f[2]; gsub(/^[ \t]+|[ \t]+$/, "", c2)
    if (c2 == id) {
      f[cs] = " " st " "
      if (ct != "") f[cc] = " " ct " "
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
