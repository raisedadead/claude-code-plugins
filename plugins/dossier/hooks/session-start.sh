#!/usr/bin/env bash
# Dossier SessionStart hook.
# Emits compact additionalContext: INDEX head + live DOSSIER §S/§T/§X + incomplete-op flag.
# Idempotent: regenerates INDEX, clears stale locks, never blocks.
# Output: JSON to stdout per Claude Code hook spec.

set -euo pipefail

SCRATCHPAD=".scratchpad"
DOSSIER_DIR="${SCRATCHPAD}/dossier"
INDEX_FILE="${SCRATCHPAD}/INDEX.md"

# Exit silently if no dossier tree in cwd. Plugin is opt-in per project.
[[ -d "${DOSSIER_DIR}" ]] || {
	echo '{"continue": true}'
	exit 0
}

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

# Regenerate INDEX (derived from DOSSIER.md walk).
"${PLUGIN_ROOT}/hooks/lib-regen-index.sh" "${SCRATCHPAD}" 2>/dev/null || true

# Clear stale locks (pid dead OR started >30min ago).
"${PLUGIN_ROOT}/hooks/lib-clear-stale-locks.sh" "${DOSSIER_DIR}" 2>/dev/null || true

# Build context string.
ctx_lines=()

if [[ -f "${INDEX_FILE}" ]]; then
	ctx_lines+=("## .scratchpad/INDEX.md (head)")
	while IFS= read -r line; do
		ctx_lines+=("${line}")
	done < <(head -20 "${INDEX_FILE}")
fi

# Find newest live dossier from INDEX (first row with state=live).
live_slug=""
if [[ -f "${INDEX_FILE}" ]]; then
	live_slug=$(awk -F'|' '
    NR > 2 && $4 ~ /live/ {
      gsub(/^[ \t]+|[ \t]+$/, "", $2)
      gsub(/^[ \t]+|[ \t]+$/, "", $3)
      print $2 "-" $3
      exit
    }
  ' "${INDEX_FILE}" 2>/dev/null || true)
fi

if [[ -n "${live_slug}" && -d "${DOSSIER_DIR}/${live_slug}" ]]; then
	doss="${DOSSIER_DIR}/${live_slug}/DOSSIER.md"
	if [[ -f "${doss}" ]]; then
		ctx_lines+=("")
		ctx_lines+=("## Live: ${DOSSIER_DIR}/${live_slug}")

		# §S tail (last 30)
		ctx_lines+=("")
		ctx_lines+=("### §S tail")
		while IFS= read -r line; do
			ctx_lines+=("${line}")
		done < <(awk '/^## §S/,/^## §[^S]/' "${doss}" | grep -v '^## §' | tail -30)

		# §T full
		ctx_lines+=("")
		ctx_lines+=("### §T")
		while IFS= read -r line; do
			ctx_lines+=("${line}")
		done < <(awk '/^## §T/,/^## §[^T]/' "${doss}" | grep -v '^## §')

		# §X full
		ctx_lines+=("")
		ctx_lines+=("### §X")
		while IFS= read -r line; do
			ctx_lines+=("${line}")
		done < <(awk '/^## §X/,/^## §[^X]/' "${doss}" | grep -v '^## §')

		# Incomplete op detection: last §S START without matching DONE for same target.
		incomplete=$(awk '
      / START$/ {
        target = $3
        op_start[target] = $0
      }
      / DONE/ {
        target = $3
        delete op_start[target]
      }
      END {
        for (t in op_start) print "⚠ Incomplete: " op_start[t]
      }
    ' "${doss}" 2>/dev/null || true)

		if [[ -n "${incomplete}" ]]; then
			ctx_lines+=("")
			ctx_lines+=("${incomplete}")
		fi
	fi
fi

# Emit spec-compliant JSON via jq if available, else minimal manual escape.
ctx_str=$(printf '%s\n' "${ctx_lines[@]}")

if command -v jq &>/dev/null; then
	jq -n --arg ctx "${ctx_str}" '{
    continue: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: $ctx
    }
  }'
else
	# Fallback: manual JSON escape (newline + backslash + quote only).
	esc=$(printf '%s' "${ctx_str}" | python3 -c 'import sys, json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '%s' "${ctx_str}" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk 'BEGIN{ORS="\\n"}{print}')
	printf '{"continue": true, "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": %s}}\n' "${esc}"
fi
