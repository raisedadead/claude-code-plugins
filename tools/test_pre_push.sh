#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/pre-push.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

mkdir -p "$TMP/work"
git -C "$ROOT" ls-files -z --cached --others --exclude-standard |
	tar -C "$ROOT" --null -T - -cf - | tar -C "$TMP/work" -xf -
git init -q --bare "$TMP/remote.git"
cd "$TMP/work"
git init -q -b main
git config user.email test@example.invalid
git config user.name test
git config core.hooksPath .githooks
git add -A
git commit -q -m "chore: snapshot"
git remote add origin "$TMP/remote.git"

git push -q origin main >"$TMP/clean.log" 2>&1 ||
	fail "the hook refused a clean tree: $(tail -5 "$TMP/clean.log")"

printf '| O99 | broken | row |\n' >>RESEARCH.md
git commit -q -am "docs: break a research row"
if git push -q origin main >"$TMP/broken.log" 2>&1; then
	fail "the hook let a malformed RESEARCH.md row through"
fi
grep -q 'MALFORMED' "$TMP/broken.log" || fail "the refusal does not name the check: $(tail -5 "$TMP/broken.log")"

git checkout -q HEAD~1 -- RESEARCH.md
printf '\nNever do this. Never that.\n' >>CLAUDE.md
git commit -q -am "docs: add a negation to CLAUDE.md"
if git push -q origin main >"$TMP/rails.log" 2>&1; then
	fail "the hook let the positive-rails ceiling through"
fi
grep -q 'RAILS:' "$TMP/rails.log" || fail "the refusal does not name the rails check: $(tail -5 "$TMP/rails.log")"

printf 'ok pre-push hook\n'
