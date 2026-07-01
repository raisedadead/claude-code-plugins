#!/usr/bin/env bash
set -euo pipefail

SCRATCHPAD="${1:-.scratchpad}"
DOSSIER_DIR="${SCRATCHPAD}/dossier"
ARCHIVE="${DOSSIER_DIR}/_archive"

[[ -d "${DOSSIER_DIR}" ]] || exit 0

HERE="$(cd "$(dirname "$0")" && pwd)"

for d in "${DOSSIER_DIR}"/*/; do
	[[ -d "${d}" ]] || continue
	base="$(basename "${d}")"
	[[ "${base}" == "_archive" ]] && continue
	doss="${d}DOSSIER.md"
	[[ -f "${doss}" ]] || continue
	[[ -e "${d}.ds-lock" ]] && continue

	hdr=$(awk '/^`.*` · `.*` · / { n = split($0, p, "`"); gsub(/^[ \t]+|[ \t]+$/, "", p[4]); print p[4]; exit }' "${doss}")
	zsec=$(awk '/^## §Z/,EOF { print }' "${doss}" 2>/dev/null || true)

	z_closed=0
	if printf '%s' "${zsec}" | grep -qE '(^|[[:space:]])(complete:[[:space:]]+true|successor:[[:space:]]+[^[:space:]]|abandoned:[[:space:]]+true)'; then
		z_closed=1
	fi

	[[ "${z_closed}" -eq 1 ]] || continue

	if [[ "${hdr}" != "done" ]]; then
		"${HERE}/lib-header-state.sh" "${d%/}" "done" 2>/dev/null || true
	fi

	if "${HERE}/lib-archive-move.sh" "${d%/}" "${ARCHIVE}" 2>/dev/null; then
		"${HERE}/lib-s-append.sh" "${ARCHIVE}/${base}" "ds:reconcile — auto-archived closed dossier (§Z-backed, was not under _archive)" 2>/dev/null || true
	fi
done
