#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib-sections.sh disable=SC1091
source "${HERE}/lib-sections.sh"

SCRATCHPAD=".scratchpad"
DOSSIER_DIR="${SCRATCHPAD}/dossier"
INDEX_FILE="${SCRATCHPAD}/INDEX.md"

[[ -d "${DOSSIER_DIR}" ]] || {
	echo '{"continue": true}'
	exit 0
}

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

HOOK_INPUT=""
[[ -t 0 ]] || HOOK_INPUT=$(cat 2>/dev/null || true)
hook_src=""
hook_cur_title=""
if [[ -n "${HOOK_INPUT}" ]]; then
	if command -v jq &>/dev/null; then
		hook_src=$(jq -r '.source // ""' <<<"${HOOK_INPUT}" 2>/dev/null || true)
		hook_cur_title=$(jq -r '.session_title // ""' <<<"${HOOK_INPUT}" 2>/dev/null || true)
	elif command -v python3 &>/dev/null; then
		IFS=$'\t' read -r hook_src hook_cur_title < <(printf '%s' "${HOOK_INPUT}" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    d = {}
print(str(d.get("source") or ""), str(d.get("session_title") or ""), sep="\t")
' 2>/dev/null) || true
	fi
fi

"${PLUGIN_ROOT}/hooks/lib-clear-stale-locks.sh" "${DOSSIER_DIR}" 2>/dev/null || true
"${PLUGIN_ROOT}/hooks/lib-reconcile-state.sh" "${SCRATCHPAD}" 2>/dev/null || true
"${PLUGIN_ROOT}/hooks/lib-regen-index.sh" "${SCRATCHPAD}" 2>/dev/null || true

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
    NR > 2 { st = $4; gsub(/^[ \t]+|[ \t]+$/, "", st) }
    NR > 2 && st == "live" {
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
	live_count=$(awk -F'|' 'NR>2 {st=$4; gsub(/^[ \t]+|[ \t]+$/,"",st); if(st=="live")n++} END{print n+0}' "${INDEX_FILE}" 2>/dev/null || echo 0)
	live_all=$(awk -F'|' 'NR>2 {st=$4; gsub(/^[ \t]+|[ \t]+$/,"",st); if(st=="live"){gsub(/^[ \t]+|[ \t]+$/,"",$2); gsub(/^[ \t]+|[ \t]+$/,"",$3); printf "%s-%s ", $2, $3}}' "${INDEX_FILE}" 2>/dev/null || true)
fi

drift_count=0
drift_slugs=""
if [[ -f "${INDEX_FILE}" ]]; then
	drift_line=$(grep -oE '<!-- drift:[0-9]+ slugs:[^>]*-->' "${INDEX_FILE}" 2>/dev/null | head -1 || true)
	if [[ -n "${drift_line}" ]]; then
		drift_count=$(printf '%s' "${drift_line}" | grep -oE 'drift:[0-9]+' | grep -oE '[0-9]+')
		drift_slugs=$(printf '%s' "${drift_line}" | sed -E 's/.*slugs:(.*) -->/\1/')
	fi
fi

resume_hints=""
if [[ -d "${DOSSIER_DIR}" ]]; then
	for dd in "${DOSSIER_DIR}"/*/; do
		[[ -d "${dd}" ]] || continue
		ddbase=$(basename "${dd}")
		[[ "${ddbase}" == "_archive" ]] && continue
		[[ -f "${dd}DOSSIER.md" ]] || continue
		inc=$(awk -v b="${ddbase}" -v any="$DS_SEC_ANY" -v sec_s="$DS_SEC_STATUS" '
      $0 ~ sec_s { in_s = 1; next }
      $0 ~ any   { in_s = 0 }
      in_s {
        ev = $5
        if (ev == "START") { op[$3 ":" $4] = $0; if ($4 == "pending") pend[$3] = $3 ":" $4 }
        else if (ev == "DONE") {
          delete op[$3 ":" $4]
          if ($3 in pend) { delete op[pend[$3]]; delete pend[$3] }
        }
      }
      END { for (k in op) print "  ⚠ resume needed [" b "]: " op[k] }
    ' "${dd}DOSSIER.md" 2>/dev/null || true)
		[[ -n "${inc}" ]] && resume_hints+="${inc}"$'\n'
	done
fi

session_title_out=""
if [[ "${DOSSIER_SESSION_TITLE:-0}" == "1" ]]; then
	case "${hook_src}" in
	startup | resume | fork)
		if [[ -z "${hook_cur_title}" && -n "${live_slug}" ]]; then
			session_title_out="${live_slug}"
		fi
		;;
	esac
fi

sys_msg=""
if [[ "${live_count}" -gt 1 ]]; then
	sys_msg="⚠ dossier: ${live_count} live (${live_all}) — run /dossier:status to consolidate (pause or close the stale ones)."
	ctx_lines+=("")
	ctx_lines+=("⚠ ${live_count} live dossiers: ${live_all}— pick one, pause/close the rest (ds:status)")
fi
if [[ "${drift_count}" -gt 0 ]]; then
	dmsg="⚠ dossier: ${drift_count} in conflicting state (drift) — ${drift_slugs}. Run /dossier:status to reconcile."
	if [[ -n "${sys_msg}" ]]; then sys_msg="${sys_msg} ${dmsg}"; else sys_msg="${dmsg}"; fi
	ctx_lines+=("")
	ctx_lines+=("⚠ drift (${drift_count}): ${drift_slugs} — header/Closeout/location disagreement, reconcile via ds:status")
fi
if [[ -n "${resume_hints}" ]]; then
	ctx_lines+=("")
	ctx_lines+=("## resume needed")
	while IFS= read -r rline; do
		[[ -n "${rline}" ]] && ctx_lines+=("${rline}")
	done <<<"${resume_hints}"
fi

if [[ -n "${live_slug}" && -d "${DOSSIER_DIR}/${live_slug}" ]]; then
	doss="${DOSSIER_DIR}/${live_slug}/DOSSIER.md"
	if [[ -f "${doss}" ]]; then
		incomplete=""
		if printf '%s' "${resume_hints}" | grep -qF "[${live_slug}]"; then
			incomplete="⚠ current dossier ${live_slug} has an unfinished op — see 'resume needed' above"
		fi

		ctx_lines+=("")
		ctx_lines+=("## dossier live: ${live_slug}")

		while IFS= read -r line; do
			ctx_lines+=("${line}")
		done < <(awk -F'|' -v any="$DS_SEC_ANY" -v sec_t="$DS_SEC_TASKS" '
      function trim(s){ gsub(/^[ \t]+|[ \t]+$/,"",s); return s }
      $0 ~ sec_t { in_t=1; hdr=0; cs=0; ck=0; next }
      $0 ~ any   { in_t=0 }
      in_t && /^\|/ && $0 !~ /^\|[ :|-]+$/ && !hdr {
        hdr=1
        for (i=2; i<=NF; i++) {
          if (trim($i)=="state") cs=i
                    if (trim($i)=="task")  ck=i
        }
        next
      }
      in_t && hdr && cs && ck && /^\| *T[0-9]+ *\|/ {
        st=trim($cs); task=trim($ck)
        total++
        if(st=="x") done++
        else if(st=="~") prog++
        else if(st=="!"){ blk++; blocker[blk]=task }
        else if(st=="?"){ q++; research[q]=task }
      }
      END {
        if(!total) exit
        ln=sprintf("Tasks: %d/%d done", done+0, total)
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
		done < <(awk -F'|' -v any="$DS_SEC_ANY" -v sec_x="$DS_SEC_REPOS" '
      $0 ~ sec_x {x=1; next} $0 ~ any {x=0}
      x && /^\|/ {
        if ($0 ~ /^\|[ :|-]+$/) next
        if (!hdr) { hdr=1; next }
        n++; p=$6; gsub(/^[ \t]+|[ \t]+$/,"",p); if(p=="no") unp++
      }
      END { if(n) printf "Repos: %d repos, %d unpushed\n", n, unp+0 }
    ' "${doss}")

		while IFS= read -r line; do
			ctx_lines+=("just did: ${line}")
		done < <(awk -v any="$DS_SEC_ANY" -v s="$DS_SEC_STATUS" '$0 ~ s { insec=1; next } insec && $0 ~ any { insec=0 } insec' "${doss}" | grep -v '^[[:space:]]*$' | tail -2)

		if [[ -n "${incomplete}" ]]; then
			ctx_lines+=("")
			ctx_lines+=("${incomplete}")
			ctx_lines+=("### Tasks (full — resume context)")
			while IFS= read -r line; do
				ctx_lines+=("${line}")
			done < <(awk -v any="$DS_SEC_ANY" -v s="$DS_SEC_TASKS" '$0 ~ s { insec=1; next } insec && $0 ~ any { insec=0 } insec' "${doss}" | grep -v '^[[:space:]]*$')
			ctx_lines+=("### Repos (full)")
			while IFS= read -r line; do
				ctx_lines+=("${line}")
			done < <(awk -v any="$DS_SEC_ANY" -v s="$DS_SEC_REPOS" '$0 ~ s { insec=1; next } insec && $0 ~ any { insec=0 } insec' "${doss}" | grep -v '^[[:space:]]*$')
		fi

		ctx_lines+=("(ds:status for full dashboard)")
	fi
fi

ctx_str=$(if ((${#ctx_lines[@]})); then printf '%s\n' "${ctx_lines[@]}"; fi)

if command -v jq &>/dev/null; then
	jq -n --arg ctx "${ctx_str}" --arg sys "${sys_msg}" --arg title "${session_title_out}" '
    {continue: true, hookSpecificOutput: ({hookEventName: "SessionStart", additionalContext: $ctx}
      + (if $title != "" then {sessionTitle: $title} else {} end))}
    + (if $sys != "" then {systemMessage: $sys} else {} end)
  '
elif command -v python3 &>/dev/null; then
	esc=$(printf '%s' "${ctx_str}" | python3 -c 'import sys, json; print(json.dumps(sys.stdin.read()))' 2>/dev/null) || esc='""'
	title_frag=""
	if [[ -n "${session_title_out}" ]]; then
		title_esc=$(printf '%s' "${session_title_out}" | python3 -c 'import sys, json; print(json.dumps(sys.stdin.read()))' 2>/dev/null) || title_esc='""'
		title_frag=", \"sessionTitle\": ${title_esc}"
	fi
	if [[ -n "${sys_msg}" ]]; then
		sys_esc=$(printf '%s' "${sys_msg}" | python3 -c 'import sys, json; print(json.dumps(sys.stdin.read()))' 2>/dev/null) || sys_esc='""'
		printf '{"continue": true, "systemMessage": %s, "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": %s%s}}\n' "${sys_esc}" "${esc}" "${title_frag}"
	else
		printf '{"continue": true, "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": %s%s}}\n' "${esc}" "${title_frag}"
	fi
else
	printf '{"continue": true}\n'
fi
