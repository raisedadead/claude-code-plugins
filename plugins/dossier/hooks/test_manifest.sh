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
	if python3 -c 'import json,sys; sys.exit(0 if "version" in json.load(open(sys.argv[1])) else 1)' "$m"; then
		fail "$m carries a version key. Commit SHA is the version — see RESEARCH.md D1. Adding one was tried and deliberately reverted."
	fi
done

if python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if any("version" in p for p in d.get("plugins",[])) else 1)' "$MARKET"; then
	fail "a marketplace plugin entry carries a version key. Commit SHA is the version — see RESEARCH.md D1."
fi

printf 'ok\n'
