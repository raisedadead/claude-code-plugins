#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib-sections.sh disable=SC1091
source "${HERE}/lib-sections.sh"

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

required=(Goal Constraints Interfaces Invariants Tasks Bugs Repos Status Closeout)
missing=()

grep -q '^# ' "$DOSSIER" || missing+=("title")

for tag in "${required[@]}"; do
	pat_var="DS_SEC_$(printf '%s' "$tag" | tr '[:lower:]' '[:upper:]')"
	grep -qE "${!pat_var}" "$DOSSIER" || missing+=("$tag")
done

if ((${#missing[@]} > 0)); then
	printf 'lib-assert-scaffold: DOSSIER.md missing required section(s): %s\n' "${missing[*]}" >&2
	printf '  file: %s\n' "$DOSSIER" >&2
	exit 1
fi

exit 0
