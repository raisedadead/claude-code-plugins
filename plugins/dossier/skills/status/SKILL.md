---
name: status
description: Read-only dossier dashboard. Default session-open action. Shows INDEX head, live dossier §S tail, §T progress, §X cross-repo state, plus any incomplete ops flagged for resume. Invoke when the user says "ds:status", "dossier status", "what's the dossier state", "where are we", "check dossier", or session-start before any other ds:* verb.
---

# ds:status — read-only dashboard

Read-only. Writes nothing except INDEX regen (derived, idempotent).

## Steps

### 0. Detect host env

Per ADAPTERS.md. Cache for invocation.

### 1. Locate

- `.scratchpad/INDEX.md` — if missing, run `lib-regen-index.sh` to build.
- Enumerate ALL rows with `state=live`. Current dossier = the first (most-recent). Rows with `state=paused` are NOT live — list them separately, never as the current.

If no `.scratchpad/dossier/` exists in cwd: report "no dossier tree in this repo. ds:new to start." Exit.

### 1a. Consolidation check

Warn (never block) when the tree needs tidying:

- **>1 live dossier** (Vm.12): print a CONSOLIDATE block listing each live slug + its §S-tail age, then suggest picking the current one and **pausing** or **closing** the rest.
- **stale-live** (Vm.13): any live dossier whose last §S entry is older than `${DS_STALE_LIVE_DAYS:-14}` days → suggest pause or `ds:close --abandon`.

ds:status only SUGGESTS — it never flips state itself. The operator (or the model on explicit request) performs an action below.

**Pause / resume / abandon (operator actions, atomic):**

| Action           | Mechanism                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| pause `<slug>`   | `lib-header-state.sh <dir> paused` + `lib-s-append.sh <dir> "ds:pause — paused reason=<r>"` + regen INDEX                                            |
| resume `<slug>`  | `lib-header-state.sh <dir> live` + `lib-s-append.sh <dir> "ds:resume — resumed"` + regen INDEX, then re-run step 3 so any mid-build START resurfaces |
| abandon `<slug>` | `ds:close --abandon "<reason>"`                                                                                                                      |

Pause/resume each write ONE atomic §S line (no START/DONE pairing — FORMAT.md §16). Pausing is allowed mid-build; it does not touch §T.

### 2. Read

Parse from DOSSIER.md:

- §S — tail 30 lines.
- §T — full table.
- §X — full table.
- §B — count + open rows (no `fix cite`).

### 3. Detect incomplete ops (resume hint)

Scan §S for `START` lines without matching `DONE` for same `<target>`. Each = incomplete op.

For each incomplete:

- Identify last step from §S (last line w/ matching target).
- Map step → next action via FORMAT.md §16 resume protocol.
- Suggest exact command: `ds:build T<N> --resume` / `ds:backprop B<N> --resume` / etc.

### 4. Detect stale §X (optional warning)

For each §X row: run `git status -sb` + `git rev-list --count`. Compare against current §X values.

If diff: flag as `§X stale (refresh via ds:build or ds:check)`. Do NOT auto-refresh — that's a write op.

### 5. Cavemem augmentation (optional)

If `mcp__cavemem__timeline` available: query for observations tagged with current dossier slug in last 14 days. Surface top 3 as `## Recent (cavemem)` block. Skip silently if absent.

### 6. Report

Print:

```
INDEX: <live-count> live, <done-count> archived (regen <mtime>)

Live: <date>-<slug> (P<cur>/<total>, T <done>/<total>, B <count>, §Z <state>)

§S tail (last <N>):
  <lines>

§T:
  <table>

§X:
  <table>

[⚠ Incomplete: <op>]
  → <resume-command>

[⚠ §X stale: <repo> ahead=<actual>, dossier says <stored>]
  → refresh via ds:build or ds:check

Locks: <none | <slug>: <skill> pid <pid> since <time>>
```

### 7. No mutations

Skill writes nothing except:

- INDEX regen (atomic, derived)
- Stale-lock cleanup (already handled by session-start hook; safe to re-run)

No §S append on `ds:status`. Read-only verb.

## Exit codes

- 0 always (read-only, no failure modes).

## Cite

- FORMAT.md §13 (INDEX format), §16 (resume protocol)
- ADAPTERS.md §cavemem
