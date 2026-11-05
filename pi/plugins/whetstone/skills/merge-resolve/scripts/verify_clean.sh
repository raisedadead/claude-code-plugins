#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
BASELINE="-"
COUNT_CMD=()
if [[ $# -ge 2 ]]; then
	BASELINE="$2"
	shift 2
	COUNT_CMD=("$@")
fi

MARKER_RE='^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|) '
markers=$({ grep -rIE "${MARKER_RE}" "${ROOT}" --exclude-dir=.git 2>/dev/null || true; } | wc -l | tr -d ' ')
if [[ "${markers}" -ne 0 ]]; then
	printf 'verify_clean: %s conflict marker(s) remain under %s\n' "${markers}" "${ROOT}" >&2
	grep -rInE "${MARKER_RE}" "${ROOT}" --exclude-dir=.git 2>/dev/null | head -20 >&2
	exit 1
fi

if [[ "${BASELINE}" != "-" && ${#COUNT_CMD[@]} -gt 0 ]]; then
	current="$("${COUNT_CMD[@]}")"
	current="${current//[$'\n\t ']/}"
	if [[ ! "${current}" =~ ^[0-9]+$ ]]; then
		printf "verify_clean: count command must print a bare integer, got '%s'\n" "${current}" >&2
		exit 1
	fi
	if [[ "${current}" -lt "${BASELINE}" ]]; then
		printf 'verify_clean: pass-count regressed: %s < baseline %s\n' "${current}" "${BASELINE}" >&2
		exit 1
	fi
	printf 'verify_clean: 0 markers, pass-count %s >= %s\n' "${current}" "${BASELINE}"
	exit 0
fi

printf 'verify_clean: 0 markers\n'
exit 0
