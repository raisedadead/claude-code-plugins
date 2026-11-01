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

git init -q "$TMP"
mkdir -p "$TMP/bin"
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\nset -euo pipefail\ngrep -q x <<<"$y"\n[[ $(printf a | grep -c a) == 1 ]]\n' >"$TMP/clean.sh"
printf '#!/usr/bin/env bash\nset -eu\nprintf a | grep -q a\n' >"$TMP/no_pipefail.sh"
printf '#!/usr/bin/env python3\n# set -o pipefail\nx = "a | grep -q a"\n' >"$TMP/bin/py"
git -C "$TMP" add -A

(cd "$TMP" && bash "$ROOT/tools/pipe_grep.sh") || fail "the check refused files with no pipe into grep -q under pipefail"

printf '#!/usr/bin/env bash\nset -euo pipefail\nok=1\nsys_of | grep -qi drift || exit 1\n' >"$TMP/bad.sh"
printf '#!/usr/bin/env bash\nset -euo pipefail\nprintf a | grep -qF a\n' >"$TMP/bin/tool"
git -C "$TMP" add -A
if (cd "$TMP" && bash "$ROOT/tools/pipe_grep.sh") >"$TMP/out.log" 2>&1; then
	fail "the check passed a pipe into grep -q under pipefail"
fi
grep -q '^PIPE-GREP: bad.sh:4:' "$TMP/out.log" || fail "the refusal does not name bad.sh:4: $(cat "$TMP/out.log")"
grep -q '^PIPE-GREP: bin/tool:3:' "$TMP/out.log" || fail "the refusal does not name a script without a .sh suffix: $(cat "$TMP/out.log")"
if grep -q 'no_pipefail.sh' "$TMP/out.log"; then
	fail "the check named a file that does not set pipefail"
fi

printf 'ok pipe-grep\n'
