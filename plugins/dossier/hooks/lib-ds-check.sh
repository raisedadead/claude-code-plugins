#!/usr/bin/env bash
set -euo pipefail

SCRATCHPAD="${1:-.scratchpad}"
HERE="$(cd "$(dirname "$0")" && pwd)"

"${HERE}/lib-regen-index.sh" "${SCRATCHPAD}"

INDEX="${SCRATCHPAD}/INDEX.md"
[[ -f "${INDEX}" ]] || exit 0

drift_line=$(grep -oE '<!-- drift:[0-9]+ slugs:[^>]*-->' "${INDEX}" 2>/dev/null | head -1 || true)
[[ -n "${drift_line}" ]] || exit 0

n=$(printf '%s' "${drift_line}" | grep -oE 'drift:[0-9]+' | grep -oE '[0-9]+')
slugs=$(printf '%s' "${drift_line}" | sed -E 's/.*slugs:(.*) -->/\1/')

printf 'ds:check: Vm.1/Vm.4 DRIFT — %s dossier(s) with header/location/§Z disagreement: %s\n' "${n}" "${slugs}" >&2
printf 'reconcile: session-start self-heals §Z-closed drift; otherwise finish the close (ds:close --resume) or fix the header token.\n' >&2
exit 1
