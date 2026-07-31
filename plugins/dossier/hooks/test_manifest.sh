#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/../../.."
MARKET="$ROOT/.claude-plugin/marketplace.json"
MANIFESTS=(
	"$ROOT/plugins/dossier/.claude-plugin/plugin.json"
	"$ROOT/plugins/whetstone/.claude-plugin/plugin.json"
)

DEAD_SCHEMA="https://json.schemastore.org/claude-code-plugin.json"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

python3 -m json.tool "$MARKET" >/dev/null || fail "marketplace.json must stay valid JSON"
grep -q '"whetstone"' "$MARKET" || fail "marketplace must list whetstone"

for m in "${MANIFESTS[@]}"; do
	python3 -m json.tool "$m" >/dev/null || fail "$m must stay valid JSON"
	if grep -qF "$DEAD_SCHEMA" "$m"; then
		fail "$m declares a \$schema URL that 404s; live name is claude-code-plugin-manifest.json"
	fi
done

printf 'ok\n'
