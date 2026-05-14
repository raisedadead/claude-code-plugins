#!/usr/bin/env bash
# Regenerate .scratchpad/INDEX.md from DOSSIER.md walk.
# Derived state — safe to blow away + rebuild.
# Atomic write: tmp + rename.
# Usage: lib-regen-index.sh <scratchpad-dir>

set -euo pipefail

SCRATCHPAD="${1:-.scratchpad}"
DOSSIER_DIR="${SCRATCHPAD}/dossier"
INDEX_FILE="${SCRATCHPAD}/INDEX.md"
TMP_FILE="${INDEX_FILE}.tmp"

[[ -d "${DOSSIER_DIR}" ]] || exit 0

parse_dossier() {
	local file="$1"
	local state_label="$2" # "live" or "done"

	# Extract date + slug from parent dir name: YYYY-MM-DD-<slug>
	local dir
	dir=$(basename "$(dirname "${file}")")
	local date="${dir:0:10}"
	local slug="${dir:11}"

	# Parse §T: count rows, count x-state rows.
	local t_total t_done
	t_total=$(awk '
    /^## §T/ { in_t=1; next }
    /^## §[^T]/ { in_t=0 }
    in_t && /^\| T[0-9]+ \|/ { n++ }
    END { print n+0 }
  ' "${file}")
	t_done=$(awk '
    /^## §T/ { in_t=1; next }
    /^## §[^T]/ { in_t=0 }
    in_t && /^\| T[0-9]+ \|/ {
      n_fields = split($0, f, "|")
      gsub(/^[ \t]+|[ \t]+$/, "", f[4])
      if (f[4] == "x") n++
    }
    END { print n+0 }
  ' "${file}")

	# Parse §B: count rows.
	local b_total
	b_total=$(awk '
    /^## §B/ { in_b=1; next }
    /^## §[^B]/ { in_b=0 }
    in_b && /^\| B[0-9]+ \|/ { n++ }
    END { print n+0 }
  ' "${file}")

	# Phase count: max P<N> seen in §T column.
	local p_max p_current
	p_max=$(awk '
    /^## §T/ { in_t=1; next }
    /^## §[^T]/ { in_t=0 }
    in_t && match($0, /\| P([0-9]+) \|/, m) { if (m[1]+0 > max) max = m[1]+0 }
    END { print (max ? max : 1) }
  ' "${file}")
	# Current phase = max P with at least one non-x row, or p_max if all done.
	p_current=$(awk -v pmax="${p_max}" '
    /^## §T/ { in_t=1; next }
    /^## §[^T]/ { in_t=0 }
    in_t && /^\| T[0-9]+ \|/ {
      n_fields = split($0, f, "|")
      gsub(/^[ \t]+|[ \t]+$/, "", f[3])
      gsub(/^[ \t]+|[ \t]+$/, "", f[4])
      if (f[4] != "x" && f[3] ~ /^P[0-9]+$/) {
        p = substr(f[3], 2) + 0
        if (cur == 0 || p < cur) cur = p
      }
    }
    END { print (cur ? cur : pmax) }
  ' "${file}")

	# mtime
	local mtime
	mtime=$(date -r "${file}" "+%Y-%m-%d %H:%M" 2>/dev/null || stat -f "%Sm" -t "%Y-%m-%d %H:%M" "${file}" 2>/dev/null || echo "—")

	# §Z column: extract successor / complete.
	local z_state
	if grep -q "^complete: true" "${file}" 2>/dev/null; then
		z_state="complete"
	elif grep -q "^successor:" "${file}" 2>/dev/null; then
		local succ
		succ=$(grep "^successor:" "${file}" | head -1 | sed 's/^successor:[[:space:]]*//')
		z_state="→${succ}"
	else
		z_state="—"
	fi

	printf '| %s | %s | %s | P%s/%s | %s/%s | %s | %s | %s |\n' \
		"${date}" "${slug}" "${state_label}" "${p_current}" "${p_max}" "${t_done}" "${t_total}" "${b_total}" "${mtime}" "${z_state}"
}

{
	echo "# .scratchpad index"
	echo ""
	echo "| date | slug | state | P | T | B | mtime | §Z |"
	echo "|------|------|-------|---|---|---|-------|-----|"

	# Live dossiers (direct children of dossier/, excluding _archive).
	rows=()
	for d in "${DOSSIER_DIR}"/*/; do
		[[ -d "${d}" ]] || continue
		base=$(basename "${d}")
		[[ "${base}" == "_archive" ]] && continue
		[[ -f "${d}DOSSIER.md" ]] || continue
		rows+=("$(parse_dossier "${d}DOSSIER.md" "live")")
	done

	# Archived dossiers.
	if [[ -d "${DOSSIER_DIR}/_archive" ]]; then
		for d in "${DOSSIER_DIR}/_archive"/*/; do
			[[ -d "${d}" ]] || continue
			[[ -f "${d}DOSSIER.md" ]] || continue
			rows+=("$(parse_dossier "${d}DOSSIER.md" "done")")
		done
	fi

	# Sort rows: by date desc (col 2 = "| <date> | …"), live before done within same date.
	printf '%s\n' "${rows[@]}" | sort -t'|' -k2,2r -k4,4
} >"${TMP_FILE}"

mv "${TMP_FILE}" "${INDEX_FILE}"
