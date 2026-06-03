#!/usr/bin/env bash
set -euo pipefail

SCRATCHPAD=".scratchpad"
DOSSIER_DIR="${SCRATCHPAD}/dossier"
INDEX_FILE="${SCRATCHPAD}/INDEX.md"

[[ -d "${DOSSIER_DIR}" ]] || {
	echo '{"continue": true}'
	exit 0
}

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

"${PLUGIN_ROOT}/hooks/lib-regen-index.sh" "${SCRATCHPAD}" 2>/dev/null || true
"${PLUGIN_ROOT}/hooks/lib-clear-stale-locks.sh" "${DOSSIER_DIR}" 2>/dev/null || true

ctx_lines=()

if [[ -f "${INDEX_FILE}" ]]; then
	ctx_lines+=("## .scratchpad/INDEX.md (head)")
	while IFS= read -r line; do
		ctx_lines+=("${line}")
	done < <(head -6 "${INDEX_FILE}")
fi

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

live_count=0
live_all=""
if [[ -f "${INDEX_FILE}" ]]; then
	live_count=$(awk -F'|' 'NR>2 && $4 ~ /live/ {n++} END{print n+0}' "${INDEX_FILE}" 2>/dev/null || echo 0)
	live_all=$(awk -F'|' 'NR>2 && $4 ~ /live/ {gsub(/^[ \t]+|[ \t]+$/,"",$2); gsub(/^[ \t]+|[ \t]+$/,"",$3); printf "%s-%s ", $2, $3}' "${INDEX_FILE}" 2>/dev/null || true)
fi

sys_msg=""
if [[ "${live_count}" -gt 1 ]]; then
	sys_msg="⚠ dossier: ${live_count} live (${live_all}) — run /dossier:status to consolidate (pause or close the stale ones)."
	ctx_lines+=("")
	ctx_lines+=("⚠ ${live_count} live dossiers: ${live_all}— pick one, pause/close the rest (ds:status)")
fi

if [[ -n "${live_slug}" && -d "${DOSSIER_DIR}/${live_slug}" ]]; then
	doss="${DOSSIER_DIR}/${live_slug}/DOSSIER.md"
	if [[ -f "${doss}" ]]; then
		incomplete=$(awk '
      / START$/ { op_start[$3] = $0 }
      / DONE/   { delete op_start[$3] }
      END { for (t in op_start) print "⚠ resume needed: " op_start[t] }
    ' "${doss}" 2>/dev/null || true)

		ctx_lines+=("")
		ctx_lines+=("## dossier live: ${live_slug}")

		while IFS= read -r line; do
			ctx_lines+=("${line}")
		done < <(awk -F'|' '
      /^\| *T[0-9]+ *\|/ {
        st=$4; task=$5; ph=$3
        gsub(/^[ \t]+|[ \t]+$/,"",st); gsub(/^[ \t]+|[ \t]+$/,"",task); gsub(/^[ \t]+|[ \t]+$/,"",ph)
        total++
        if(st=="x") done++
        else if(st=="~") prog++
        else if(st=="!"){ blk++; blocker[blk]=ph" "task }
        else if(st=="?"){ q++; research[q]=ph" "task }
      }
      END {
        if(!total) exit
        ln=sprintf("§T: %d/%d done", done+0, total)
        if(prog) ln=ln sprintf(", %d in-progress", prog)
        if(blk)  ln=ln sprintf(", %d blocked", blk)
        if(q)    ln=ln sprintf(", %d need-research", q)
        print ln
        for(i=1;i<=blk;i++) print "  ‼ blocked: " blocker[i]
        for(i=1;i<=q;i++)   print "  ? research: " research[i]
      }
    ' "${doss}")

		while IFS= read -r line; do
			ctx_lines+=("${line}")
		done < <(awk -F'|' '
      /^## §X/{x=1; next} /^## §[^X]/{x=0}
      x && /^\|/ {
        if ($0 ~ /^\|[ :|-]+$/) next
        if (!hdr) { hdr=1; next }
        n++; p=$6; gsub(/^[ \t]+|[ \t]+$/,"",p); if(p=="no") unp++
      }
      END { if(n) printf "§X: %d repos, %d unpushed\n", n, unp+0 }
    ' "${doss}")

		while IFS= read -r line; do
			ctx_lines+=("just did: ${line}")
		done < <(awk '/^## §S/,/^## §[^S]/' "${doss}" | grep -v '^## §' | grep -v '^[[:space:]]*$' | tail -2)

		if [[ -n "${incomplete}" ]]; then
			ctx_lines+=("")
			ctx_lines+=("${incomplete}")
			ctx_lines+=("### §T (full — resume context)")
			while IFS= read -r line; do
				ctx_lines+=("${line}")
			done < <(awk '/^## §T/,/^## §[^T]/' "${doss}" | grep -v '^## §' | grep -v '^[[:space:]]*$')
			ctx_lines+=("### §X (full)")
			while IFS= read -r line; do
				ctx_lines+=("${line}")
			done < <(awk '/^## §X/,/^## §[^X]/' "${doss}" | grep -v '^## §' | grep -v '^[[:space:]]*$')
		fi

		ctx_lines+=("(ds:status for full dashboard)")
	fi
fi

ctx_str=$(printf '%s\n' "${ctx_lines[@]}")

if command -v jq &>/dev/null; then
	jq -n --arg ctx "${ctx_str}" --arg sys "${sys_msg}" '
    {continue: true, hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}
    + (if $sys != "" then {systemMessage: $sys} else {} end)
  '
else
	esc=$(printf '%s' "${ctx_str}" | python3 -c 'import sys, json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '%s' "${ctx_str}" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk 'BEGIN{ORS="\\n"}{print}')
	if [[ -n "${sys_msg}" ]]; then
		sys_esc=$(printf '%s' "${sys_msg}" | python3 -c 'import sys, json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "${sys_msg}")
		printf '{"continue": true, "systemMessage": %s, "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": %s}}\n' "${sys_esc}" "${esc}"
	else
		printf '{"continue": true, "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": %s}}\n' "${esc}"
	fi
fi
