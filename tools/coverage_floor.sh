#!/usr/bin/env bash
set -euo pipefail

if (($# != 3)); then
	printf 'usage: tools/coverage_floor.sh <name> <funcs floor> <lines floor> < bun-coverage-text\n' >&2
	exit 64
fi

awk -v name="$1" -v funcs="$2" -v lines="$3" -F'|' '
	$1 ~ /^All files *$/ { f = $2 + 0; l = $3 + 0; found = 1 }
	END {
		if (!found) { printf "COVERAGE: %s FAIL no All files row in the bun coverage output\n", name; exit 1 }
		if (f < funcs || l < lines) {
			printf "COVERAGE: %s FAIL funcs %.2f lines %.2f, floor %s %s\n", name, f, l, funcs, lines
			exit 1
		}
		printf "COVERAGE: %s funcs %.2f lines %.2f, floor %s %s\n", name, f, l, funcs, lines
	}
'
