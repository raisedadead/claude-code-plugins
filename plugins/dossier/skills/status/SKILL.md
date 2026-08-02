---
name: status
description: The dossier driver + read-only sit-rep. Default session-open action. Invoke when the user says "ds:status", "ds", "dossier status", "where are we", "sit-rep", "what's next", "check dossier", or session-start before any other ds:* verb.
disallowed-tools: Edit, Write, NotebookEdit
---

# ds:status — the dossier driver (sit-rep)

Read-only on files — mutations route through Bash helpers. Writes nothing except INDEX regen (derived, idempotent) + TaskList hydration (projects §T into the session TaskList; §T stays source of truth).

## Steps

### 0. Detect host env

Per ADAPTERS.md. Cache for invocation.

### 1. Locate

- `.scratchpad/INDEX.md` — if missing, run `lib-regen-index.sh` to build.
- Enumerate ALL rows with `state=live`. Current dossier = the first (most-recent). Rows with `state=paused` are NOT live — list them separately, never as the current.

If no `.scratchpad/dossier/` exists in cwd: no dossier here — fall through to a LIGHT sit-rep (the small-work path, no ceremony) instead of bailing:

- `git status -sb` + `git log --oneline -${DS_LIGHT_LOG:-5}` for working state (skip git cleanly when not in a repo).
- If `$DS_HEALTH_CMD` is set, run it and fold its output in (operator wires a repo/rig health check; unset = skipped, stays portable).
- Report one block: `LIGHT (no dossier): <branch> · <ahead/behind> · <N> dirty · last: <subject>`, then suggest `ds:new <slug>` once the work grows into phases.

Exit 0 after the light sit-rep.

### 1a. Consolidation check

Warn (never block) when the tree needs tidying:

- **>1 live dossier** (Vm.12): print a CONSOLIDATE block listing each live slug + its §S-tail age, then suggest picking the current one and **pausing** or **closing** the rest.
- **stale-live** (Vm.13): any live dossier whose last §S entry is older than `${DS_STALE_LIVE_DAYS:-14}` days → suggest pause or `ds:close --abandon`.
- **drift** (Vm.15): if the INDEX carries a `<!-- drift:N slugs:... -->` trailer (any dossier rendered `drift!` — header/location/§Z disagreement, the sealed-zombie class), print a DRIFT block naming each drift slug and its likely cause, then route it: a `§Z`-closed drift auto-heals on the next SessionStart (session-start runs `lib-reconcile-state.sh`); anything else is operator-resolved — finish the close (`ds:close --resume`) or correct the header via `lib-header-state.sh` (never a raw Edit — `marker_guard.py` blocks a non-canonical token at exit 2). Run `hooks/lib-ds-check.sh .scratchpad` for the deterministic list.

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

### 2a. Hydrate TaskList (§T → TaskList projection)

§T is source of truth; the Claude Code TaskList is a derived steering surface the operator watches. Idempotent — safe every invocation.

1. `TaskList` first. Parse the leading `T<id>` token of each existing task's subject (the join key).
1. For each §T row in `{., ~}` whose `T<id>` is NOT already present: `TaskCreate` subject=`"<T-id> <task>"`, description = task + `verify` cell, activeForm derived from the task.
1. `TaskUpdate` each to its glyph: `.`→pending, `~`→in_progress. Skip already-`x` rows (no steering value; clutter).
1. **Exclude `!` and `?` rows** — TaskList has no "blocked-on-human" status. Surface them as BLOCKERS in the report (the autonomous loop must not pick them up).
1. Dependencies: derive `blockedBy` from phase order (every `P<k+1>` task blocked by the last `P<k>` task). Do NOT add a `dep` column to §T (breaks `lib-row-flip.sh` positional awk).

**Reverse direction is advisory only:** if a TaskList task is `completed` but its §T row is not `x`, WARN (`run ds:build <T-id> --resume to finalize cite+flip`) — never auto-flip §T (Vm.3 requires a commit cite, which only `ds:build` produces).

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

### 6. Report (decision-first)

Lead with the ONE decision. Full §T/§X tables only on `--full`.

```
DECISION: <the one thing the operator must decide, or "NONE → proceeding">
  └ <why a human is needed / what unblocks if NONE>
BLOCKERS (§T !/?):
  T5 rolling-restart — needs ops review        # state=!/? rows; verify/task cell = the "why"
  (none) if empty
JUST DID: <last 1–2 §S cite-bearing entries>
NOW: <slug> P<cur>/<tot> · T <done>/<tot> · TaskList <active>/<blocked>
NEXT (auto): ds:build --auto   (or a specific ds:build <T-id>, or "BLOCKED → decision above")
  ⚠ §X stale <Nm> → confirm before flip          # only if flagged (step 4)
[CONSOLIDATE: <N> live — pause/close the stale ones]   # only if >1 live (step 1a)
[⚠ resume: ds:build T<N> --resume]                     # only if incomplete op (step 3)
Locks: <none | <slug>: <skill> pid <pid> since <time>>

[--full for §T / §X tables]
```

On `--full`: also print the complete §T + §X tables + the §S tail (the deep-inspection dump). Default omits them.

### 7. No mutations

Skill writes nothing except:

- INDEX regen (atomic, derived)
- Stale-lock cleanup (already handled by session-start hook; safe to re-run)

No §S append on `ds:status`. Read-only verb.

### 8. `--recover` mode

`ds:status --recover` reconstructs context after a crash, compaction, or handoff. Try sources IN ORDER and ALWAYS name which fired:

1. **cavemem** — if `mcp__cavemem__search` / `mcp__cavemem__timeline` is available, query recent observations for the cwd project / current slug (last `${DS_RECOVER_DAYS:-3}` days). Header `## Recovered (cavemem)`.
1. **transcripts (fallback)** — cavemem absent or empty: grep `~/.claude/projects/<project>/*.jsonl` for the most recent non-sidechain user turns + last assistant summary. Header `## Recovered (transcripts — cavemem unavailable)`.
1. Fold the normal sit-rep (steps 1–6) underneath.

Always end with `recovery source: cavemem | transcripts | none`. Never fails — worst case reports `none`.

## Exit codes

- 0 always (read-only, no failure modes).

## Cite

- FORMAT.md §13 (INDEX format), §16 (resume protocol)
- ADAPTERS.md §cavemem
