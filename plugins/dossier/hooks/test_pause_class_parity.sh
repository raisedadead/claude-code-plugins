#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$SCRIPT_DIR/../../.."

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

parity() {
	python3 - "$1" <<'PY'
import pathlib, re, sys

root = pathlib.Path(sys.argv[1])
fmt_path = root / "plugins" / "dossier" / "FORMAT.md"
skill_path = root / "plugins" / "dossier" / "skills" / "build" / "SKILL.md"
for path in (fmt_path, skill_path):
    if not path.is_file():
        print(f"  missing: {path}", file=sys.stderr)
        sys.exit(2)

fmt = fmt_path.read_text(encoding="utf-8")
matches = re.findall(r"reason class ∈ `\{([^}]*)\}`", fmt)
if len(matches) != 1:
    print(
        f"  FORMAT.md must carry exactly one 'reason class' brace set, found {len(matches)}",
        file=sys.stderr,
    )
    sys.exit(2)
tokens = [token.strip().strip("`").strip() for token in matches[0].split(",")]
tokens = [token for token in tokens if token]
repeated = {token for token in tokens if tokens.count(token) > 1}
if repeated:
    print(f"  duplicated brace-set tokens: {sorted(repeated)}", file=sys.stderr)
    sys.exit(1)
declared = set(tokens)

skill = skill_path.read_text(encoding="utf-8")
try:
    boundary = skill.split("MUST PAUSE")[1]
    boundary, excuse = boundary.split("**Excuse table")[0], boundary.split("**Excuse table")[1]
    excuse = excuse.split("**Rails:**")[0]
except IndexError:
    print("  build/SKILL.md is missing a PAUSE table anchor", file=sys.stderr)
    sys.exit(2)

def rows(block):
    found = re.findall(r"^\|\s*`([a-z-]+)`\s*\|", block, re.M)
    duplicated = {label for label in found if found.count(label) > 1}
    if duplicated:
        print(f"  duplicated rows: {sorted(duplicated)}", file=sys.stderr)
        sys.exit(1)
    return set(found)
tables = {
    "FORMAT.md brace set": declared,
    "decision-boundary table": rows(boundary),
    "excuse table": rows(excuse),
}
if not all(tables.values()):
    for name, value in tables.items():
        if not value:
            print(f"  {name} parsed empty", file=sys.stderr)
    sys.exit(2)

reference = tables["FORMAT.md brace set"]
divergent = False
for name, value in tables.items():
    if value != reference:
        divergent = True
        missing = sorted(reference - value)
        extra = sorted(value - reference)
        print(f"  {name} diverges: missing={missing} extra={extra}", file=sys.stderr)
sys.exit(1 if divergent else 0)
PY
}

if [[ $# -ge 1 ]]; then
	parity "$1"
	exit $?
fi

rc=0
parity "$REPO" || rc=$?
case "$rc" in
0) ;;
1) fail "the PAUSE-class set diverges across FORMAT.md and ds:build (V2)" ;;
*) fail "parity could not be computed — an anchor or table moved, see stderr above" ;;
esac

TMP="$(mktemp -d "${TMPDIR:-/tmp}/ds-parity.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$TMP/plugins/dossier/skills/build"
cp "$REPO/plugins/dossier/FORMAT.md" "$TMP/plugins/dossier/FORMAT.md"
cp "$REPO/plugins/dossier/skills/build/SKILL.md" "$TMP/plugins/dossier/skills/build/SKILL.md"

bash "$0" "$TMP" >/dev/null 2>&1 || fail "an unmutated copy must pass (negative test)"

python3 - "$TMP" <<'PY'
import pathlib, re, sys

path = pathlib.Path(sys.argv[1]) / "plugins" / "dossier" / "skills" / "build" / "SKILL.md"
body = path.read_text(encoding="utf-8")
head, sep, tail = body.partition("**Excuse table")
tail = re.sub(r"^\|\s*`x-stale`\s*\|.*\n", "", tail, count=1, flags=re.M)
path.write_text(head + sep + tail, encoding="utf-8")
PY

rc=0
bash "$0" "$TMP" >/dev/null 2>&1 || rc=$?
[[ "$rc" -eq 1 ]] || fail "dropping a class from the excuse table must exit 1 (got $rc)"

cp "$REPO/plugins/dossier/skills/build/SKILL.md" "$TMP/plugins/dossier/skills/build/SKILL.md"
python3 - "$TMP" <<'PY'
import pathlib, sys

path = pathlib.Path(sys.argv[1]) / "plugins" / "dossier" / "skills" / "build" / "SKILL.md"
body = path.read_text(encoding="utf-8")
renamed = body.replace("**Excuse table", "**Rationalization table", 1)
path.write_text(renamed, encoding="utf-8")
PY

rc=0
bash "$0" "$TMP" >/dev/null 2>&1 || rc=$?
[[ "$rc" -eq 2 ]] || fail "a moved table anchor must exit 2, not 1 — parse failure is not divergence (got $rc)"

cp "$REPO/plugins/dossier/skills/build/SKILL.md" "$TMP/plugins/dossier/skills/build/SKILL.md"
python3 - "$TMP" <<'PY'
import pathlib, re, sys

path = pathlib.Path(sys.argv[1]) / "plugins" / "dossier" / "FORMAT.md"
body = path.read_text(encoding="utf-8")
match = re.search(r"reason class ∈ `\{([^}]*)\}`", body)
tokens = [token.strip() for token in match.group(1).split(",")]
quoted = "reason class ∈ `{" + ", ".join(f"`{token}`" for token in tokens) + "}`"
path.write_text(body[: match.start()] + quoted + body[match.end() :], encoding="utf-8")
PY

bash "$0" "$TMP" >/dev/null 2>&1 || fail "backticking each brace-set token is cosmetic and must still pass"

cp "$REPO/plugins/dossier/FORMAT.md" "$TMP/plugins/dossier/FORMAT.md"
python3 - "$TMP" <<'PY'
import pathlib, re, sys

path = pathlib.Path(sys.argv[1]) / "plugins" / "dossier" / "FORMAT.md"
body = path.read_text(encoding="utf-8")
match = re.search(r"reason class ∈ `\{([^}]*)\}`", body)
first = match.group(1).split(",")[0].strip()
doubled = "reason class ∈ `{" + match.group(1) + ", " + first + "}`"
path.write_text(body[: match.start()] + doubled + body[match.end() :], encoding="utf-8")
PY

rc=0
bash "$0" "$TMP" >/dev/null 2>&1 || rc=$?
[[ "$rc" -eq 1 ]] || fail "a repeated brace-set token must exit 1, as a repeated table row does (got $rc)"

cp "$REPO/plugins/dossier/FORMAT.md" "$TMP/plugins/dossier/FORMAT.md"
python3 - "$TMP" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1]) / "plugins" / "dossier" / "skills" / "build" / "SKILL.md"
body = path.read_text(encoding="utf-8")
head, sep, tail = body.partition("**Excuse table")
match = re.search(r"^\|\s*`x-stale`\s*\|.*\n", tail, flags=re.M)
path.write_text(head + sep + tail[: match.end()] + match.group(0) + tail[match.end() :], encoding="utf-8")
PY

rc=0
bash "$0" "$TMP" >/dev/null 2>&1 || rc=$?
[[ "$rc" -eq 1 ]] || fail "a repeated row inside a PAUSE table must exit 1 (got $rc)"

cp "$REPO/plugins/dossier/skills/build/SKILL.md" "$TMP/plugins/dossier/skills/build/SKILL.md"
python3 - "$TMP" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1]) / "plugins" / "dossier" / "FORMAT.md"
body = path.read_text(encoding="utf-8")
path.write_text(re.sub(r"reason class ∈ `\{[^}]*\}`", "reason class is open", body, count=1), encoding="utf-8")
PY

rc=0
bash "$0" "$TMP" >/dev/null 2>&1 || rc=$?
[[ "$rc" -eq 2 ]] || fail "zero brace sets must exit 2, the same as too many (got $rc)"

DISPATCH="$TMP/dispatch"
mkdir -p "$DISPATCH/plugins/dossier/hooks" "$DISPATCH/plugins/dossier/skills/build"
cp "$0" "$DISPATCH/plugins/dossier/hooks/parity.sh"
cp "$REPO/plugins/dossier/FORMAT.md" "$DISPATCH/plugins/dossier/FORMAT.md"
cp "$REPO/plugins/dossier/skills/build/SKILL.md" "$DISPATCH/plugins/dossier/skills/build/SKILL.md"

python3 - "$DISPATCH" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1]) / "plugins" / "dossier" / "skills" / "build" / "SKILL.md"
body = path.read_text(encoding="utf-8")
head, sep, tail = body.partition("**Excuse table")
path.write_text(head + sep + re.sub(r"^\|\s*`x-stale`\s*\|.*\n", "", tail, count=1, flags=re.M), encoding="utf-8")
PY

rc=0
out="$(bash "$DISPATCH/plugins/dossier/hooks/parity.sh" 2>&1)" || rc=$?
[[ "$rc" -eq 1 ]] || fail "every fixture above passes a path and skips the dispatch; a no-argument run on a divergent tree must fail (got $rc)"
grep -q 'diverges across FORMAT.md' <<<"$out" || fail "the divergence arm must name the divergence, not a downstream fixture"

cp "$REPO/plugins/dossier/skills/build/SKILL.md" "$DISPATCH/plugins/dossier/skills/build/SKILL.md"
python3 - "$DISPATCH" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1]) / "plugins" / "dossier" / "skills" / "build" / "SKILL.md"
body = path.read_text(encoding="utf-8")
path.write_text(body.replace("**Excuse table", "**Rationalization table", 1), encoding="utf-8")
PY

rc=0
out="$(bash "$DISPATCH/plugins/dossier/hooks/parity.sh" 2>&1)" || rc=$?
[[ "$rc" -eq 1 ]] || fail "a no-argument run that cannot compute parity must fail (got $rc)"
grep -q 'could not be computed' <<<"$out" || fail "the parse-failure arm must say so, never report divergence"

printf 'ok\n'
