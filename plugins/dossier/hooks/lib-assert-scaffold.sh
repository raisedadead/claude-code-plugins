#!/usr/bin/env bash
set -euo pipefail

ARG="${1:?usage: lib-assert-scaffold.sh <dossier-dir-or-DOSSIER.md>}"

if [[ -d "$ARG" ]]; then
	DOSSIER="${ARG%/}/DOSSIER.md"
else
	DOSSIER="$ARG"
fi

[[ -f "$DOSSIER" ]] || {
	printf 'lib-assert-scaffold: no DOSSIER.md at: %s\n' "$DOSSIER" >&2
	exit 1
}

required=(§G §C §I §V §T §B §X §S §Z)
missing=()

grep -q '^# ' "$DOSSIER" || missing+=("title")

for tag in "${required[@]}"; do
	grep -q "^## ${tag}" "$DOSSIER" || missing+=("$tag")
done

if ((${#missing[@]} > 0)); then
	printf 'lib-assert-scaffold: DOSSIER.md missing required section(s): %s\n' "${missing[*]}" >&2
	printf '  file: %s\n' "$DOSSIER" >&2
	exit 1
fi

exit 0
