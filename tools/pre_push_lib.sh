#!/usr/bin/env bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

enter_work_repo() {
	mkdir -p "$TMP/work"
	(
		cd "$ROOT" || exit
		git ls-files -z --cached --others --exclude-standard |
			while IFS= read -r -d '' path; do [[ -e $path ]] && printf '%s\0' "$path"; done |
			tar --null -T - -cf -
	) | tar -C "$TMP/work" -xf -
	git init -q --bare "$TMP/remote.git"
	git -C "$TMP/remote.git" config receive.autogc false
	cd "$TMP/work" || exit
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
}

enter_work_repo_pushed() {
	enter_work_repo
	git push -q --no-verify origin main
}
