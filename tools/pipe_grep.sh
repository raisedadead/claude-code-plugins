#!/usr/bin/env bash
set -euo pipefail

PIPE_INTO_QUIET_GREP='(^|[^|])\|&?[[:space:]]*(command[[:space:]]+|[A-Za-z_]+=[^[:space:]]+[[:space:]]+)*grep([[:space:]]+-[^[:space:]]+)*[[:space:]]+(-[a-zA-Z]*q[a-zA-Z]*|--quiet|--silent)([[:space:]]|$)'
found=0
while IFS= read -r -d '' path; do
	[[ -f $path && ! -L $path ]] || continue
	case "$path" in
	*.sh | *.bash) ;;
	*) [[ $(head -1 "$path") =~ ^#!.*[/[:space:]](ba)?sh([[:space:]]|$) ]] || continue ;;
	esac
	while IFS=: read -r line text; do
		[[ $text =~ ^[[:space:]]*# ]] && continue
		printf 'PIPE-GREP: %s:%s: a pipe into a quiet grep can fail with SIGPIPE (141) under pipefail; use grep -q <pattern> <<<"<text>"\n' "$path" "$line"
		found=1
	done < <(grep -nE "$PIPE_INTO_QUIET_GREP" "$path" || true)
done < <(git ls-files -z)
exit "$found"
