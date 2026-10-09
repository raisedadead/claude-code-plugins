#!/usr/bin/env bash
set -euo pipefail

pattern='\bnever\b|\bdo not\b|\bdon.t\b|\bmust not\b'
files=(plugins/dossier/skills/build/SKILL.md plugins/dossier/agents/dossier-reviewer.md CLAUDE.md)

count() { { grep -oiE "$pattern" "$@" || true; } | wc -l | tr -d ' '; }

for file in "${files[@]}"; do
	[[ -f $file ]] || {
		printf 'RAILS: %s is missing\n' "$file" >&2
		exit 1
	}
done

[[ "$(count plugins/dossier/skills/build/SKILL.md)" -le 13 ]] || {
	printf 'RAILS: build/SKILL.md is over 13\n' >&2
	exit 1
}
[[ "$(count plugins/dossier/agents/dossier-reviewer.md)" -le 9 ]] || {
	printf 'RAILS: dossier-reviewer.md is over 9\n' >&2
	exit 1
}
[[ "$(count CLAUDE.md)" -le 1 ]] || {
	printf 'RAILS: CLAUDE.md is over 1\n' >&2
	exit 1
}

contract=$(find .dossier -maxdepth 1 -name '*positive-rails*.md' 2>/dev/null | LC_ALL=C sort | head -n 1)
if [[ -z $contract ]]; then
	contract=$(find .dossier/_archive -maxdepth 1 -name '*positive-rails*.md' 2>/dev/null | LC_ALL=C sort | head -n 1)
fi
if [[ -z $contract ]]; then
	printf 'RAILS: no positive-rails contract under .dossier/ or .dossier/_archive/\n' >&2
	exit 1
fi
rows=$(sed -n '/^## survivors/,/^## what changes/p' "$contract" | grep -c -e '| fact' -e '| guarded' -e '| hatch' || true)
total=$(count "${files[@]}")
if [[ $rows -ne $total ]]; then
	printf 'RAILS: %s lists %s survivors; the rails carry %s occurrences\n' "$contract" "$rows" "$total" >&2
	exit 1
fi
