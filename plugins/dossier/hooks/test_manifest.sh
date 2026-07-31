#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/../../.."
MARKET="$ROOT/.claude-plugin/marketplace.json"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

python3 -m json.tool "$MARKET" >/dev/null || fail "marketplace.json must stay valid JSON"
grep -q '"whetstone"' "$MARKET" || fail "marketplace must list whetstone"

printf 'ok\n'
