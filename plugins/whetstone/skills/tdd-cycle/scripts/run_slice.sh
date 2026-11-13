#!/usr/bin/env bash
set -euo pipefail

USAGE='usage: run_slice.sh <red [--expect <ERE>]|green|full> <cmd...>'
PHASE="${1:?${USAGE}}"
shift

EXPECT=''
if [[ "${1:-}" == '--expect' ]]; then
	if [[ "${PHASE}" != red || -z "${2:-}" ]]; then
		printf 'run_slice: --expect takes a pattern and works only with red\n%s\n' "${USAGE}" >&2
		exit 2
	fi
	EXPECT="$2"
	shift 2
fi

[[ $# -ge 1 ]] || {
	printf 'run_slice: no command given\n' >&2
	exit 2
}

rc=0
if [[ -n "${EXPECT}" ]]; then
	OUTPUT="$(mktemp)"
	trap 'rm -f "${OUTPUT}"' EXIT
	"$@" >"${OUTPUT}" 2>&1 || rc=$?
	cat "${OUTPUT}"
else
	"$@" || rc=$?
fi

if [[ "${rc}" -eq 126 || "${rc}" -eq 127 ]]; then
	printf 'run_slice: the command did not run (exit %s) — check the argv, one word per argument.\n' "${rc}" >&2
	exit 1
fi

case "${PHASE}" in
red)
	if [[ "${rc}" -eq 0 ]]; then
		printf 'run_slice red: the test PASSED — a RED must fail first, so it is not characterizing anything. Write a test that fails.\n' >&2
		exit 1
	fi
	if [[ -n "${EXPECT}" ]] && ! grep -Eq -- "${EXPECT}" "${OUTPUT}"; then
		printf 'run_slice red: the test failed (exit %s), but its output does not match --expect %s — it failed for another reason.\n' "${rc}" "${EXPECT}" >&2
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
