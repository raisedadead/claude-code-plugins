---
name: build
description: Execute a §T task with TDD covenant. Claims row (. → ~), runs tests/edits, commits, refreshes §X, flips row to x with commit cite. Resumable on crash via §S step-log. Invoke when the user says "ds:build T<N>", "build next task", "ds:build --next", "implement T<N>", or "work on <task-description>".
argument-hint: <T-id> | --next | --auto | --resume
---

# ds:build — execute a §T task

TDD covenant: RED → GREEN → refactor. One commit per `x`-flip. Resumable.

## Inputs

- `<T-id>` (e.g. `T3`): explicit target.
- `--next`: pick first `state=.` row in §T.
- `--auto`: autonomous mode — loop over actionable §T rows to completion, pausing only on a real decision. See **Autonomous mode** below. Best driven by native `/goal`.
- `--resume`: re-enter incomplete op for the same target (auto-detected from §S; flag is explicit override).

## Steps

### 0. Detect host env

Per ADAPTERS.md. Note `HAS_RTK`, `HAS_FASTEDIT`.

DOSSIER.md writes use the bundled helpers (FORMAT.md §15): `$CLAUDE_PLUGIN_ROOT/hooks/lib-row-flip.sh <dir> <id> <state> [cite]` for §T flips, `$CLAUDE_PLUGIN_ROOT/hooks/lib-s-append.sh <dir> "<event>"` for §S appends. Always present, no detection. The §S code-fence examples below show the full line — pass only the text **after** the timestamp (`lib-s-append.sh` prepends it). `HAS_FASTEDIT` governs SOURCE code edits in step 6 only, never DOSSIER.md.

### 1. Locate live dossier

Per `ds:status` step 1. If none: refuse w/ "no live dossier. ds:new first."

### 2. Resolve target

- `<T-id>` provided: locate row in §T. Refuse if missing or already `x`.
- `--next`: pick the first **actionable** `state=.` row — phase prerequisites satisfied (every row in a lower `P<n>` is `x`). Skip `!`/`?`. Refuse if none actionable (suggest resolving a blocked row).
- Read row: `id`, `P`, `state`, `task`, `cite`, `verify`.

### 3. Acquire lock

Write `<dir>/.ds-lock`:

```json
{"pid": <PID>, "started": "<ISO>", "skill": "ds:build", "target": "<T-id>"}
```

If lock present + active (pid alive + age \<30min): refuse w/ "active op: <skill> pid <pid> since <time>". Caller decides.

If stale: clear + proceed.

### 4. Resume detection

Read §S grep `ds:build <T-id>`. Identify last event:

| Last event     | Resume point                       |
| -------------- | ---------------------------------- |
| (no entries)   | full run from step 5               |
| `START`        | step 5 (re-run safe)               |
| `commit=<sha>` | step 7 (skip work + commit)        |
| `§X=refreshed` | step 8 (flip only)                 |
| `DONE`         | nothing to do; release lock + exit |

### 5. CLAIM

If state still `.`: flip to `~`. Atomic write. Append §S as its own paragraph (blank line before AND after — per FORMAT.md §11; applies to every §S append in this skill):

```
<YYYY-MM-DD HH:MM> ds:build <T-id> START
```

**TaskList mirror:** if a TaskList task exists whose subject starts with `<T-id>` (hydrated by `ds:status`), `TaskUpdate` it to `in_progress`. Keeps the operator's watch surface live. Skip silently if absent.

### 5.5. PIN CHECK (before RED — read-mostly)

Before writing any test or code, ensure the libraries this task introduces are pinned:

- For each package/version the task will add: confirm §I "Pinned deps" already has a resolved entry.
- If a needed lib is missing: `python3 "${CLAUDE_PLUGIN_ROOT}"/hooks/resolve_pins.py <ecosystem>:<pkg>`, append the row to §I via the Edit tool (DOSSIER.md is `.md` → not fastedit), and append §S `ds:build <T-id> pin=<pkg>@<ver>` (or `pin=offline` if unreachable).
- Optionally ground the API SHAPE via the `§context7` adapter (ADAPTERS.md): `resolve-library-id` then `query-docs`; WebFetch the official docs as fallback.

Runs OUTSIDE the RED→GREEN→refactor cycle — a dossier-bookkeeping write (like §X refresh), never a source commit. The model then writes source using the §I version, so the reactive verify hook fires on a warm-cache HIT and stays silent.

### 6. WORK (TDD)

**Baseline check (before RED):** confirm the existing suite for the touched package is green (or note known-failing). A new RED must be attributable to THIS task — never build atop already-broken ground. Under `--auto`, an unexpected red baseline is a PAUSE (`ambiguous`).

If `verify` column references `V<N>`:

- Locate test for `V<N>` (search §V row's `check` column).
- If test exists + fails: run, capture output.
- If test absent: write test FIRST (RED). Commit (`test(<scope>): add <V-id> check`).

Then implement. Run test → GREEN. Refactor if needed.

If `verify` is shell predicate: run after work, must exit 0. If `verify` is `—`: implement, no test gate. (Discouraged; only for docs / config.)

Use `fastedit` if `HAS_FASTEDIT=1` for surgical code edits. Else Edit tool.

**Source comments stay phase-agnostic.** Never write `// Phase N`, `// Step N`, `// Stage N`, `// V<n> (Phase <m> / A<k>)`, or `// PH<n>-B<k>` in source or test files. Phase / audit tracking lives in DOSSIER.md §B and §S. Comments in source answer _why_ (workaround refs, non-obvious invariants, upstream-bug links), not _which phase_. The `marker_guard.py` PreToolUse hook enforces this — Edit/Write/MultiEdit calls carrying phase markers exit 2.

If tests fail and root cause unclear: **spawn `dossier-scout` subagent** with mission "root-cause this failure: <test-name>, repo=<repo>, last-passing=<sha>". Use report to guide fix. Scout output is caveman-compressed; main thread aggregates.

If failure suggests a missing invariant: trigger `ds:backprop` flow (don't just patch the symptom).

### 7. COMMIT

`git add` only files touched by this task. `git commit` with subject pattern:

```
<type>(<scope>): <imperative summary>

<optional body — only if "why" isn't obvious>

Refs §T <T-id>
```

Capture SHA. Append §S:

```
<YYYY-MM-DD HH:MM> ds:build <T-id> commit=<sha>
```

If commit hooks fail: investigate root cause (do NOT `--no-verify`). Fix, retry commit.

### 8. §X REFRESH

For each repo in §X, refresh the row via `$CLAUDE_PLUGIN_ROOT/hooks/lib-x-refresh.sh <dir> "<repo-label>" <repo-path>` — it runs the git probes (current branch, `origin/<branch>..HEAD` ahead-count, nearest tag, push state), rewrites branch/ahead/tag/pushed, preserves the `notes` cell, and writes atomically. Supply each repo's on-disk path (you already know it from the task work). `ahead=no-upstream` + `pushed=no` when the branch has no `origin/` tracking ref.

The `notes` cell is operator free-text — `lib-x-refresh.sh` never touches it. Edit notes manually if they've gone stale.

Multi-repo path-resolution sweep before the loop: parallel Bash calls. The per-row write itself stays with `lib-x-refresh.sh`.

Append §S (one entry summarising the sweep):

```
<YYYY-MM-DD HH:MM> ds:build <T-id> §X=refreshed
```

### 8a. Vm.X STALE GUARD

Before flip: check §X mtime (last `§X=refreshed` line in §S, or DOSSIER.md mtime if never refreshed). If >30min stale **after** step 8 attempted (refresh failed / partial):

```
⚠ §X stale (>30min, last refresh: <ts>). Proceed with flip? (y/N)
```

- `n` / default: refuse flip, release lock, exit. §S: `§X=stale-refused`.
- `y`: proceed. §S: `§X=stale-confirmed`.

Skip guard entirely if refresh succeeded in step 8.

### 9. FLIP

State `~` → `x`. Update `cite` column with commit SHA. Atomic write. Append §S:

```
<YYYY-MM-DD HH:MM> ds:build <T-id> DONE → x cite=<sha>
```

**TaskList mirror:** `TaskUpdate` the `<T-id>` task to `completed`.

### 10. Regen INDEX

Run `lib-regen-index.sh`. INDEX now reflects updated `T <done>/<total>`.

### 11. Release lock

`rm <dir>/.ds-lock`.

### 12. Report

```
ds:build <T-id> → x
commit=<sha>
§X: <repo> ahead=<n> [+ refreshes]
next: ds:build --next [or remaining T-ids]
```

## Autonomous mode (`--auto`)

Drives the §T ledger to completion without per-task operator approval. The operator steers by watching the TaskList + transcript, not by approving each step.

**Loop — one iteration = one task** (each its own commit + §S DONE, so a crash resumes cleanly):

1. SELECT next actionable row: first `state=.` whose phase prerequisites are satisfied (every row in lower `P<n>` is `x`). Resume any crashed `~` first (step 4). Skip `!` and `?`.
1. No actionable row → §S `ds:build — auto-stop=no-unblocked`, print `DONE`, stop.
1. A PAUSE condition (below) holds → §S `ds:build <id> PAUSE reason=<class>:<detail>`, print `PAUSE: <reason>`, release lock, stop.
1. Else run steps 5–12 verbatim (full covenant + TaskList mirror), then print `CONTINUE` (more `.` remain) or `DONE`.

**Driver — wrap with native `/goal`** so a fresh evaluator keeps the turn going until done:

```
/goal Keep running ds:build --auto until it prints DONE or PAUSE. Stop on PAUSE.
```

`/goal clear` (or Esc) ends the run cleanly. Do NOT use Workflows or `/loop` (background / no mid-run steer / not dependency-ordered).

**Decision boundary — MUST PAUSE (never auto-resolve):**

| class               | trigger                                                                          |
| ------------------- | -------------------------------------------------------------------------------- |
| `blocked`           | row state `!` or `?`                                                             |
| `ambiguous`         | `verify=—` on a behaviour-bearing task, or >1 reasonable implementation          |
| `destructive`       | task implies delete/drop/migrate/force, schema change, or files outside §X repos |
| `push`              | any `git push` / network-mutating op (never auto-push)                           |
| `retries-exhausted` | test still RED after 2 fix attempts + one auto-`ds:backprop`                     |
| `x-stale`           | the Vm.X §X-stale guard (§8a) would prompt — do NOT auto-confirm                 |
| `budget`            | `--max-tasks <n>` (default 10) or a turn ceiling reached → §S `auto-stop=budget` |

**Rails:** never auto-push · never auto-close (stop at the last `x`-flip; `ds:close` stays an explicit operator step) · per-task lock · atomic writes · `marker_guard` + `verify` hooks stay active during WORK. Every PAUSE writes its reason to §S so `ds:status` shows WHY on return (Vm.14).

## Failure handling

- Lock active: refuse, suggest `--resume` or wait.
- Test fail + can't fix: leave row `~`, release lock, write §S w/ `BLOCKED: <reason>`. Operator decides.
- Commit fail: leave row `~`, release lock. Operator investigates.
- §X refresh fail (network / repo missing): row updates partial, flag in §S. Triggers Vm.X stale guard (§8a) — operator confirms before flip.

## Cite

- FORMAT.md §8 (§T format), §10 (§X format), §11 (§S format), §14 (locks), §15 (atomic writes), §16 (resume)
- ADAPTERS.md §rtk, §fastedit
