#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/pre-push.XXXXXX")"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=maintenance.auto GIT_CONFIG_VALUE_0=false
export PRE_PUSH_STEPS=rails CI_STEPS=not-a-step

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

refused() {
	local log="$TMP/$1.log" mark="$2"
	shift 2
	if git push -q origin "$@" >"$log" 2>&1; then
		fail "the hook let the push through ($mark expected)"
	fi
	grep -q "$mark" "$log" || fail "the refusal does not name $mark: $(tail -5 "$log")"
}

mkdir -p "$TMP/rails/plugins/dossier/skills/build" "$TMP/rails/plugins/dossier/agents" "$TMP/rails/.dossier"
printf 'Write the test first.\n' | tee "$TMP/rails/plugins/dossier/skills/build/SKILL.md" \
	"$TMP/rails/plugins/dossier/agents/dossier-reviewer.md" "$TMP/rails/CLAUDE.md" >/dev/null
printf '## survivors\n\n## what changes\n' >"$TMP/rails/.dossier/2026-08-02-positive-rails.md"
(cd "$TMP/rails" && bash "$ROOT/tools/rails_ceiling.sh") ||
	fail "the rails check refused files with no negation and a contract with no survivor"
rm "$TMP/rails/CLAUDE.md"
if (cd "$TMP/rails" && bash "$ROOT/tools/rails_ceiling.sh") 2>"$TMP/missing.log"; then
	fail "the rails check passed with CLAUDE.md missing"
fi
grep -q 'RAILS:' "$TMP/missing.log" || fail "the missing-file refusal does not name RAILS:"

printf 'Write the test first.\n' >"$TMP/rails/CLAUDE.md"
printf '## survivors\n\n| x | y | fact |\n\n## what changes\n' >"$TMP/rails/.dossier/2026-08-02-positive-rails.md"
if (cd "$TMP/rails" && bash "$ROOT/tools/rails_ceiling.sh") 2>"$TMP/mismatch.log"; then
	fail "the rails check passed with 1 survivor and 0 negations"
fi
grep -q 'lists 1 survivors' "$TMP/mismatch.log" || fail "the mismatch refusal does not name the count"

printf 'You don\342\200\231t.\n' >"$TMP/rails/CLAUDE.md"
(cd "$TMP/rails" && LC_ALL=C bash "$ROOT/tools/rails_ceiling.sh") ||
	fail "the rails check missed a curly-apostrophe negation under LC_ALL=C"

mkdir -p "$TMP/work"
(
	cd "$ROOT"
	git ls-files -z --cached --others --exclude-standard |
		while IFS= read -r -d '' path; do [[ -e $path ]] && printf '%s\0' "$path"; done |
		tar --null -T - -cf -
) | tar -C "$TMP/work" -xf -
git init -q --bare "$TMP/remote.git"
git -C "$TMP/remote.git" config receive.autogc false
cd "$TMP/work"
git init -q -b main
git config user.email test@example.invalid
git config user.name test
git config core.hooksPath .githooks
git config core.excludesFile /dev/null
ln -s "$ROOT/node_modules" node_modules
printf 'node_modules\n' >>.git/info/exclude
git add -A
git commit -q -m "chore: snapshot"
git remote add origin "$TMP/remote.git"

git push -q origin main >"$TMP/clean.log" 2>&1 ||
	fail "the hook refused a clean tree, or read a stale CI_STEPS: $(tail -5 "$TMP/clean.log")"
grep -q '^pre-push: PRE_PUSH_STEPS runs only: rails$' "$TMP/clean.log" || fail "the hook did not say that PRE_PUSH_STEPS narrowed the checks"

if CI_STEPS=' ' bash tools/ci.sh tools >"$TMP/none.log" 2>&1; then
	fail "ci.sh passed with no step selected"
fi
grep -qE '^CI: FAIL no-step-selected in [0-9.]+s$' "$TMP/none.log" || fail "ci.sh did not name the empty selection: $(tail -1 "$TMP/none.log")"

list="$(CI_LIST=1 bash tools/ci.sh all 2>&1)" || fail "CI_LIST=1 must exit 0: $list"
for name in rows dossier-tests whetstone-tests pre-push; do
	grep -qx "$name" <<<"$list" || fail "the full run the hook starts has no $name step"
done
grep -q '^CI:' <<<"$list" && fail "CI_LIST=1 must list the steps, not run them"

printf '\nNever do this. Never that.\n' >>CLAUDE.md
git commit -q -am "docs: add a negation to CLAUDE.md"
refused rails 'RAILS:' main
grep -qE '^CI: FAIL 1 of 1 in [0-9.]+s — rails$' "$TMP/rails.log" || fail "the summary does not name the failed step: $(tail -1 "$TMP/rails.log")"
git reset -q --hard origin/main

printf "export const r = new Array(3)\nexport const n: number = 'x'\nexport const x = {a:1}\n" >plugins/dossier/engine/zz.ts
git add plugins/dossier/engine/zz.ts
git commit -q -m "chore: add a file that fails format, lint and types"
PRE_PUSH_STEPS='rails format lint types' refused tools 'no-new-array' main
grep -q 'TS2322' "$TMP/tools.log" || fail "the types step did not fail on a type error"
grep -q 'Format issues' "$TMP/tools.log" || fail "the format step did not fail on an unformatted file"
grep -qE '^CI: FAIL 3 of 4 in [0-9.]+s — format lint types$' "$TMP/tools.log" || fail "the summary does not name the failed steps: $(tail -1 "$TMP/tools.log")"
git reset -q --hard origin/main

printf "          node-version: '0.0.1'\n" >>.github/workflows/ci.yml
git commit -q -am "ci: pin two node versions"
refused pin 'PIN: no single node pin' main
git reset -q --hard origin/main

printf 'note\n' >notes.txt
git add notes.txt
git commit -q -m "docs: add a note"
printf '| O99 | broken | row |\n' >>RESEARCH.md
refused dirty 'DIRTY:' main
git checkout -q -- RESEARCH.md

git branch side origin/main~0
git commit -q --allow-empty -m "chore: move past side"
refused ref 'REF:' side

git tag v-old origin/main
printf 'scratch\n' >>notes.txt
git push -q origin v-old >"$TMP/tag.log" 2>&1 ||
	fail "the hook refused a tag on an older commit from a dirty tree: $(tail -5 "$TMP/tag.log")"

git checkout -q -- notes.txt
git checkout -q main
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\nprintf "steps=%%s list=%%s\\n" "${CI_STEPS-unset}" "${CI_LIST-unset}"\n' >tools/ci.sh
git commit -q -am "test: stub the checks"
CI_LIST=1 env -u PRE_PUSH_STEPS git push -q origin main >"$TMP/stale.log" 2>&1 || fail "the stubbed push failed: $(tail -5 "$TMP/stale.log")"
grep -q '^steps=unset list=unset$' "$TMP/stale.log" || fail "the hook passed a stale CI_STEPS or CI_LIST to the checks: $(tail -1 "$TMP/stale.log")"

git init -q "$TMP/foreign"
git worktree add -q -b linked "$TMP/linked"
cd "$TMP/linked"
cat >tools/ci.sh <<'STUB'
#!/usr/bin/env bash
printf 'git_dir=%s\n' "${GIT_DIR-unset}"
printf 'foreign=%s\n' "$(git -C "$FOREIGN" rev-parse --absolute-git-dir)"
STUB
git commit -q -am "test: report what the checks inherit"

printf 'scratch\n' >>notes.txt
refused linked-dirty 'DIRTY:' linked
git checkout -q -- notes.txt

cp "$(git rev-parse --git-path index)" "$TMP/alt-index"
printf 'alt\n' >alt.txt
GIT_INDEX_FILE="$TMP/alt-index" git add alt.txt
GIT_INDEX_FILE="$TMP/alt-index" git commit -q -m "docs: commit through another index"
GIT_INDEX_FILE="$TMP/alt-index" refused alt-index 'DIRTY:' linked
git reset -q

FOREIGN="$TMP/foreign" git push -q origin linked >"$TMP/linked.log" 2>&1 ||
	fail "the hook refused a clean push from a linked worktree: $(tail -5 "$TMP/linked.log")"
grep -qx 'git_dir=unset' "$TMP/linked.log" || fail "the checks inherited GIT_DIR from a linked worktree: $(cat "$TMP/linked.log")"
grep -q '^foreign=.*/foreign/\.git$' "$TMP/linked.log" || fail "a check's git command missed the repo it named: $(cat "$TMP/linked.log")"

printf 'ok pre-push hook\n'
