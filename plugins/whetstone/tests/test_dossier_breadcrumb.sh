#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS="$SCRIPT_DIR/../skills"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

for s in doubt-pass flaky-test-audit merge-resolve skill-smith tdd-cycle; do
	f="$SKILLS/$s/SKILL.md"
	grep -qi 'dossier breadcrumb' "$f" || fail "$s must carry the dossier breadcrumb clause"
	grep -qi 'one §S line' "$f" || fail "$s breadcrumb must be one §S line"
	grep -qiE 'no dossier.*(skip|no-op)|skip.*no dossier' "$f" || fail "$s breadcrumb must no-op without a dossier"
	head -4 "$f" | grep -qi 'breadcrumb' && fail "$s breadcrumb must not touch the description"
done

python3 "$SKILLS/skill-smith/scripts/lint_skill.py" "$SKILLS" >/dev/null || fail "all whetstone skills must stay lint-clean"

printf 'ok\n'
