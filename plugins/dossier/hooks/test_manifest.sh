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

python3 - "$ROOT" <<'PY' || fail "a shipped doc names a skill or agent id that does not exist"
import os, re, sys

root = os.path.realpath(sys.argv[1])
id_re = re.compile(r"\b(dossier|whetstone):([a-z][a-z0-9-]*)\b")
bad = set()
for plugin in ("dossier", "whetstone"):
    proot = os.path.join(root, "plugins", plugin)
    for dirpath, _, files in os.walk(proot):
        for name in files:
            if not name.endswith(".md"):
                continue
            path = os.path.join(dirpath, name)
            with open(path, encoding="utf-8") as handle:
                body = handle.read()
            for owner, ident in id_re.findall(body):
                oroot = os.path.join(root, "plugins", owner)
                skill = os.path.join(oroot, "skills", ident, "SKILL.md")
                agent = os.path.join(oroot, "agents", f"{ident}.md")
                if not os.path.exists(skill) and not os.path.exists(agent):
                    bad.add(f"{os.path.relpath(path, root)} -> {owner}:{ident}")
for entry in sorted(bad):
    print(f"  unresolvable id: {entry}", file=sys.stderr)
sys.exit(1 if bad else 0)
PY

python3 - "$ROOT" <<'PY' || fail "FORMAT.md's bundled-helper count word disagrees with the roster table under it"
import os, re, sys

root = os.path.realpath(sys.argv[1])
fmt_path = os.path.join(root, "plugins", "dossier", "FORMAT.md")
with open(fmt_path, encoding="utf-8") as handle:
    body = handle.read()

words = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}
lead = re.search(r"^(\w+) scripts under `\$CLAUDE_PLUGIN_ROOT/hooks/`", body, re.M)
if not lead:
    print("  FORMAT.md carries no 'N scripts under $CLAUDE_PLUGIN_ROOT/hooks/' sentence", file=sys.stderr)
    sys.exit(2)
stated = words.get(lead.group(1).lower())
if stated is None:
    print(f"  helper count is not a number word: {lead.group(1)}", file=sys.stderr)
    sys.exit(2)

rows, started = [], False
for line in body[lead.end():].splitlines():
    if line.startswith("|"):
        started = True
        rows.append(line)
    elif started:
        break
roster = []
for row in rows:
    hit = re.match(r"^\| `(lib-[a-z0-9-]+\.sh)`", row)
    if hit and hit.group(1) not in roster:
        roster.append(hit.group(1))

bad = []
if len(roster) != stated:
    bad.append(f"sentence says {stated}, table lists {len(roster)}: {roster}")
for helper in roster:
    if not os.path.isfile(os.path.join(root, "plugins", "dossier", "hooks", helper)):
        bad.append(f"table names a helper absent from hooks/: {helper}")
for entry in bad:
    print(f"  {entry}", file=sys.stderr)
sys.exit(1 if bad else 0)
PY

python3 - "$ROOT" <<'PY' || fail "a discovery command written in FORMAT.md no longer runs clean from the repo root"
import os, re, shlex, subprocess, sys

root = os.path.realpath(sys.argv[1])
fmt_path = os.path.join(root, "plugins", "dossier", "FORMAT.md")
with open(fmt_path, encoding="utf-8") as handle:
    body = handle.read()

bad = []
for span in re.findall(r"`([^`\n]+)`", body):
    cmd = span.strip()
    if not cmd.startswith("grep ") or "plugins/dossier/" not in cmd:
        continue
    try:
        argv = shlex.split(cmd)
    except ValueError as exc:
        bad.append(f"{cmd} -> unparseable: {exc}")
        continue
    done = subprocess.run(argv, cwd=root, capture_output=True, text=True, check=False)
    if done.returncode != 0:
        note = done.stderr.strip().splitlines()
        bad.append(f"{cmd} -> exit {done.returncode} {note[0] if note else '(no match)'}")
for entry in bad:
    print(f"  a maintainer running this from FORMAT.md gets nothing: {entry}", file=sys.stderr)
sys.exit(1 if bad else 0)
PY

printf 'ok\n'
