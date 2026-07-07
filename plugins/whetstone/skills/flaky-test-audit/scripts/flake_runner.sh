#!/usr/bin/env bash
set -euo pipefail

N="${1:?usage: flake_runner.sh <N> <results.json> <cmd...>}"
OUT="${2:?results.json path required}"
shift 2

[[ $# -ge 1 ]] || {
	printf 'flake_runner: no command given\n' >&2
	exit 2
}

NAME="${FLAKE_TEST_NAME:-suite}"
fails=0
for ((i = 1; i <= N; i++)); do
	if "$@" >/dev/null 2>&1; then
		:
	else
		fails=$((fails + 1))
	fi
done

printf '{"%s": {"runs": %d, "fails": %d}}\n' "$NAME" "$N" "$fails" >"$OUT"
