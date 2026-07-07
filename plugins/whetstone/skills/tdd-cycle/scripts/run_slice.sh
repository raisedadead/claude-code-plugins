#!/usr/bin/env bash
set -euo pipefail

PHASE="${1:?usage: run_slice.sh <red|green|full> <cmd...>}"
shift

[[ $# -ge 1 ]] || {
	printf 'run_slice: no command given\n' >&2
	exit 2
}

rc=0
"$@" || rc=$?

case "${PHASE}" in
red)
	if [[ "${rc}" -eq 0 ]]; then
		printf 'run_slice red: the test PASSED — a RED must fail first, so it is not characterizing anything. Write a test that fails.\n' >&2
		exit 1
	fi
	printf 'run_slice red: confirmed failing (exit %s)\n' "${rc}"
	;;
green)
	if [[ "${rc}" -ne 0 ]]; then
		printf 'run_slice green: the test is still failing (exit %s) — not GREEN yet.\n' "${rc}" >&2
		exit 1
	fi
	printf 'run_slice green: passing\n'
	;;
full)
	if [[ "${rc}" -ne 0 ]]; then
		printf 'run_slice full: the suite is failing (exit %s) — this slice regressed something.\n' "${rc}" >&2
		exit 1
	fi
	printf 'run_slice full: suite green\n'
	;;
*)
	printf 'run_slice: unknown phase %s (expected red|green|full)\n' "${PHASE}" >&2
	exit 2
	;;
esac
