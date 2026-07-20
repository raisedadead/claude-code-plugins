#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CI="$SCRIPT_DIR/../../../.github/workflows/ci.yml"
BUILD="$SCRIPT_DIR/../skills/build/SKILL.md"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

grep -qE 'lint_skill\.py plugins/dossier/skills$' "$CI" || fail "ci must lint the whole dossier skills dir"
grep -qE 'lint_skill\.py plugins/dossier/skills/grill' "$CI" && fail "per-skill lint list must be replaced by the dir sweep"
grep -q 'lint_skill.py' "$BUILD" || fail "build SKILL must auto-lint any touched SKILL.md"
grep -q 'skill-lint=skipped-absent' "$BUILD" || fail "auto-lint must absent-skip with §S note"
grep -q 'DOSSIER_LINT_SKILL' "$BUILD" || fail "auto-lint must document the explicit path override"
grep -q 'DOSSIER_LINT_SKILL' "$SCRIPT_DIR/../ADAPTERS.md" || fail "ADAPTERS must register the lint route"
python3 "$SCRIPT_DIR/../../whetstone/skills/skill-smith/scripts/lint_skill.py" "$SCRIPT_DIR/../skills" >/dev/null || fail "all dossier skills must be lint-clean"

grep -q 'test_skill_lint_gate.sh' "$CI" || fail "ci must run this test"

printf 'ok\n'
