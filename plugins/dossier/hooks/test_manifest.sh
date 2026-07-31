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

python3 - "$ROOT" <<'PY' || fail "a shipped markdown link escapes its plugin root"
import os, re, sys

root = os.path.realpath(sys.argv[1])
link_re = re.compile(r"\]\((\.[^)\s]*)\)")
bad = []
for plugin in ("dossier", "whetstone"):
    proot = os.path.join(root, "plugins", plugin)
    for dirpath, _, files in os.walk(proot):
        for name in files:
            if not name.endswith(".md"):
                continue
            path = os.path.join(dirpath, name)
            with open(path, encoding="utf-8") as handle:
                body = handle.read()
            for match in link_re.finditer(body):
                target = match.group(1).split("#")[0]
                if not target:
                    continue
                resolved = os.path.normpath(os.path.join(dirpath, target))
                if resolved != proot and not resolved.startswith(proot + os.sep):
                    bad.append(f"{os.path.relpath(path, root)} -> {match.group(1)}")
for entry in bad:
    print(f"  escapes install root: {entry}", file=sys.stderr)
sys.exit(1 if bad else 0)
PY

printf 'ok\n'
