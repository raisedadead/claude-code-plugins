#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOSSIER_README="$SCRIPT_DIR/../README.md"
WHET_README="$SCRIPT_DIR/../../whetstone/README.md"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

grep -q '| `whetstone` plugin' "$DOSSIER_README" || fail "dossier README host-env table missing whetstone row"
grep -q 'whetstone:whetstone-doubter' "$DOSSIER_README" || fail "dossier README Subagent section must name the doubter"
grep -qi 'design-class' "$DOSSIER_README" || fail "dossier README must state when the doubt gate auto-fires"
grep -qi 'design-class' "$WHET_README" || fail "whetstone README must state dossier auto-composes it"
grep -q '§whetstone' "$WHET_README" || fail "whetstone README must point at dossier ADAPTERS §whetstone"

grep -q 'test_whetstone_surfaces.sh' "$SCRIPT_DIR/../../../.github/workflows/ci.yml" || fail "ci must run this test"

printf 'ok\n'
