#!/usr/bin/env bash
set -euo pipefail

SCRATCHPAD="${1:-.scratchpad}"
DOSSIER_DIR="${SCRATCHPAD}/dossier"
ARCHIVE="${DOSSIER_DIR}/_archive"

[[ -d "${DOSSIER_DIR}" ]] || exit 0

HERE="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=lib-sections.sh disable=SC1091
source "${HERE}/lib-sections.sh"

for d in "${DOSSIER_DIR}"/*/; do
	[[ -d "${d}" ]] || continue
	base="$(basename "${d}")"
	[[ "${base}" == "_archive" ]] && continue
	doss="${d}DOSSIER.md"
	[[ -f "${doss}" ]] || continue
	[[ -e "${d}.ds-lock" ]] && continue

	zsec=$(awk -v sec_z="$DS_SEC_CLOSEOUT" '$0 ~ sec_z { z = 1 } z { print }' "${doss}" 2>/dev/null || true)

	z_closed=0
	if printf '%s' "${zsec}" | grep -qE "${DS_Z_COMPLETE}|${DS_Z_ABANDONED}|${DS_Z_SUCCESSOR}"; then
		z_closed=1
	fi

	[[ "${z_closed}" -eq 1 ]] || continue

	if "${HERE}/lib-archive-move.sh" "${d%/}" "${ARCHIVE}" 2>/dev/null; then
		"${HERE}/lib-header-state.sh" "${ARCHIVE}/${base}" "done" 2>/dev/null || true
		"${HERE}/lib-s-append.sh" "${ARCHIVE}/${base}" "ds:reconcile — auto-archived closed dossier (§Z-backed, was not under _archive)" 2>/dev/null || true
	fi
done

if [[ -d "${ARCHIVE}" ]]; then
	for a in "${ARCHIVE}"/*/; do
		[[ -d "${a}" ]] || continue
		adoss="${a}DOSSIER.md"
		[[ -f "${adoss}" ]] || continue
		ahdr=$(awk '/^`.*` · `.*` · / { n = split($0, p, "`"); gsub(/^[ \t]+|[ \t]+$/, "", p[4]); print p[4]; exit }' "${adoss}")
		if [[ "${ahdr}" != "done" ]]; then
			"${HERE}/lib-header-state.sh" "${a%/}" "done" 2>/dev/null || true
		fi
	done
fi
