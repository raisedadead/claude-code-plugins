---
name: dossier-status
description: The dossier driver + read-only sit-rep. Default session-open action. Invoke when the user says "ds:status", "ds", "dossier status", "where are we", "sit-rep", "what's next", "check dossier", or session-start before any other ds:* verb.
---
## Pi runtime

Resolve bundled paths against this file, not the project working directory. The plugin root is `../..` from this file's directory. Before each shell call that uses `$DOSSIER_PLUGIN_ROOT`, set that variable to the shell-quoted absolute plugin root in that same shell. Pi does not supply it. Keep the shell working directory in the consuming project.

Load another installed skill with `read` on its advertised SKILL.md path; user commands use `/skill:<name>`. Check the available skills and tools before an optional sibling route. An absent sibling means skip, never install or scan caches. Pi does not add plugin bin directories to PATH: resolve bundled tools by absolute path. For dossier-to-whetstone script routes, check `../whetstone/bin/<tool>` relative to dossier's plugin root; if absent, use the documented absent-skip result.

Use `read/edit/write/bash/grep/find` for the corresponding host operations. Fresh missions use `dossier_delegate` or `whetstone_delegate` for that plugin's named agents, with unqualified `agent` and artifact-only `task`. The tool uses the current model unless the operator supplies an exact `provider/model`. Builders use `agent: general-purpose, write: true`; named reviewers cannot use edit/write. Bash read-only is prompt-only, not a sandbox. A return is final: a follow-up mission is a fresh call, not a message to a retained agent. Parallel independent missions may use concurrent calls.

Web tools and advisor tools are optional. Use installed web tools when present, or read-only `curl`/`gh api` through bash; identify any inaccessible source. The Pi extension supplies mutation guards and model-facing advisories. The task ledger is authoritative; `/dossier-tasks` is a read-only view, not a second task store.


# ds:status — the dossier driver (sit-rep)

Read-only on files; mutations route through Bash helpers. The sit-rep writes only the INDEX regen; pause and resume (step 1a) write the ledger on request. Step 6 lists both.

## Steps

### 1. Locate

- `<root>/.scratchpad/INDEX.md`, where `<root>` is the path `ds root` prints — missing → run `ds regen-index` to build it.
- Enumerate ALL rows with `state=live`. Current dossier = the first (most-recent). `state=paused` rows are listed separately, outside the live set.
- The paused set reaches the report as its own `PAUSED` line in step 5, printed on every full sit-rep — `(none)` when the set is empty. The LIGHT path exits at step 1 and never reaches it, which is correct: LIGHT runs where there is no `.scratchpad/dossier/` to hold a paused wave. A paused wave that no line names is a wave nobody decides about.

No `.scratchpad/dossier/` in cwd → LIGHT sit-rep, the small-work path with no ceremony:

- `git status -sb` + `git log --oneline -${DS_LIGHT_LOG:-5}` for working state (skip git cleanly outside a repo).
- `$DS_HEALTH_CMD` when set: run it and fold its output in (the operator wires a repo/rig health check; unset stays portable).
- One block: `LIGHT (no dossier): <branch> · <ahead/behind> · <N> dirty · last: <subject>`, then suggest `ds:new "<goal>"` when the work meets the start rule: it spans more than one session, touches more than 5 files, or needs an operator step.

Exit 0 after the light sit-rep.

### 1a. Consolidation check

Warn (advisory, never blocking) when the tree needs tidying:

- **>1 live dossier** (Vm.12): print a CONSOLIDATE block listing each live slug and its §S-tail age, then suggest picking the current one and **pausing** or **closing** the rest.
- **stale-live** (Vm.13): any live dossier whose last §S entry is older than `${DS_STALE_LIVE_DAYS:-14}` days → suggest pause or `ds:close --abandon`.
- **drift** (Vm.15): an INDEX carrying a `<!-- drift:N slugs:... -->` trailer (any dossier rendered `drift!` — header/location/§Z disagreement, the sealed-zombie class) gets a DRIFT block naming each drift slug and its likely cause, then a route: a `§Z`-closed drift auto-heals on the next SessionStart (session-start runs `ds reconcile`); anything else is operator-resolved — finish the close (rerun `ds close <wave>`) or correct the header through `ds header-state`, which is the supported writer (the dossier mod's header guard denies a non-canonical token written any other way). Run `cli/ds ds-check .scratchpad` for the deterministic list.

ds:status suggests; the operator — or the model on explicit request — performs one of the actions below.

**Pause / resume / abandon (operator actions, atomic):**

| Action           | Mechanism                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| pause `<slug>`   | `ds header-state <dir> paused` + `ds s-append <dir> "ds:pause — paused reason=<r>"` + regen INDEX                                            |
| resume `<slug>`  | `ds header-state <dir> live` + `ds s-append <dir> "ds:resume — resumed"` + regen INDEX, then re-run step 3 so any mid-build START resurfaces |
| abandon `<slug>` | `ds:close --abandon "<reason>"`                                                                                                              |

Pause and resume each write ONE atomic §S line (no START/DONE pairing — "$DOSSIER_PLUGIN_ROOT"/FORMAT.md §16). Pausing works mid-build and leaves §T alone.

### 2. Read

Parse from DOSSIER.md:

- §S — tail 30 lines.
- §T — full table.
- §X — full table.
- §B — count + open rows (no `fix cite`).

### 2a. Native task view

The Pi extension reads §T for the status widget and `/dossier-tasks`. It writes no task mirror. Keep `who=H`, `!` and `?` rows for the operator.

### 3. Detect incomplete ops (resume hint)

Scan §S for `START` lines with no matching `DONE` for the same `<target>`. Each is an incomplete op. For each:

- Identify the last step from §S (last line with a matching target).
- Map step → next action via FORMAT.md §16 resume protocol.
- Suggest the exact command: `ds:build T<N> --resume` / `ds:backprop B<N> --resume` / etc.

### 4. Detect stale §X (optional warning)

For each §X row run `git status -sb` + `git rev-list --count` and compare against the recorded values. A difference flags `§X stale (refresh via ds:build or ds:check)`. Refreshing is a write op and belongs to those verbs.

### 5. Report (decision-first)

Lead with the progress line, then the ONE decision. Run `"$DOSSIER_PLUGIN_ROOT"/cli/ds progress <dir> --line` and `"$DOSSIER_PLUGIN_ROOT"/cli/ds ds-check .scratchpad`, and print their lines as they come. A bracketed line prints only when its condition holds.

```
<slug> 47% · 9/19 · next T3                    # ds progress --line, verbatim
DECISION: <the one thing the operator must decide, or "NONE → proceeding">
  └ <why a human is needed / what unblocks if NONE>
[BLOCKED: T5 rolling-restart — needs ops review]       # state=!/? rows
JUST DID: <last 1–2 §S cite-bearing entries>
NEXT: ds:build --auto                                   # or ds:build <T-id>; "ready to close" → ds close <slug> <mode> --plan
[⚠ §X stale <Nm> → confirm before flip]                 # step 4
[DRIFT: <advisory line>]                                # each ds ds-check advisory
[LATER: <later: line>, <due: lines>]                    # carried-work lines of `ds progress` with no dir; `ds later` lists them
[CONSOLIDATE: <N> live — pause/close the stale ones]    # >1 live (step 1a)
PAUSED (<N>): <slug> · <T done/tot> · idle <Nd>         # every state=paused row (step 1); "(none)" when empty
[⚠ resume: ds:build T<N> --resume]                      # incomplete op (step 3)
[Locks: <slug>: <skill> pid <pid> since <time>]
```

`--full` adds the `ds progress <dir>` table, the complete §T + §X tables and the §S tail.

### 6. What writes, and when

The **sit-rep path — steps 1 through 5, which is every plain `/skill:dossier-status`** — writes exactly two things, both derived and idempotent:

- INDEX regen (atomic, derived)
- Stale-lock cleanup (the session-start hook already does this; re-running is safe)

It appends no §S. Reading the ledger should not leave a mark on it.

The **pause / resume actions in step 1a are outside that path** and are not read-only. Each runs only on an explicit operator request, and each mutates the ledger: `ds s-append` appends one §S line, `ds header-state` rewrites the header state token in place (`` `live` `` → `` `paused` ``). Invoking one turns that invocation into a write; the sit-rep by itself never becomes one.

### 7. `--recover` mode

`ds:status --recover` reconstructs context after a crash, compaction, or handoff. Try sources IN ORDER and name which fired:

1. **transcripts** — use the current conversation or a session export/path supplied by the operator. Ask for that path when older context is needed; do not assume a home-directory layout. Header `## Recovered (transcripts)`.
1. Fold the normal sit-rep (steps 1–5) underneath.

Always end with `recovery source: transcripts | none`. Worst case is `none`.

## Exit codes

- 0 for the sit-rep path — a missing INDEX, repo or §X row is reported, not raised.
- A step-1a pause/resume helper can exit non-zero on its own: `ds header-state` and `ds s-append` each print `ds <verb>: not found: <path>/DOSSIER.md` and exit 1 against a directory holding no ledger. Surface that instead of reporting the sit-rep clean.

## Cite

- FORMAT.md §13 (INDEX format), §16 (resume protocol)
