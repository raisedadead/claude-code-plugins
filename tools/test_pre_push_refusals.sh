#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=pre_push_lib.sh
source "$(dirname "$0")/pre_push_lib.sh"

enter_work_repo_pushed

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

printf 'ok pre-push hook refusals\n'
