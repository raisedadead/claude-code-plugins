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

	if [[ "${state_label}" == "live" ]]; then
		local hdr_state
		hdr_state=$(awk '/^`.*` · `.*` · / { n=split($0,p,"`"); gsub(/^[ \t]+|[ \t]+$/,"",p[4]); print p[4]; exit }' "${file}")
		[[ "${hdr_state}" == "paused" ]] && state_label="paused"
	fi

	# Parse §T: count rows, count x-state rows.
	# Tolerate prettier-padded tables: `| T1  |` (multi-space) and `| T10 |`.
	local t_total t_done
	t_total=$(awk '
    /^## §T/ { in_t=1; next }
    /^## §[^T]/ { in_t=0 }
    in_t && /^\|[[:space:]]*T[0-9]+[[:space:]]*\|/ { n++ }
    END { print n+0 }
  ' "${file}")
	t_done=$(awk '
    /^## §T/ { in_t=1; next }
    /^## §[^T]/ { in_t=0 }
    in_t && /^\|[[:space:]]*T[0-9]+[[:space:]]*\|/ {
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
    in_b && /^\|[[:space:]]*B[0-9]+[[:space:]]*\|/ { n++ }
    END { print n+0 }
  ' "${file}")

	# Phase count: max P<N> seen in §T column. Tolerate padded cells.
	# Use split (BSD-awk-compatible) instead of match-with-array (gawk-only).
	local p_max p_current
	p_max=$(awk '
    /^## §T/ { in_t=1; next }
    /^## §[^T]/ { in_t=0 }
    in_t && /^\|[[:space:]]*T[0-9]+[[:space:]]*\|/ {
      n_fields = split($0, f, "|")
      gsub(/^[ \t]+|[ \t]+$/, "", f[3])
      if (f[3] ~ /^P[0-9]+$/) {
        p = substr(f[3], 2) + 0
        if (p > max) max = p
      }
    }
    END { print (max ? max : 1) }
  ' "${file}")
	# Current phase = lowest P with at least one non-x row, or p_max if all done.
	p_current=$(awk -v pmax="${p_max}" '
    /^## §T/ { in_t=1; next }
    /^## §[^T]/ { in_t=0 }
    in_t && /^\|[[:space:]]*T[0-9]+[[:space:]]*\|/ {
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

	# §Z column: extract successor / complete. Scan only the §Z section.
	# Tolerate prose-joined formatter output (prettier merges multi-line
	# paragraphs into one) — match substring, not just line-anchored.
	local z_section z_state
	z_section=$(awk '/^## §Z/,EOF { print }' "${file}" 2>/dev/null || true)
	if echo "${z_section}" | grep -qE '(^|[[:space:]])complete:[[:space:]]+true([[:space:]]|$)'; then
		z_state="complete"
	elif echo "${z_section}" | grep -qE '(^|[[:space:]])successor:[[:space:]]+[^[:space:]]'; then
		local succ
		succ=$(echo "${z_section}" | grep -oE 'successor:[[:space:]]+[^[:space:]]+' | head -1 | sed 's/successor:[[:space:]]*//')
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

	# Sort rows: date desc (col 2), then state_label reverse-alpha (col 4) so "live" > "done".
	# Col layout after leading "|": f[2]=date, f[3]=slug, f[4]=state_label.
	printf '%s\n' "${rows[@]}" | sort -t'|' -k2,2r -k4,4r
} >"${TMP_FILE}"

mv "${TMP_FILE}" "${INDEX_FILE}"
