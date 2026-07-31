#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.scratchpad}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DTREE="${ROOT%/}/dossier"

[[ -d "${DTREE}" ]] || exit 0

findings=""

per_file() {
	local f="$1"
	awk -v f="$f" '
		function trim(s){ gsub(/^[ \t]+|[ \t]+$/,"",s); return s }
		/^## §/ {
			if ($0 ~ /^## §S/) sec="S"
			else if ($0 ~ /^## §T/) sec="T"
			else sec="other"
			next
		}
		sec=="S" {
			t=trim($0)
			if (t=="" || t ~ /^<!--/) next
			if (t !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]/)
				printf "WARN Vm.2 %s: §S line missing ISO timestamp: %s\n", f, t
			if (match(t, /ds:[a-z]+ [A-Za-z0-9_-]+ START/)) {
				k=substr(t,RSTART,RLENGTH); sub(/ START$/,"",k); open_ops[k]=1
				split(k, kf, " "); if (kf[2] == "pending") pending_of[kf[1]]=k
			}
			if (match(t, /ds:[a-z]+ [A-Za-z0-9_-]+ DONE/)) {
				k=substr(t,RSTART,RLENGTH); sub(/ DONE$/,"",k); delete open_ops[k]
				split(k, kf, " "); if (kf[1] in pending_of) { delete open_ops[pending_of[kf[1]]]; delete pending_of[kf[1]] }
			}
		}
		sec=="T" {
			if ($0 !~ /^\|/) next
			if ($0 ~ /^[-| :+]*$/) next
			split($0, a, "|")
			id=trim(a[2]); state=trim(a[4]); cite=trim(a[6])
			if (id=="id" || id=="") next
			if (state=="x" && (cite=="" || cite=="—" || cite=="-"))
				printf "CRITICAL Vm.3 %s: §T row %s state=x has empty cite\n", f, id
		}
		END { for (k in open_ops) printf "WARN Vm.6 %s: §S %s START without DONE\n", f, k }
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
