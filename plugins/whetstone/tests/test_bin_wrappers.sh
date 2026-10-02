#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="$SCRIPT_DIR/../bin"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/whet-bin.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

dangling() {
	local bin_dir="$1" wrapper target
	for wrapper in "$bin_dir"/*; do
		# shellcheck disable=SC2016
		target="$(sed -n 's|.*\$(cd "\$(dirname "\$0")/\.\." \&\& pwd)/\([^"]*\)".*|\1|p' "$wrapper")"
		if [[ -z $target || ! -f "$bin_dir/../$target" ]]; then
			basename "$wrapper"
		fi
	done
}

missing="$(dangling "$BIN")"
[[ -z $missing ]] || fail "wrappers point at no script: $missing"

mkdir -p "$TMP/bin"
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\nexec bash "$(cd "$(dirname "$0")/.." && pwd)/skills/x/run.sh" "$@"\n' >"$TMP/bin/gone"
[[ "$(dangling "$TMP/bin")" == "gone" ]] || fail "a wrapper pointing at a moved script must be reported"

git init -q "$TMP/repo"
printf 'x\n' >"$TMP/repo/a.py"
git -C "$TMP/repo" add a.py
(cd "$TMP/repo" && "$BIN/tiger-check") | grep -q '^TIGER: CLEAN ' || fail "bin/tiger-check must print TIGER: CLEAN on a clean stage"

printf 'ok test_bin_wrappers\n'
