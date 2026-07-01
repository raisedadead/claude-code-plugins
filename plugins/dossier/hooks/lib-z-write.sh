#!/usr/bin/env bash
set -euo pipefail

DIR="${1:?usage: lib-z-write.sh <dossier-dir> <complete|successor|abandoned> <value> <summary> [cites]}"
KIND="${2:?kind required (complete|successor|abandoned)}"
VALUE="${3:-}"
SUMMARY="${4:-}"
CITES="${5:-—}"

FILE="${DIR%/}/DOSSIER.md"
[[ -f "$FILE" ]] || {
	printf 'lib-z-write: not found: %s\n' "$FILE" >&2
	exit 1
}

case "$KIND" in
complete)
	body="complete: true"
	;;
successor)
	[[ -n "$VALUE" ]] || {
		printf 'lib-z-write: successor requires a slug\n' >&2
		exit 1
	}
	body="successor: ${VALUE}"
	;;
abandoned)
	[[ -n "$VALUE" ]] || {
		printf 'lib-z-write: abandoned requires a reason\n' >&2
		exit 1
	}
	body=$'abandoned: true\n\nreason: '"${VALUE}"
	;;
*)
	printf 'lib-z-write: invalid kind "%s" (complete|successor|abandoned)\n' "$KIND" >&2
	exit 1
	;;
esac

grep -q '^## §Z' "$FILE" || {
	printf 'lib-z-write: no §Z heading in %s\n' "$FILE" >&2
	exit 1
}

TS=$(date "+%Y-%m-%d %H:%M")
TMP="$(mktemp "${FILE}.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

{
	awk '/^## §Z/ { exit } { print }' "$FILE"
	printf '## §Z — Closeout\n\n'
	printf '%s — closed\n\n' "$TS"
	printf '%s\n\n' "$body"
	printf 'summary: %s\n\n' "$SUMMARY"
	printf 'key cites: %s\n' "$CITES"
} >"$TMP"

mv "$TMP" "$FILE"
trap - EXIT
