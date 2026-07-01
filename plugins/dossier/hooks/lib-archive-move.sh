#!/usr/bin/env bash
set -euo pipefail

SRC="${1:?usage: lib-archive-move.sh <src-dossier-dir> <archive-parent-dir>}"
ARCHIVE="${2:?archive-parent dir required}"

SRC="${SRC%/}"
ARCHIVE="${ARCHIVE%/}"
base="$(basename "$SRC")"
DEST="${ARCHIVE}/${base}"

if [[ ! -e "$SRC" && -f "$DEST/DOSSIER.md" ]]; then
	exit 0
fi

[[ -d "$SRC" ]] || {
	printf 'lib-archive-move: src not a directory: %s\n' "$SRC" >&2
	exit 1
}
[[ -f "$SRC/DOSSIER.md" ]] || {
	printf 'lib-archive-move: no DOSSIER.md in src: %s\n' "$SRC" >&2
	exit 1
}

if [[ -e "$DEST" ]]; then
	printf 'lib-archive-move: dest already exists, refusing (would nest): %s\n' "$DEST" >&2
	exit 1
fi

mkdir -p "$ARCHIVE" 2>/dev/null || {
	printf 'lib-archive-move: cannot create archive parent: %s\n' "$ARCHIVE" >&2
	exit 1
}

if ! mv "$SRC" "$DEST" 2>/dev/null; then
	printf 'lib-archive-move: mv failed, src preserved: %s -> %s\n' "$SRC" "$DEST" >&2
	exit 1
fi

if [[ -f "$DEST/DOSSIER.md" && ! -e "$SRC" ]]; then
	exit 0
fi

printf 'lib-archive-move: post-move assertion failed: %s\n' "$DEST" >&2
exit 1
