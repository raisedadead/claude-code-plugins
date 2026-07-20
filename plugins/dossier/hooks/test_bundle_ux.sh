#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/../../.."
README="$ROOT/README.md"
MARKET="$ROOT/.claude-plugin/marketplace.json"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

grep -q 'plugins/whetstone' "$README" || fail "root README must list whetstone"
grep -q 'install dossier@raisedadead-plugins' "$README" || fail "root README must keep dossier install"
grep -q 'install whetstone@raisedadead-plugins' "$README" || fail "root README must add whetstone install"
grep -qi 'pair\|suite\|together' "$README" || fail "root README must frame the pair as a suite"
grep -qi 'alone\|independent' "$README" || fail "root README must state either plugin works alone"

python3 -m json.tool "$MARKET" >/dev/null || fail "marketplace.json must stay valid JSON"
grep -q '"whetstone"' "$MARKET" || fail "marketplace must list whetstone"
grep -qi 'compose' "$MARKET" || fail "marketplace descriptions must mention the composition"

grep -q 'test_bundle_ux.sh' "$ROOT/.github/workflows/ci.yml" || fail "ci must run this test"

printf 'ok\n'
