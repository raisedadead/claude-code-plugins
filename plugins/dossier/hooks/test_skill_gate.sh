#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$SCRIPT_DIR/skill_gate.py"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ds-gate.XXXXXX")"

PYTMP="$(python3 -c 'import tempfile; print(tempfile.gettempdir())')"
SP="tg$$"
cleanup() { rm -rf "$TMP" "$PYTMP"/ds-skill-gate-"$SP"*; }
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

run_gate() {
	printf '%s' "$1" | python3 "$GATE"
}

mkdir -p "$TMP/.scratchpad/dossier/2026-07-20-wave"
printf '| 2026-07-20 | wave | live | P1/1 | 0/1 | 0 | x | — |\n' >"$TMP/.scratchpad/INDEX.md"
printf '{"pid": 1, "skill": "ds:build", "target": "T9"}\n' >"$TMP/.scratchpad/dossier/2026-07-20-wave/.ds-lock"

payload() {
	printf '{"hook_event_name":"PreToolUse","tool_name":"Skill","tool_input":{"skill":"%s"},"cwd":"%s","session_id":"%s"}' "$1" "$TMP" "$2"
}

out="$(run_gate "$(payload review ${SP}-a)")" || fail "gate must exit 0 on builtin"
printf '%s' "$out" | grep -q 'additionalContext' || fail "builtin + live + lock must emit additionalContext"
printf '%s' "$out" | grep -q 'T9' || fail "reminder must name the in-flight target"

out="$(run_gate "$(payload review ${SP}-a)")" || fail "gate must exit 0 on dedup"
[[ -z "$out" ]] || fail "second fire same session must dedup to silence"

out="$(run_gate "$(payload security-review ${SP}-a)")" || fail "gate must exit 0 on second builtin"
printf '%s' "$out" | grep -q 'additionalContext' || fail "different builtin same session must still fire"

out="$(run_gate "$(payload caveman:caveman-review ${SP}-b)")" || fail "gate must exit 0 on namespaced"
[[ -z "$out" ]] || fail "namespaced plugin skill must stay silent"

out="$(run_gate "$(payload foo ${SP}-c)")" || fail "gate must exit 0 on non-builtin"
[[ -z "$out" ]] || fail "non-builtin skill must stay silent"

out="$(run_gate "$(printf '{"hook_event_name":"UserPromptExpansion","command":"simplify","cwd":"%s","session_id":"%s"}' "$TMP" "${SP}-d")")" || fail "gate must exit 0 on typed path"
printf '%s' "$out" | grep -q 'UserPromptExpansion' || fail "typed path must fire with its own event name"

mkdir -p "$TMP/.scratchpad/dossier/2026-07-19-zzz"
printf '{"pid": 1, "skill": "ds:build", "target": "T1"}\n' >"$TMP/.scratchpad/dossier/2026-07-19-zzz/.ds-lock"
out="$(run_gate "$(payload review ${SP}-g)")" || fail "gate must exit 0 with non-live lock present"
printf '%s' "$out" | grep -q 'T9' || fail "non-live dossier lock must be skipped, live lock chosen"

printf '42' >"$TMP/.scratchpad/dossier/2026-07-20-wave/.ds-lock"
out="$(run_gate "$(payload review ${SP}-h)")" || fail "gate must exit 0 on non-dict lock body"
printf '%s' "$out" | grep -q '2026-07-20-wave' || fail "non-dict lock must fall back to dir name"

rm "$TMP/.scratchpad/dossier/2026-07-20-wave/.ds-lock"
out="$(run_gate "$(payload review ${SP}-e)")" || fail "gate must exit 0 without lock"
[[ -z "$out" ]] || fail "no in-flight build must stay silent"

out="$(run_gate "$(payload whetstone:doubt-pass ${SP}-i)")" || fail "gate must exit 0 on whetstone skill"
printf '%s' "$out" | grep -q 'additionalContext' || fail "whetstone skill + live dossier must fire breadcrumb reminder without a lock"
printf '%s' "$out" | grep -q '§S' || fail "breadcrumb reminder must point at §S"

shipped=()
for skill_dir in "$SCRIPT_DIR"/../../whetstone/skills/*/; do
	[[ -f "$skill_dir/SKILL.md" ]] || continue
	shipped+=("whetstone:$(basename "$skill_dir")")
done
[[ ${#shipped[@]} -gt 0 ]] || fail "whetstone must ship at least one skill to compare against"

for skill in "${shipped[@]}"; do
	out="$(run_gate "$(payload "$skill" "${SP}-ship-${skill//:/-}")")" || fail "gate must exit 0 on $skill"
	printf '%s' "$out" | grep -q 'additionalContext' ||
		fail "every shipped whetstone skill must fire the §S breadcrumb — $skill stayed silent"
done

gated="$(python3 -c 'import pathlib, sys; sys.path.insert(0, str(pathlib.Path(sys.argv[1]).parent)); import skill_gate; print("\n".join(sorted(skill_gate.WHETSTONE)))' "$GATE")"
[[ "$gated" == "$(printf '%s\n' "${shipped[@]}" | sort)" ]] ||
	fail "WHETSTONE must equal the shipped whetstone skill set — got [$gated], shipped [${shipped[*]}]"

out="$(run_gate "$(payload whetstone:not-a-shipped-skill ${SP}-l)")" || fail "gate must exit 0 on unknown whetstone name"
[[ -z "$out" ]] || fail "an unshipped whetstone: name must stay silent — the gate is an allowlist, not a prefix match"

printf '| 2026-07-21 | newer | live | P1/1 | 0/1 | 0 | x | — |\n| 2026-07-20 | wave | live | P1/1 | 0/1 | 0 | x | — |\n' >"$TMP/.scratchpad/INDEX.md"
out="$(run_gate "$(payload whetstone:doubt-pass ${SP}-k)")" || fail "gate must exit 0 on multi-live"
printf '%s' "$out" | grep -q '2026-07-21-newer' || fail "multi-live must target the first live row"
printf '| 2026-07-20 | wave | live | P1/1 | 0/1 | 0 | x | — |\n' >"$TMP/.scratchpad/INDEX.md"

rm "$TMP/.scratchpad/INDEX.md"
out="$(run_gate "$(payload review ${SP}-f)")" || fail "gate must exit 0 without INDEX"
[[ -z "$out" ]] || fail "no INDEX must stay silent"

out="$(run_gate "$(payload whetstone:doubt-pass ${SP}-j)")" || fail "gate must exit 0 whetstone no-dossier"
[[ -z "$out" ]] || fail "whetstone skill without live dossier must stay silent"

out="$(printf 'not json' | python3 "$GATE")" || fail "malformed JSON must exit 0"
[[ -z "$out" ]] || fail "malformed JSON must stay silent"

printf '| 2026-07-20 | wave | live | P1/1 | 0/1 | 0 | x | — |\n| 2026-07-02 | older | paused | P1/1 | 1/3 | 0 | x | — |\n| 2026-06-30 | oldest | paused | P1/1 | 0/2 | 0 | x | — |\n' >"$TMP/.scratchpad/INDEX.md"
out="$(run_gate "$(payload dossier:close ${SP}-m)")" || fail "gate must exit 0 on ds:close"
printf '%s' "$out" | grep -q 'additionalContext' || fail "ds:close with paused rows must fire the paused reminder"
printf '%s' "$out" | grep -q '2026-07-02-older' || fail "paused reminder must name every paused slug"
printf '%s' "$out" | grep -q '2026-06-30-oldest' || fail "paused reminder must name every paused slug"
printf '%s' "$out" | grep -q '2026-07-20-wave' && fail "paused reminder must leave the live row out"

out="$(run_gate "$(payload dossier:close ${SP}-m)")" || fail "gate must exit 0 on ds:close dedup"
[[ -z "$out" ]] || fail "second ds:close same session must dedup to silence"

printf '| 2026-07-02 | older | paused | P1/1 | 1/3 | 0 | x | — |\n' >"$TMP/.scratchpad/INDEX.md"
out="$(run_gate "$(payload dossier:close ${SP}-n)")" || fail "gate must exit 0 on paused-only tree"
printf '%s' "$out" | grep -q '2026-07-02-older' || fail "paused reminder must not depend on a live row"

printf '| 2026-07-20 | wave | live | P1/1 | 0/1 | 0 | x | — |\n| 2026-06-01 | gone | done | P1/1 | 2/2 | 0 | x | — |\n' >"$TMP/.scratchpad/INDEX.md"
out="$(run_gate "$(payload dossier:close ${SP}-o)")" || fail "gate must exit 0 with no paused rows"
[[ -z "$out" ]] || fail "ds:close with no paused row must stay silent"

rm "$TMP/.scratchpad/INDEX.md"
out="$(run_gate "$(payload dossier:close ${SP}-p)")" || fail "gate must exit 0 on ds:close without INDEX"
[[ -z "$out" ]] || fail "ds:close without an INDEX must stay silent"

out="$(run_gate "$(payload close ${SP}-q)")" || fail "gate must exit 0 on a bare close name"
[[ -z "$out" ]] || fail "a bare 'close' must stay silent — the gate matches the namespaced name only"

printf '| 2026-07-02 | \xff\xfe | paused | P1/1 | 1/3 | 0 | x | — |\n' >"$TMP/.scratchpad/INDEX.md"
out="$(run_gate "$(payload dossier:close ${SP}-r)")" || fail "a non-UTF-8 INDEX must exit 0, not traceback"
[[ -z "$out" ]] || fail "a non-UTF-8 INDEX must stay silent"
out="$(run_gate "$(payload review ${SP}-s)")" || fail "a non-UTF-8 INDEX must exit 0 on the builtin path too"
[[ -z "$out" ]] || fail "a non-UTF-8 INDEX must stay silent on the builtin path"

HOOKS_JSON="$SCRIPT_DIR/hooks.json"
grep -q '"Skill"' "$HOOKS_JSON" || fail "hooks.json must register the Skill matcher"
grep -q 'UserPromptExpansion' "$HOOKS_JSON" || fail "hooks.json must register UserPromptExpansion"
grep -q 'skill_gate.py' "$HOOKS_JSON" || fail "hooks.json must run skill_gate.py"

printf 'ok\n'
