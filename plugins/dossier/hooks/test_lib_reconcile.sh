#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RECON="$SCRIPT_DIR/lib-reconcile-state.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-reconcile.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

SP="$TMP/.scratchpad"
DD="$SP/dossier"
ARC="$DD/_archive"

make_doss() {
	local slug="$1" token="$2" zbody="$3"
	local dir="$DD/$slug"
	mkdir -p "$dir"
	cat >"$dir/DOSSIER.md" <<EOF
\`2026-06-01\` · \`${token}\` · \`P1/1\`

## §T — Task ledger

| T1 | P1 | x | thing | [a1] | — |

## §S — Rolling status log

2026-06-01 10:00 ds:close — START successor=— complete=true abandon=false

## §Z — Closeout

${zbody}
EOF
}

hdr_of() {
	awk '/^`.*` · `.*` · / { n=split($0,p,"`"); gsub(/^[ \t]+|[ \t]+$/,"",p[4]); print p[4]; exit }' "$1"
}

make_doss "2026-06-05-zombie" "done" "complete: true"
make_doss "2026-06-04-crashflip" "live" "successor: next-phase"
make_doss "2026-06-03-partial" "done" "_(empty)_"
make_doss "2026-06-02-alive" "live" "_(empty)_"
make_doss "2026-06-01-locked" "done" "complete: true"
printf '{"pid": %d, "started": "2026-06-01T10:00:00Z", "skill": "ds:close"}' "$$" >"$DD/2026-06-01-locked/.ds-lock"

"$RECON" "$SP"

[[ -f "$ARC/2026-06-05-zombie/DOSSIER.md" ]] || fail "§Z-closed done zombie must be auto-archived"
[[ ! -e "$DD/2026-06-05-zombie" ]] || fail "auto-archived zombie must leave live location"
grep -q 'ds:reconcile' "$ARC/2026-06-05-zombie/DOSSIER.md" || fail "auto-archive must leave a §S breadcrumb"

[[ -f "$ARC/2026-06-04-crashflip/DOSSIER.md" ]] || fail "§Z-closed live-header (crash between §Z and flip) must be healed"
[[ "$(hdr_of "$ARC/2026-06-04-crashflip/DOSSIER.md")" == "done" ]] || fail "heal must flip header to done before archiving"

[[ -d "$DD/2026-06-03-partial" ]] || fail "done-header with empty §Z is detect-only, must NOT be auto-moved"
[[ -d "$DD/2026-06-02-alive" ]] || fail "concordant live dossier must be untouched"
[[ -d "$DD/2026-06-01-locked" ]] || fail "locked (active op) dossier must not be reconciled"

"$RECON" "$SP"
[[ -f "$ARC/2026-06-05-zombie/DOSSIER.md" ]] || fail "second reconcile must be idempotent"

mkdir -p "$ARC/2026-05-01-inverse"
cat >"$ARC/2026-05-01-inverse/DOSSIER.md" <<'EOF'
`2026-05-01` · `live` · `P1/1`

## §Z — Closeout

complete: true
EOF
"$RECON" "$SP"
[[ "$(hdr_of "$ARC/2026-05-01-inverse/DOSSIER.md")" == "done" ]] || fail "archived dir with a non-done header must be healed to done (inverse drift)"

printf 'ok\n'
