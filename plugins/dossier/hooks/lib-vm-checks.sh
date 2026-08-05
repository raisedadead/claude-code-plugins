#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.scratchpad}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib-sections.sh disable=SC1091
source "${HERE}/lib-sections.sh"
DTREE="${ROOT%/}/dossier"

[[ -d "${DTREE}" ]] || exit 0

findings=""

per_file() {
	local f="$1"
	awk -v f="$f" -v any="$DS_SEC_ANY" -v sec_s="$DS_SEC_STATUS" -v sec_t="$DS_SEC_TASKS" '
		function trim(s){ gsub(/^[ \t]+|[ \t]+$/,"",s); return s }
		$0 ~ any {
			if ($0 ~ sec_s) sec="S"
			else if ($0 ~ sec_t) { sec="T"; hdr=0; col_state=0; col_cite=0 }
			else sec="other"
			next
		}
		sec=="S" {
			t=trim($0)
			if (t=="" || t ~ /^<!--/) next
			if (t !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]/)
				printf "WARN Vm.2 %s: Status line missing ISO timestamp: %s\n", f, t
			if (match(t, /ds:[a-z]+ [^ ]+ START/)) {
				k=substr(t,RSTART,RLENGTH); sub(/ START$/,"",k); open_ops[k]=1
				split(k, kf, " "); if (kf[2] == "pending") pending_of[kf[1]]=k
			}
			if (match(t, /ds:[a-z]+ [^ ]+ DONE/)) {
				k=substr(t,RSTART,RLENGTH); sub(/ DONE$/,"",k); delete open_ops[k]
				split(k, kf, " "); if (kf[1] in pending_of) { delete open_ops[pending_of[kf[1]]]; delete pending_of[kf[1]] }
			}
		}
		sec=="T" {
			if ($0 !~ /^\|/) next
			if ($0 ~ /^[-| :+]*$/) next
			n=split($0, a, "|")
			if (!hdr) {
				hdr=1
				for (i=2; i<n; i++) {
					if (trim(a[i])=="state") col_state=i
					if (trim(a[i])=="cite")  col_cite=i
				}
				if (!col_state || !col_cite)
					printf "WARN Vm.3 %s: Tasks header names no %s column, so its rows go unchecked\n", f, (!col_state && !col_cite ? "state or cite" : (col_state ? "cite" : "state"))
				next
			}
			if (!col_state || !col_cite) next
			id=trim(a[2]); state=trim(a[col_state]); cite=trim(a[col_cite])
			if (id=="id" || id=="") next
			if (state=="x" && (cite=="" || cite=="—" || cite=="-"))
				printf "CRITICAL Vm.3 %s: Tasks row %s state=x has empty cite\n", f, id
		}
		END { for (k in open_ops) printf "WARN Vm.6 %s: Status %s START without DONE\n", f, k }
	' "$f"
}

while IFS= read -r file; do
	[[ -n "${file}" ]] || continue
	out="$(per_file "${file}")"
	[[ -n "${out}" ]] && findings+="${out}"$'\n'
done < <(find "${DTREE}" -name DOSSIER.md -type f 2>/dev/null)

while IFS= read -r orphan; do
	[[ -n "${orphan}" ]] && findings+="WARN Vm.8 orphan temp file: ${orphan}"$'\n'
done < <(find "${DTREE}" \( -name '*.tmp' -o -name 'DOSSIER.md.*' -o -name 'INDEX.md.*' \) -type f 2>/dev/null)

while IFS= read -r lockline; do
	[[ -n "${lockline}" ]] && findings+="WARN Vm.9 ${lockline}"$'\n'
done < <("${HERE}/lib-clear-stale-locks.sh" "${DTREE}" --dry-run 2>/dev/null || true)

if [[ -n "${findings//$'\n'/}" ]]; then
	printf '%s' "${findings}"
	exit 1
fi

exit 0
