---
name: new
description: Start a dossier wave from a goal sentence; the sole entrypoint. Invoke when the user says "ds:new" or "start a dossier", or when work meets the start rule — more than one session, more than 5 files, or an operator step.
argument-hint: "<goal sentence>" | <slug>
---

# ds:new — start a wave

Creates `.scratchpad/dossier/<YYYY-MM-DD>-<slug>/DOSSIER.md` per `${CLAUDE_PLUGIN_ROOT}/FORMAT.md`, then asks the operator for goal, scope and repos.

## Inputs

- `"<goal sentence>"` from `$ARGUMENTS` — the normal start. Run `ds:grill "<goal sentence>"` first, then come back with the slug it confirms; step 1.5 consumes its draft. Skip the grill only when the goal is one line with no open decision, and derive the slug from it.
- `<slug>` (kebab-case, ≤30 chars) — the start after a grill, or for a backfill. Empty → ask for the goal sentence.
- Date defaults to today (`date +%Y-%m-%d`). Override by prompt when backfilling historical work.

## Steps

### 0. Helpers

The §S DONE line (step 6) appends via `"${CLAUDE_PLUGIN_ROOT}"/cli/ds s-append <dir> "<event>"` (FORMAT.md §15) — pass the text **after** the timestamp, which the script prepends. The initial scaffold is a full Write (new file).

### 1. Validate slug + path

- Slug matches `^[a-z0-9][a-z0-9-]{0,29}$`. Anything else is refused with an explanation.
- Compute `dir=.scratchpad/dossier/<date>-<slug>/`.
- Collision check: `dir` exists **or `.scratchpad/dossier/_archive/<date>-<slug>/` exists** (a same-day close+reopen) → ask the operator to bump to `<slug>-2`, `<slug>-3`, etc. Checking `_archive/` too avoids two INDEX rows keyed to one slug (Vm.1).
- Ignore check: in a git work tree, `git check-ignore -q .scratchpad/` exiting 1 means the ledger will show as untracked and a `git add -A` would commit it. Carry that into the step-7 report with the per-clone fix, `echo .scratchpad/ >> .git/info/exclude`, and leave the choice to the operator — some repos track `.scratchpad/` on purpose.

### 1.5. Grill gate (conditional)

Fires only when a grill artifact exists for this slug, so trivial `ds:new` runs are untouched. `<slug>` is the RESOLVED slug from step 1 (post-collision-bump; a bumped `<slug>-2` starts without `<slug>`'s grill):

```bash
"${CLAUDE_PLUGIN_ROOT}"/cli/ds assert-grill .scratchpad "<slug>"
```

The helper discovers the newest `.grill/<date>-<slug>.md` by slug — grill's own date may be days older than today (multi-day `--resume`, pending-external waits) and the gate still finds it. Route on the exact exit code:

| exit   | meaning                                                          | action                                                                                                                                                                                                              |
| ------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | complete (path printed)                                          | consume its `## Draft` §G/§C in step 2 — do NOT re-ask; after the step-3 Write lands, stamp via `ds assert-grill --consume .scratchpad "<slug>" "<date>-<slug>"` (atomic tmp+mv per Vm.8; refuses a double-consume) |
| 1      | no artifact                                                      | proceed normally — grill is never required; step 2's clarify lever recommends it                                                                                                                                    |
| 2, 3   | artifact incomplete / unconfirmed                                | REFUSE scaffold; point at `ds:grill --resume <slug>` (or delete the artifact to abandon)                                                                                                                            |
| 4      | artifact already consumed                                        | proceed normally; recommend a fresh `ds:grill "<goal sentence>"` — a consumed grill never feeds twice                                                                                                                          |
| 69, 70 | `cli/ds` did not run (69: no Node.js 22.18+; 70: internal error) | REFUSE scaffold; report the stderr line                                                                                                                                                                             |

### 2. Gather inputs (operator-interactive)

Ask one block at a time, tersely, no preamble:

1. **§G goal** — one-line outcome, then up to 5 scope bullets (IN / NOT IN).
1. **§C constraints** — locked decisions, stack notes. Bullets, ≤10.
1. **§X repos** — each repo this dossier touches, as `<org>/<name>` or an absolute path. Operator-provided; no git-remote magic.
1. **Initial §T tasks** (optional) — T1..Tn now, or later via `ds:build`.

**Clarify before freezing (the highest-value lever):** an underspecified §G or §C decision — ambiguous scope, an unstated choice, more than one plausible approach — gets its resolving question NOW, before §T is authored. A vague goal yields vague tasks, and one or two sharp questions here beat a wrong build. More than a couple of open questions → recommend `ds:grill <slug>` (full interrogation protocol, artifact-gated). "Just go" → record the assumption as a §C bullet so it stays auditable.

§I, §V, §B, §S and §Z grow during the build; the scaffold leaves them empty.

### 2.5. Resolve pins (proactive verify)

From the stack named in §C plus the repos in §X, derive a pin-spec list and resolve current versions once (shared 24h cache, offline-safe):

```bash
"${CLAUDE_PLUGIN_ROOT}"/cli/ds resolve-pins eol:<slug>... <ecosystem>:<pkg>...
```

- `eol:` results → §C bullets (current stable / EOL note).
- package results → the §I "Pinned deps" table (FORMAT.md §6).
- Map the libs actually named to specs (e.g. "Go backend + React UI" → `eol:go npm:react npm:react-dom go:<module>`). The model does the stack→spec mapping; do not blind-parse §C prose into specs.
- `{"offline": true}` / `latest: null`, or exit 69 (no Node.js 22.18+) / 70 (internal error) → record the pin as `offline` and proceed; the scaffold continues either way.
- `go:<module>` without a `/vN` suffix names the v0/v1 path, so the resolver walks `/v2` through `/v12` and answers from the highest that resolves — pin the module path in `src`, not the one you asked for. A `warning` on the object means a probe went unanswered: the version is a floor, not the ceiling.

These fold into the single atomic step-3 Write — no extra commit, no TDD cycle.

### 2.7. Write the contract

The repo decides the home. `.dossier/` exists → the repo opted into tracked contracts: write `.dossier/<date>-<slug>.md` and commit it before the first task — citable as evidence, outliving the wave. Otherwise write `<wave-dir>/CONTRACT.md` beside the ledger and price that home out loud: untracked wherever `.scratchpad/` is gitignored (the assumed setup), archived with the wave, citable by nobody, and its criteria run as shell from a file no diff ever showed a reviewer — where a tracked contract's criteria appear in the commit that added them. Name the opt-in (`mkdir .dossier`, track it) so the choice stays the operator's. **Never create `.dossier/` yourself** — a tracked directory appearing in a repo that did not ask for one is the artifact rule this split exists to respect.

Either way the content is FORMAT.md §2.5's — `consumer`, `reached-via`, `budget`, an optional `milestone` (the cutover row, when rows run after it), and a `## done-when` table whose every row is a command with an expected result. `ds:converge` and the `UserPromptSubmit` hook resolve both homes, tracked first.

`consumer` is the field that asks whether the work reaches anyone, and the one nobody writes unprompted. Ask for it plainly: who runs this, and by what path does it get to them? A wave once hardened a checker through three review rounds while no consumer could execute it, and no step in this skill had ever asked. `ds:converge` refuses a contract whose `consumer` row is missing or empty (`CONVERGE: PARSE`, exit 2), so a contract written without the answer fails its first run.

A criterion that cannot be written as a command is a criterion nobody can check. Turn it into one, or drop it and say what was dropped.

In the tracked home, commit before the first task — the `UserPromptSubmit` hook counts budget from the commit that added the contract.

### 3. Scaffold DOSSIER.md

Compute fields:

```
title = <slug>
header_line = `<date>` · `live`
```

Write the file at `<dir>/DOSSIER.md` per FORMAT.md §2 section order:

```markdown
# <slug>

`<date>` · `live`

## Goal

<goal-from-step-2>

Scope:
<scope-bullets>

## Constraints

<constraint-bullets>

## Interfaces

_(empty — populate when first contract lands)_

## Invariants

| id | invariant | check |
|----|-----------|-------|

## Tasks

| id | state | who | task | needs | cite | verify |
|----|-------|-----|------|-------|------|--------|
<initial-tasks-if-provided>

## Bugs

| id | bug | root cause | invariant added | fix cite |
|----|-----|------------|-----------------|----------|

## Repos

| repo | branch | ahead | tag | pushed | notes |
|------|--------|-------|-----|--------|-------|
<repo-rows-from-step-2-with-placeholders>

## Status

<!-- Each entry is its own paragraph (blank lines before AND after). Per FORMAT.md §11. -->

<YYYY-MM-DD HH:MM> ds:new — created slug=<slug>

## Closeout

_(empty — written by ds:close)_
```

Write `<dir>/DOSSIER.md` directly: the file is new, and step 3.5 catches a partial write.

### 3.5. Assert scaffold completeness

Before touching INDEX or §S, confirm the write landed intact:

```bash
"${CLAUDE_PLUGIN_ROOT}"/cli/ds assert-scaffold "<dir>"
```

It exits 1 naming any missing `§`-section (or the title line) — deterministic, so nobody eyeballs the Write output. On failure the INDEX regen and the §S DONE line (step 6) both wait: report the missing sections, re-run the step-3 Write to repair, then re-assert. Mirrors the post-move assertion `ds:close` runs via `ds archive-move`. Exit 69 (no Node.js 22.18+) or 70 (internal error) means the assertion did not run: report its stderr line and stop before step 6.

### 4. Initial §X refresh

For each repo row added in step 2, run `git status -sb`, `git rev-list --count <upstream>..HEAD` and `git describe --tags --abbrev=0` in that repo, then populate the §X row.

A path that is missing or is not a git tree keeps placeholders plus the note `_(repo not found — verify path)_`.

### 5. Regen INDEX

Run `"${CLAUDE_PLUGIN_ROOT}"/cli/ds regen-index` to append the new dossier to `.scratchpad/INDEX.md`.

### 6. Append §S DONE

Append as its own paragraph (blank line before AND after — per FORMAT.md §11):

```
<YYYY-MM-DD HH:MM> ds:new — DONE slug=<slug> dir=<dir>
```

### 7. Report

One-line summary:

```
ds:new <slug> → .scratchpad/dossier/<date>-<slug>/DOSSIER.md
§X: <N> repos seeded
next: ds:build T1 (when ready)
```

Add `.scratchpad/ is not gitignored here` plus the fix when step 1's ignore check fired.

## Idempotency

`<dir>/DOSSIER.md` already exists → refuse; the operator picks a new slug or opens the existing one via `ds:status`.

`<dir>` exists with DOSSIER.md missing (a rare crash mid-scaffold) → recreate it, preserving any §S entries from the partial run.

## Cite

- FORMAT.md §2 (section order), §2.5 (wave contract), §10 (§X format), §11 (§S format), §17 (Vm rules)
