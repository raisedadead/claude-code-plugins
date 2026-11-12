#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=pre_push_lib.sh
source "$(dirname "$0")/pre_push_lib.sh"

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

enter_work_repo

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

printf 'ok pre-push hook\n'
