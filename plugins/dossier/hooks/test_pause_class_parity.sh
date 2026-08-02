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
declared = {token.strip() for token in matches[0].split(",") if token.strip()}

skill = skill_path.read_text(encoding="utf-8")
try:
    boundary = skill.split("MUST PAUSE (never auto-resolve):**")[1]
    boundary, excuse = boundary.split("**Excuse table")[0], boundary.split("**Excuse table")[1]
    excuse = excuse.split("**Rails:**")[0]
except IndexError:
    print("  build/SKILL.md is missing a PAUSE table anchor", file=sys.stderr)
    sys.exit(2)

rows = lambda block: set(re.findall(r"^\|\s*`([a-z-]+)`\s*\|", block, re.M))
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

printf 'ok\n'
