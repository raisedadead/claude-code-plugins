#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/pipe-grep.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

refused() {
	if (cd "$TMP" && bash "$ROOT/tools/pipe_grep.sh") >"$TMP/out.log" 2>&1; then
		fail "the check passed $1"
	fi
	grep -q "^PIPE-GREP: $1:" "$TMP/out.log" || fail "the refusal does not name $1: $(cat "$TMP/out.log")"
}

pipe='|'
git init -q "$TMP"
mkdir -p "$TMP/bin"
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\nset -euo pipefail\ngrep -q x <<<"$y"\n[[ $(printf a %s grep -c a) == 1 ]]\n[[ -f a ]] %s%s grep -q x a\n# a %s grep -q b\n' \
	"$pipe" "$pipe" "$pipe" "$pipe" >"$TMP/clean.sh"
printf '#!/usr/bin/env python3\nx = "a %s grep -q a"\n' "$pipe" >"$TMP/bin/py"
git -C "$TMP" add -A
(cd "$TMP" && bash "$ROOT/tools/pipe_grep.sh") || fail "the check refused a here-string, grep -c, ||, a comment or a python file"

bad=(
	'sys_of %s grep -qi drift'
	'printf a %s grep -E -q a'
	'printf a %s grep --quiet a'
	'printf a %s& grep -q a'
	'printf a %s LC_ALL=C grep -q a'
	'printf a %s command grep -qv a'
	'printf a %s grep --silent a'
	'printf a %s env A1=x \\grep -q a'
	'printf a %s /usr/bin/egrep -q a'
)
for i in "${!bad[@]}"; do
	# shellcheck disable=SC2059
	printf "#!/usr/bin/env bash\nset -euo pipefail\n${bad[$i]}\n" "$pipe" >"$TMP/bad$i.sh"
done
# shellcheck disable=SC2059
printf "#!/bin/sh\n${bad[0]}\n" "$pipe" >"$TMP/bin/tool"
# shellcheck disable=SC2059
printf "${bad[0]}\n" "$pipe" >"$TMP/lib.bash"
ln -s bad0.sh "$TMP/link.sh"
git -C "$TMP" add -A
for i in "${!bad[@]}"; do refused "bad$i.sh:3"; done
refused 'bin/tool:2'
refused 'lib.bash:1'
if grep -q '^PIPE-GREP: link.sh:' "$TMP/out.log"; then
	fail "the check scanned a symlink, so a file is reported twice"
fi

printf 'ok pipe-grep\n'
