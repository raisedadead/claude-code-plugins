#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=pre_push_lib.sh
source "$(dirname "$0")/pre_push_lib.sh"

enter_work_repo

printf 'note\n' >notes.txt
git add notes.txt
git commit -q -m "docs: add a note"

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

mkdir -p "$TMP/septree/.githooks"
cp "$ROOT/.githooks/pre-push" "$TMP/septree/.githooks/"
sep=(git --git-dir="$TMP/sep.git" --work-tree="$TMP/septree")
"${sep[@]}" init -q -b main
"${sep[@]}" config core.hooksPath .githooks
"${sep[@]}" -c user.email=test@example.invalid -c user.name=test commit -q --allow-empty -m "chore: separate git dir"
if (cd "$TMP/septree" && "${sep[@]}" push -q "$TMP/remote.git" main:sep) >"$TMP/sep.log" 2>&1; then
	fail "the hook let a push with a separate git dir through"
fi
grep -q 'GITDIR:' "$TMP/sep.log" || fail "the separate git dir refusal does not name GITDIR: $(tail -3 "$TMP/sep.log")"

printf 'ok pre-push hook worktrees\n'
