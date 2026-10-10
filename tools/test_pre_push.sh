#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/pre-push.XXXXXX")"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=maintenance.auto GIT_CONFIG_VALUE_0=false

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
	fail "the hook refused a clean tree: $(tail -5 "$TMP/clean.log")"

printf '| O99 | broken | row |\n' >>RESEARCH.md
git commit -q -am "docs: break a research row"
refused broken MALFORMED main
git reset -q --hard origin/main

printf '\nNever do this. Never that.\n' >>CLAUDE.md
git commit -q -am "docs: add a negation to CLAUDE.md"
refused rails 'RAILS:' main
git reset -q --hard origin/main

printf 'export const x = {a:1}\n' >plugins/dossier/engine/zz.ts
git add plugins/dossier/engine/zz.ts
git commit -q -m "chore: add an unformatted file"
refused format 'Format issues' main
git reset -q --hard origin/main

printf 'export const r = new Array(3)\n' >plugins/dossier/engine/zz.ts
git add plugins/dossier/engine/zz.ts
git commit -q -m "chore: add a lint warning"
refused lint 'no-new-array' main
git reset -q --hard origin/main

printf "export const n: number = 'x'\n" >plugins/dossier/engine/zz.ts
git add plugins/dossier/engine/zz.ts
git commit -q -m "chore: add a type error"
refused type 'TS2322' main
git reset -q --hard origin/main

printf "import { expect, test } from 'vitest'\n\ntest('fails', () => {\n  expect(1).toBe(2)\n})\n" >plugins/dossier/tests/test_zz.ts
git add plugins/dossier/tests/test_zz.ts
git commit -q -m "test: add a failing test"
refused tests 'FAIL' main
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

printf 'ok pre-push hook\n'
