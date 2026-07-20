#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TDD="$SCRIPT_DIR/../../whetstone/skills/tdd-cycle/SKILL.md"
BUILD="$SCRIPT_DIR/../skills/build/SKILL.md"
ADAPTERS="$SCRIPT_DIR/../ADAPTERS.md"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

grep -q 'no dossier or spec-driven task is already driving' "$TDD" && fail "tdd-cycle description must not self-exclude"
head -4 "$TDD" | grep -qi 'use when' || fail "tdd-cycle description must keep the trigger clause"
head -4 "$TDD" | grep -q 'dossier:build' || fail "tdd-cycle description must route mid-build invocations to ds:build"
grep -q 'run_slice.sh' "$BUILD" || fail "build SKILL must route RED/GREEN through run_slice when resolvable"
grep -q 'DOSSIER_RUN_SLICE' "$BUILD" || fail "build SKILL must document the explicit script-path override"
grep -q 'DOSSIER_RUN_SLICE' "$ADAPTERS" || fail "ADAPTERS must document the script resolution rule"
grep -qi 'never.*glob\|no glob\|glob.*rejected' "$ADAPTERS" || fail "ADAPTERS must record that glob auto-discovery was rejected"
grep -qi 'two ledgers' "$TDD" || fail "tdd-cycle must keep the never-two-ledgers property"

grep -q 'test_tdd_compose.sh' "$SCRIPT_DIR/../../../.github/workflows/ci.yml" || fail "ci must run this test"

printf 'ok\n'
