#!/usr/bin/env bash
set -euo pipefail

DIR="${1:?usage: lib-x-refresh.sh <dossier-dir> <repo-label> <repo-path>}"
LABEL="${2:?repo-label required (matches §X col 1)}"
RP="${3:?repo-path required}"

FILE="${DIR%/}/DOSSIER.md"
[[ -f "$FILE" ]] || {
	printf 'lib-x-refresh: not found: %s\n' "$FILE" >&2
	exit 1
}
git -C "$RP" rev-parse --git-dir >/dev/null 2>&1 || {
	printf 'lib-x-refresh: not a git repo: %s\n' "$RP" >&2
	exit 1
}

if ! awk -v repo="$LABEL" '
  /^## §X/ { x = 1; next }
  /^## §[^X]/ { x = 0 }
  x && /^\|/ {
    n = split($0, f, "|")
    c = f[2]; gsub(/^[ \t]+|[ \t]+$/, "", c)
    if (c == repo) found = 1
  }
  END { exit(found ? 0 : 1) }
' "$FILE"; then
	printf 'lib-x-refresh: repo %s not found in §X of %s\n' "$LABEL" "$FILE" >&2
	exit 1
fi

BRANCH="$(git -C "$RP" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '—')"
if git -C "$RP" rev-parse --verify -q "origin/${BRANCH}" >/dev/null 2>&1; then
	AHEAD="$(git -C "$RP" rev-list --count "origin/${BRANCH}..HEAD" 2>/dev/null || echo '?')"
	if [[ "$AHEAD" == "0" ]]; then PUSHED=yes; else PUSHED=no; fi
else
	AHEAD="no-upstream"
	PUSHED=no
fi
TAG="$(git -C "$RP" describe --tags --abbrev=0 2>/dev/null || echo '—')"

TMP="${FILE}.tmp"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

DS_REPO="$LABEL" DS_BRANCH="$BRANCH" DS_AHEAD="$AHEAD" DS_TAG="$TAG" DS_PUSHED="$PUSHED" awk '
  BEGIN {
    repo = ENVIRON["DS_REPO"]; br = ENVIRON["DS_BRANCH"]; ah = ENVIRON["DS_AHEAD"]
    tg = ENVIRON["DS_TAG"]; pu = ENVIRON["DS_PUSHED"]
  }
  /^## §X/ { x = 1; print; next }
  /^## §[^X]/ { x = 0 }
  x && /^\|/ {
    nf = split($0, f, "|")
    c2 = f[2]; gsub(/^[ \t]+|[ \t]+$/, "", c2)
    if (c2 == repo) {
      f[3] = " " br " "; f[4] = " " ah " "; f[5] = " " tg " "; f[6] = " " pu " "
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
