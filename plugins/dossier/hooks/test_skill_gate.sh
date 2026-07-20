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

rm "$TMP/.scratchpad/INDEX.md"
out="$(run_gate "$(payload review ${SP}-f)")" || fail "gate must exit 0 without INDEX"
[[ -z "$out" ]] || fail "no INDEX must stay silent"

out="$(run_gate "$(payload whetstone:doubt-pass ${SP}-j)")" || fail "gate must exit 0 whetstone no-dossier"
[[ -z "$out" ]] || fail "whetstone skill without live dossier must stay silent"

out="$(printf 'not json' | python3 "$GATE")" || fail "malformed JSON must exit 0"
[[ -z "$out" ]] || fail "malformed JSON must stay silent"

HOOKS_JSON="$SCRIPT_DIR/hooks.json"
grep -q '"Skill"' "$HOOKS_JSON" || fail "hooks.json must register the Skill matcher"
grep -q 'UserPromptExpansion' "$HOOKS_JSON" || fail "hooks.json must register UserPromptExpansion"
grep -q 'skill_gate.py' "$HOOKS_JSON" || fail "hooks.json must run skill_gate.py"
grep -qE 'excuse.*rebuttal|rebuttal.*excuse' "$SCRIPT_DIR/../skills/build/SKILL.md" || fail "build SKILL must carry the excuse-rebuttal table"
grep -q 'test_skill_gate.sh' "$SCRIPT_DIR/../../../.github/workflows/ci.yml" || fail "ci must run this test"

printf 'ok\n'
