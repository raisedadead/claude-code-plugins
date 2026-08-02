---
name: new
description: Scaffold a new dossier. Sole entrypoint for starting a phase wave. Invoke when the user says "new dossier", "start dossier", "open dossier", "ds:new", or "scaffold dossier <slug>".
argument-hint: <slug>
---

# ds:new — scaffold a new dossier

Creates `.scratchpad/dossier/<YYYY-MM-DD>-<slug>/DOSSIER.md` per `FORMAT.md`. Then prompts operator for goal + scope + repos.

## Inputs

- `<slug>` from `$ARGUMENTS` (kebab-case, ≤30 chars). If empty, ask operator.
- Date defaults to today (`date +%Y-%m-%d`). Override via prompt only if migrating historical work.

## Steps

### 0. Detect host env

Run once. Cache for invocation.

- `command -v rtk &>/dev/null && echo HAS_RTK`
- check tool namespace for `mcp__cavemem__*`, `mcp__fastedit__*`
- check available skills for `caveman:*`, `ck:*`

See `plugins/dossier/ADAPTERS.md` for routing rules. Never error if absent.

The §S DONE line (step 6) appends via `$CLAUDE_PLUGIN_ROOT/hooks/lib-s-append.sh <dir> "<event>"` (FORMAT.md §15) — pass the text **after** the timestamp; the script prepends it. Initial scaffold is a full Write (new file).

### 1. Validate slug + path

- Slug must match `^[a-z0-9][a-z0-9-]{0,29}$`. Refuse otherwise w/ explanation.
- Compute `dir=.scratchpad/dossier/<date>-<slug>/`.
- Collision check: if `dir` exists **OR `.scratchpad/dossier/_archive/<date>-<slug>/` exists** (a same-day close+reopen), ask operator to bump to `<slug>-2`, `<slug>-3`, etc. Checking `_archive/` too avoids two INDEX rows keyed to one slug (Vm.1).

### 1.5. Grill gate (conditional)

Only fires when a grill artifact exists for this slug — trivial `ds:new` runs are untouched. `<slug>` is the RESOLVED slug from step 1 (post-collision-bump; a bumped `<slug>-2` never inherits `<slug>`'s grill):

```bash
"$CLAUDE_PLUGIN_ROOT"/hooks/lib-assert-grill.sh .scratchpad "<slug>"
```

The helper discovers the newest `.grill/<date>-<slug>.md` by slug — grill's own date may be days older than today (multi-day `--resume`, pending-external waits); the gate still finds it. Route on exit code, never on a loose "non-zero":

| exit | meaning                           | action                                                                                                                                                                                                                  |
| ---- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | complete (path printed)           | consume its `## Draft` §G/§C in step 2 — do NOT re-ask; after the step-3 Write lands, stamp via `lib-assert-grill.sh --consume .scratchpad "<slug>" "<date>-<slug>"` (atomic tmp+mv per Vm.8; refuses a double-consume) |
| 1    | no artifact                       | proceed normally — grill is never required; step 2's clarify lever recommends it                                                                                                                                        |
| 2, 3 | artifact incomplete / unconfirmed | REFUSE scaffold; point at `ds:grill <slug> --resume` (or delete the artifact to abandon)                                                                                                                                |
| 4    | artifact already consumed         | proceed normally; recommend a fresh `ds:grill <slug>` — a consumed grill never feeds twice                                                                                                                              |

### 2. Gather inputs (operator-interactive)

Ask, one block at a time (caveman, no preamble):

1. **§G goal** — one-line outcome. Then up to 5 scope bullets (IN / NOT IN).
1. **§C constraints** — locked decisions, stack notes. Bullets, ≤10.
1. **§X repos** — list each repo this dossier touches. Format: `<org>/<name>` or absolute path. Operator-provided. No git-remote magic.
1. **Initial §T tasks** (optional) — operator may provide T1..Tn now or add later via `ds:build`.

**Clarify before freezing (the highest-value lever):** if §G or a §C decision is underspecified — ambiguous scope, an unstated choice, >1 plausible approach — ask the resolving question NOW, before §T is authored. A vague goal yields vague tasks. One or two sharp questions here beats a wrong build. More than a couple of open questions → recommend `ds:grill <slug>` (full interrogation protocol, artifact-gated). If the operator says "just go", record the assumption as a §C bullet so it's auditable.

Do NOT auto-populate §I, §V, §B, §S, §Z. Those grow during build.

### 2.5. Resolve pins (proactive verify)

From the stack named in §C + repos in §X, derive a pin-spec list and resolve current versions once (shared 24h cache, offline-safe):

```bash
python3 "${CLAUDE_PLUGIN_ROOT}"/hooks/resolve_pins.py eol:<slug>... <ecosystem>:<pkg>...
```

- `eol:` results → §C bullets (current stable / EOL note).
- package results → the §I "Pinned deps" table (FORMAT.md §6).
- Map the libs actually named to specs (e.g. "Go backend + React UI" → `eol:go npm:react npm:react-dom go:<module>`). The model maps stack→specs; do not blind-parse.
- `{"offline": true}` / `latest: null` → record the pin as `offline` and proceed. Never blocks scaffold.

These fold into the single atomic step-3 Write — no extra commit, no TDD cycle.

### 2.7. Write the contract

The repo decides the home, not this skill. `.dossier/` exists → the repo opted into tracked contracts: write `.dossier/<date>-<slug>.md` and commit it before the first task — citable as evidence, outlives the wave. Otherwise write `<wave-dir>/CONTRACT.md` beside the ledger and say plainly what that home costs: untracked wherever `.scratchpad/` is gitignored (the assumed setup), archived with the wave, citable by nobody — and its criteria run as shell from a file no diff ever showed a reviewer, where a tracked contract's criteria appear in the commit that added them. Name the opt-in (`mkdir .dossier`, track it) so the choice stays the operator's. Never create `.dossier/` yourself: a tracked directory appearing in a repo that did not ask for one is the artifact rule this split exists to respect.

Either way the content is FORMAT.md's — `consumer`, `reached-via`, `budget`, and a `## done-when` table whose every row is a command with an expected result. `ds:converge` and the `UserPromptSubmit` hook resolve both homes, tracked first.

`consumer` is the field that asks whether the work reaches anyone, and the one nobody writes unprompted. Ask for it plainly: who runs this, and by what path does it get to them? A wave once hardened a checker through three review rounds while no consumer could execute it, and no step in this skill had ever asked. `ds:converge` refuses a contract whose `consumer` row is missing or empty (`CONVERGE: PARSE`, exit 2), so a contract written without the answer fails its first run.

A criterion that cannot be written as a command is a criterion nobody can check. Turn it into one, or drop it and say what was dropped.

In the tracked home, commit before the first task — the `UserPromptSubmit` hook counts budget from the commit that added the contract.

### 3. Scaffold DOSSIER.md

Compute fields:

```
title = <slug>
P-total = max P<N> across the operator-provided initial §T rows (default 1)
header_line = `<date>` · `live` · `P1/<P-total>`
```

Stamp `P1/<P-total>` (not a hardcoded `P1/1`) so a multi-phase seed matches what `lib-regen-index.sh` derives from §T — otherwise INDEX shows `P1/1` while §T spans `P1..P3`, a self-inflicted Vm.5 drift.

Write file at `<dir>/DOSSIER.md` per FORMAT.md §2 section order:

```markdown
# <slug>

`<date>` · `live` · `P1/<P-total>`

## §G — Goal

<goal-from-step-2>

Scope:
<scope-bullets>

## §C — Constraints

<constraint-bullets>

## §I — Interfaces

_(empty — populate when first contract lands)_

## §V — Invariants

| id | invariant | check |
|----|-----------|-------|

## §T — Task ledger

| id | P | state | task | cite | verify |
|----|---|-------|------|------|--------|
<initial-tasks-if-provided>

## §B — Bug ledger

| id | bug | root cause | invariant added | fix cite |
|----|-----|------------|-----------------|----------|

## §X — Cross-repo state

| repo | branch | ahead | tag | pushed | notes |
|------|--------|-------|-----|--------|-------|
<repo-rows-from-step-2-with-placeholders>

## §S — Rolling status log

<!-- Each entry is its own paragraph (blank lines before AND after). Per FORMAT.md §11. -->

<YYYY-MM-DD HH:MM> ds:new — created slug=<slug> phase=P1

## §Z — Closeout

_(empty — written by ds:close)_
```

Atomic write: `<dir>/DOSSIER.md.tmp` then `mv`. Per Vm.8.

### 3.5. Assert scaffold completeness

Before touching INDEX or §S, confirm the write landed intact:

```bash
"$CLAUDE_PLUGIN_ROOT"/hooks/lib-assert-scaffold.sh "<dir>"
```

Exits non-zero naming any missing `§`-section (or the title line) — deterministic, no model eyeballing of the Write output. On failure: do **not** regen INDEX, do **not** append the §S DONE line (step 6). Report the missing sections, re-run the step-3 Write to repair, then re-assert. Mirrors the post-move assertion `ds:close` runs via `lib-archive-move.sh`.

### 4. Initial §X refresh

For each repo row added in step 2: run `git status -sb` + `git rev-list --count <upstream>..HEAD` + `git describe --tags --abbrev=0` in that repo. Populate §X row.

If a repo path doesn't exist or isn't a git tree: leave placeholders, append note `_(repo not found — verify path)_`.

### 5. Regen INDEX

Run `$CLAUDE_PLUGIN_ROOT/hooks/lib-regen-index.sh` to append the new dossier to `.scratchpad/INDEX.md`.

### 6. Append §S DONE

Append as own paragraph (blank line before AND after — per FORMAT.md §11):

```
<YYYY-MM-DD HH:MM> ds:new — DONE slug=<slug> dir=<dir>
```

### 7. Report

Print one-line caveman summary:

```
ds:new <slug> → .scratchpad/dossier/<date>-<slug>/DOSSIER.md
§X: <N> repos seeded
next: ds:build T1 (when ready)
```

## Idempotency

If `<dir>/DOSSIER.md` already exists: refuse. Operator should pick a new slug or open existing via `ds:status`.

If `<dir>` exists but DOSSIER.md missing (rare crash mid-scaffold): proceed to recreate. §S entries from prior partial run preserved if any.

## Cite

- FORMAT.md §2 (section order), §10 (§X format), §11 (§S format), §17 (Vm rules)
- ADAPTERS.md (host-env detection)
