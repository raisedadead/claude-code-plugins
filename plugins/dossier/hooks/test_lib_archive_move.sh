#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOVE="$SCRIPT_DIR/lib-archive-move.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-move.XXXXXX")"

cleanup() {
	chmod -R u+rwx "$TMP" 2>/dev/null || true
	rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

make_src() {
	local dir="$1"
	mkdir -p "$dir"
	printf 'closed dossier fixture\n' >"$dir/DOSSIER.md"
}

D="$TMP/dossier"
ARC="$D/_archive"

make_src "$D/2026-06-01-happy"
"$MOVE" "$D/2026-06-01-happy" "$ARC" || fail "happy move must exit 0"
[[ -f "$ARC/2026-06-01-happy/DOSSIER.md" ]] || fail "moved dossier missing at dest"
[[ ! -e "$D/2026-06-01-happy" ]] || fail "src must be gone after move"

"$MOVE" "$D/2026-06-01-happy" "$ARC" || fail "resume of already-moved must be idempotent no-op exit 0"

make_src "$D/2026-06-01-clash"
mkdir -p "$ARC/2026-06-01-clash"
printf 'pre-existing\n' >"$ARC/2026-06-01-clash/DOSSIER.md"
if "$MOVE" "$D/2026-06-01-clash" "$ARC" 2>/dev/null; then fail "pre-existing dest must be refused"; fi
[[ -f "$D/2026-06-01-clash/DOSSIER.md" ]] || fail "src must survive a refused move"
grep -q 'pre-existing' "$ARC/2026-06-01-clash/DOSSIER.md" || fail "refused move must not clobber dest"

make_src "$D/2026-06-01-nodest"
if "$MOVE" "$D/2026-06-01-missing" "$ARC" 2>/dev/null; then fail "missing src must error"; fi

make_src "$D/2026-06-01-ro"
RO="$TMP/readonly-archive"
mkdir -p "$RO"
chmod 500 "$RO"
if "$MOVE" "$D/2026-06-01-ro" "$RO/arc" 2>/dev/null; then fail "unwritable archive parent must fail"; fi
[[ -f "$D/2026-06-01-ro/DOSSIER.md" ]] || fail "src must survive a failed move (rollback)"
chmod 700 "$RO"

printf 'ok\n'
