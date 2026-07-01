#!/usr/bin/env bash
# Clear stale .ds-lock files (pid dead OR started >30min ago).
# Usage: lib-clear-stale-locks.sh <dossier-dir>

set -euo pipefail

DOSSIER_DIR="${1:-.scratchpad/dossier}"

[[ -d "${DOSSIER_DIR}" ]] || exit 0

NOW=$(date +%s)
STALE_THRESHOLD=1800 # 30min

find "${DOSSIER_DIR}" -name ".ds-lock" -type f 2>/dev/null | while read -r lock; do
	# Parse JSON: prefer jq, fall back to grep.
	if command -v jq &>/dev/null; then
		pid=$(jq -r '.pid // empty' "${lock}" 2>/dev/null || echo "")
		started=$(jq -r '.started // empty' "${lock}" 2>/dev/null || echo "")
	else
		pid=$(grep -oE '"pid"[[:space:]]*:[[:space:]]*[0-9]+' "${lock}" | grep -oE '[0-9]+$' || echo "")
		started=$(grep -oE '"started"[[:space:]]*:[[:space:]]*"[^"]+"' "${lock}" | sed 's/.*"\([^"]*\)"$/\1/' || echo "")
	fi

	reason=""
	pid_alive=0

	if [[ -n "${pid}" ]]; then
		if kill -0 "${pid}" 2>/dev/null; then
			pid_alive=1
		else
			reason="pid-dead"
		fi
	fi

	if [[ -z "${reason}" && "${pid_alive}" -eq 0 ]]; then
		# ISO 8601 → epoch. macOS date wants `-j -f` form.
		started_epoch=""
		if [[ -n "${started}" ]]; then
			started_epoch=$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%SZ" "${started}" "+%s" 2>/dev/null ||
				date -u -d "${started}" "+%s" 2>/dev/null ||
				echo "")
		fi
		if [[ -z "${started_epoch}" ]]; then
			started_epoch=$(stat -c %Y "${lock}" 2>/dev/null) || started_epoch=$(stat -f %m "${lock}" 2>/dev/null) || started_epoch=""
		fi
		if [[ "${started_epoch}" =~ ^[0-9]+$ ]]; then
			age=$((NOW - started_epoch))
			if [[ "${age}" -gt "${STALE_THRESHOLD}" ]]; then
				reason="stale-${age}s"
			fi
		fi
	fi

	if [[ -n "${reason}" ]]; then
		rm -f "${lock}"
		# Stderr only; hook script swallows to keep JSON stdout clean.
		echo "cleared stale lock: ${lock} (${reason})" >&2
	fi
done
