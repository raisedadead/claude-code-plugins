#!/usr/bin/env bash
set -euo pipefail

MODE=assert
if [[ "${1:-}" == "--consume" ]]; then
	MODE=consume
	shift
fi

if { [[ "$MODE" == assert ]] && [[ $# -ne 2 ]]; } || { [[ "$MODE" == consume ]] && [[ $# -ne 3 ]]; }; then
	printf 'usage: lib-assert-grill.sh <scratchpad-root> <slug> | --consume <scratchpad-root> <slug> <dossier-dir-key>\n' >&2
	exit 64
fi

ROOT="$1"
SLUG="$2"
DIR_KEY="${3:-}"
shopt -s nullglob
matches=("$ROOT"/dossier/.grill/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-"$SLUG".md)
shopt -u nullglob

if [[ ${#matches[@]} -eq 0 ]]; then
	printf 'grill artifact missing for slug %s\n' "$SLUG" >&2
	exit 1
fi

GRILL=""
for f in "${matches[@]}"; do
	if [[ -z "$GRILL" || "$f" > "$GRILL" ]]; then GRILL="$f"; fi
done

if grep -q '^CONSUMED: ' "$GRILL"; then
	printf 'grill artifact already consumed: %s (%s) — run ds:grill %s for a fresh one\n' \
		"$GRILL" "$(grep '^CONSUMED: ' "$GRILL" | head -1)" "$SLUG" >&2
	exit 4
fi

if ! grep -qE '^FRONTIER: (empty|empty-except-external n=[0-9]+)$' "$GRILL"; then
	printf 'grill incomplete: no closed FRONTIER footer in %s (finish via ds:grill --resume)\n' "$GRILL" >&2
	exit 2
fi

if ! grep -q '^CONFIRMED: ' "$GRILL"; then
	printf 'grill unconfirmed: no CONFIRMED footer in %s (operator confirmation required)\n' "$GRILL" >&2
	exit 3
fi

if [[ "$MODE" == consume ]]; then
	TMP_FILE="$(mktemp "$GRILL.tmp.XXXXXX")"
	cp "$GRILL" "$TMP_FILE"
	printf 'CONSUMED: %s\n' "$DIR_KEY" >>"$TMP_FILE"
	mv "$TMP_FILE" "$GRILL"
fi

printf '%s\n' "$GRILL"
