#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/pre-push.XXXXXX")"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

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

mkdir -p "$TMP/work"
git -C "$ROOT" ls-files -z --cached --others --exclude-standard |
	tar -C "$ROOT" --null -T - -cf - | tar -C "$TMP/work" -xf -
git init -q --bare "$TMP/remote.git"
cd "$TMP/work"
git init -q -b main
git config user.email test@example.invalid
git config user.name test
git config core.hooksPath .githooks
git config core.excludesFile /dev/null
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
