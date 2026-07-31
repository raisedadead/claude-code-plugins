#!/usr/bin/env bash
set -euo pipefail

SCRATCHPAD="${1:-.scratchpad}"
INDEX="${SCRATCHPAD}/INDEX.md"
HERE="$(cd "$(dirname "$0")" && pwd)"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	printf 'drift gate needs a git work tree; %s cannot be diffed outside one.\n' "${INDEX}" >&2
	exit 2
fi

if git check-ignore -q "${INDEX}" 2>/dev/null; then
	printf 'drift gate is inert: %s is gitignored, so git diff --exit-code always passes — on a stale, corrupt or absent index alike. Track the index, or drop this step rather than trusting it.\n' "${INDEX}" >&2
	exit 2
fi

"${HERE}/lib-ds-check.sh" "${SCRATCHPAD}"
git diff --exit-code "${INDEX}"
