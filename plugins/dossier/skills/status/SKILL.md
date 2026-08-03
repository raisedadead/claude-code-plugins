---
name: status
description: The dossier driver + read-only sit-rep. Default session-open action. Invoke when the user says "ds:status", "ds", "dossier status", "where are we", "sit-rep", "what's next", "check dossier", or session-start before any other ds:* verb.
disallowed-tools: Edit, Write, NotebookEdit
---

# ds:status — the dossier driver (sit-rep)

Read-only on files; mutations route through Bash helpers. The only writes are the INDEX regen (derived, idempotent) and TaskList hydration, which projects §T into the session TaskList while §T stays source of truth.

## Steps

### 0. Detect host env

Per ADAPTERS.md. Cache for the invocation.

### 1. Locate

- `.scratchpad/INDEX.md` — missing → run `lib-regen-index.sh` to build it.
- Enumerate ALL rows with `state=live`. Current dossier = the first (most-recent). `state=paused` rows are listed separately, outside the live set.

No `.scratchpad/dossier/` in cwd → LIGHT sit-rep, the small-work path with no ceremony:

- `git status -sb` + `git log --oneline -${DS_LIGHT_LOG:-5}` for working state (skip git cleanly outside a repo).
- `$DS_HEALTH_CMD` when set: run it and fold its output in (the operator wires a repo/rig health check; unset stays portable).
- One block: `LIGHT (no dossier): <branch> · <ahead/behind> · <N> dirty · last: <subject>`, then suggest `ds:new <slug>` once the work grows into phases.

Exit 0 after the light sit-rep.

### 1a. Consolidation check

Warn (advisory, never blocking) when the tree needs tidying:

- **>1 live dossier** (Vm.12): print a CONSOLIDATE block listing each live slug and its §S-tail age, then suggest picking the current one and **pausing** or **closing** the rest.
- **stale-live** (Vm.13): any live dossier whose last §S entry is older than `${DS_STALE_LIVE_DAYS:-14}` days → suggest pause or `ds:close --abandon`.
- **drift** (Vm.15): an INDEX carrying a `<!-- drift:N slugs:... -->` trailer (any dossier rendered `drift!` — header/location/§Z disagreement, the sealed-zombie class) gets a DRIFT block naming each drift slug and its likely cause, then a route: a `§Z`-closed drift auto-heals on the next SessionStart (session-start runs `lib-reconcile-state.sh`); anything else is operator-resolved — finish the close (`ds:close --resume`) or correct the header through `lib-header-state.sh`, which is the supported writer (`marker_guard.py` exits 2 on a non-canonical token written any other way). Run `hooks/lib-ds-check.sh .scratchpad` for the deterministic list.

ds:status suggests; the operator — or the model on explicit request — performs one of the actions below.

**Pause / resume / abandon (operator actions, atomic):**

| Action           | Mechanism                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| pause `<slug>`   | `lib-header-state.sh <dir> paused` + `lib-s-append.sh <dir> "ds:pause — paused reason=<r>"` + regen INDEX                                            |
| resume `<slug>`  | `lib-header-state.sh <dir> live` + `lib-s-append.sh <dir> "ds:resume — resumed"` + regen INDEX, then re-run step 3 so any mid-build START resurfaces |
| abandon `<slug>` | `ds:close --abandon "<reason>"`                                                                                                                      |

Pause and resume each write ONE atomic §S line (no START/DONE pairing — FORMAT.md §16). Pausing works mid-build and leaves §T alone.

### 2. Read

Parse from DOSSIER.md:

- §S — tail 30 lines.
- §T — full table.
- §X — full table.
- §B — count + open rows (no `fix cite`).

### 2a. Hydrate TaskList (§T → TaskList projection)

§T is source of truth; the Claude Code TaskList is a derived steering surface the operator watches. Idempotent — safe every invocation.

1. `TaskList` first. Parse the leading `T<id>` token of each existing task's subject (the join key).
1. Each §T row in `{., ~}` whose `T<id>` is absent: `TaskCreate` subject=`"<T-id> <task>"`, description = task + `verify` cell, activeForm derived from the task.
1. `TaskUpdate` each to its glyph: `.`→pending, `~`→in_progress. Already-`x` rows stay out — no steering value, pure clutter.
1. **`!` and `?` rows stay out too** — TaskList has no "blocked-on-human" status. They surface as BLOCKERS in the report, where the autonomous loop leaves them alone.
1. Dependencies: derive `blockedBy` from phase order (every `P<k+1>` task blocked by the last `P<k>` task). §T keeps its existing columns — `lib-row-flip.sh` is positional awk, so a new `dep` column would break it.

**The reverse direction is advisory:** a TaskList task marked `completed` whose §T row is not `x` gets a WARN (`run ds:build <T-id> --resume to finalize cite+flip`). The flip itself belongs to `ds:build`, which produces the commit cite Vm.3 requires.

### 3. Detect incomplete ops (resume hint)

Scan §S for `START` lines with no matching `DONE` for the same `<target>`. Each is an incomplete op. For each:

- Identify the last step from §S (last line with a matching target).
- Map step → next action via FORMAT.md §16 resume protocol.
- Suggest the exact command: `ds:build T<N> --resume` / `ds:backprop B<N> --resume` / etc.

### 4. Detect stale §X (optional warning)

For each §X row run `git status -sb` + `git rev-list --count` and compare against the recorded values. A difference flags `§X stale (refresh via ds:build or ds:check)`. Refreshing is a write op and belongs to those verbs.

### 5. Cavemem augmentation (optional)

`mcp__cavemem__timeline` available → query observations tagged with the current dossier slug over the last 14 days, surface the top 3 as a `## Recent (cavemem)` block. Absent → skip silently.

### 6. Report (decision-first)

Lead with the ONE decision. Full §T/§X tables on `--full`.

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

`--full` adds the complete §T + §X tables and the §S tail — the deep-inspection dump.

### 7. No mutations

The skill writes exactly two things:

- INDEX regen (atomic, derived)
- Stale-lock cleanup (the session-start hook already does this; re-running is safe)

No §S append. This is a read-only verb.

### 8. `--recover` mode

`ds:status --recover` reconstructs context after a crash, compaction, or handoff. Try sources IN ORDER and name which fired:

1. **cavemem** — when `mcp__cavemem__search` / `mcp__cavemem__timeline` is available, query recent observations for the cwd project / current slug (last `${DS_RECOVER_DAYS:-3}` days). Header `## Recovered (cavemem)`.
1. **transcripts (fallback)** — cavemem absent or empty: grep `~/.claude/projects/<project>/*.jsonl` for the most recent non-sidechain user turns plus the last assistant summary. Header `## Recovered (transcripts — cavemem unavailable)`.
1. Fold the normal sit-rep (steps 1–6) underneath.

Always end with `recovery source: cavemem | transcripts | none`. Worst case is `none`.

## Exit codes

- 0 always (read-only, no failure modes).

## Cite

- FORMAT.md §13 (INDEX format), §16 (resume protocol)
- ADAPTERS.md §cavemem
