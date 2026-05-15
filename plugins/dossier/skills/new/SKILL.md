---
name: new
description: Scaffold a new dossier. Creates .scratchpad/dossier/<YYYY-MM-DD>-<slug>/DOSSIER.md with §G..§Z stubs, prompts operator for goal, scope, repos. Sole entrypoint for starting a new phase wave. Invoke when the user says "new dossier", "start dossier", "open dossier", "ds:new", or "scaffold dossier <slug>".
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
- check tool namespace for `mcp__context-mode__*`, `mcp__cavemem__*`, `mcp__fastedit__*`
- check available skills for `caveman:*`, `ck:*`

See `plugins/dossier/ADAPTERS.md` for routing rules. Never error if absent.

### 1. Validate slug + path

- Slug must match `^[a-z0-9][a-z0-9-]{0,29}$`. Refuse otherwise w/ explanation.
- Compute `dir=.scratchpad/dossier/<date>-<slug>/`.
- Collision check: if `dir` exists, ask operator to bump to `<slug>-2`, `<slug>-3`, etc.

### 2. Gather inputs (operator-interactive)

Ask, one block at a time (caveman, no preamble):

1. **§G goal** — one-line outcome. Then up to 5 scope bullets (IN / NOT IN).
1. **§C constraints** — locked decisions, stack notes. Bullets, ≤10.
1. **§X repos** — list each repo this dossier touches. Format: `<org>/<name>` or absolute path. Operator-provided. No git-remote magic.
1. **Initial §T tasks** (optional) — operator may provide T1..Tn now or add later via `ds:build`.

Do NOT auto-populate §I, §V, §B, §S, §Z. Those grow during build.

### 3. Scaffold DOSSIER.md

Compute fields:

```
title = <slug>
header_line = `<date>` · `live` · `P1/1`
```

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
