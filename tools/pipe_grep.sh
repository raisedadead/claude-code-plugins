#!/usr/bin/env bash
set -euo pipefail

found=0
while IFS= read -r -d '' path; do
	[[ -f $path ]] || continue
	case "$path" in
	*.sh) ;;
	*) [[ $(head -1 "$path") =~ ^#!.*[/[:space:]](ba)?sh([[:space:]]|$) ]] || continue ;;
	esac
	grep -q pipefail "$path" || continue
	while IFS=: read -r line _; do
		printf 'PIPE-GREP: %s:%s: a pipe into grep -q under pipefail can fail with SIGPIPE (141); use grep -q <pattern> <<<"<text>"\n' "$path" "$line"
		found=1
	done < <(grep -nE '\|[[:space:]]*grep[[:space:]]+-[a-zA-Z]*q' "$path" || true)
done < <(git ls-files -z)
exit "$found"
