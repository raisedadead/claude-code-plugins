---
name: build
description: Execute a §T task with TDD covenant. Claims row (. → ~), runs tests/edits, commits, refreshes §X, flips row to x with commit cite. Resumable on crash via §S step-log. Invoke when the user says "ds:build T<N>", "build next task", "ds:build --next", "implement T<N>", or "work on <task-description>".
argument-hint: <T-id> | --next | --resume
---

# ds:build — execute a §T task

TDD covenant: RED → GREEN → refactor. One commit per `x`-flip. Resumable.

## Inputs

- `<T-id>` (e.g. `T3`): explicit target.
- `--next`: pick first `state=.` row in §T.
- `--resume`: re-enter incomplete op for the same target (auto-detected from §S; flag is explicit override).

## Steps

### 0. Detect host env

Per ADAPTERS.md. Note `HAS_RTK`, `HAS_CTX`, `HAS_FASTEDIT`.

### 1. Locate live dossier

Per `ds:status` step 1. If none: refuse w/ "no live dossier. ds:new first."

### 2. Resolve target

- `<T-id>` provided: locate row in §T. Refuse if missing or already `x`.
- `--next`: pick first `state=.` row. Refuse if none.
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

If state still `.`: flip to `~`. Atomic write. Append §S:

```
<YYYY-MM-DD HH:MM> ds:build <T-id> START
```

### 6. WORK (TDD)

If `verify` column references `V<N>`:

- Locate test for `V<N>` (search §V row's `check` column).
- If test exists + fails: run, capture output.
- If test absent: write test FIRST (RED). Commit (`test(<scope>): add <V-id> check`).

Then implement. Run test → GREEN. Refactor if needed.

If `verify` is shell predicate: run after work, must exit 0. If `verify` is `—`: implement, no test gate. (Discouraged; only for docs / config.)

Use `fastedit` if `HAS_FASTEDIT=1` for surgical code edits. Else Edit tool.

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

For each repo in §X: run `git status -sb` + `git rev-list --count origin/<branch>..HEAD` + `git describe --tags --abbrev=0`. Update row.

Use `mcp__context-mode__ctx_batch_execute` if `HAS_CTX=1` (parallel multi-repo). Else parallel Bash.

Atomic write DOSSIER.md. Append §S:

```
<YYYY-MM-DD HH:MM> ds:build <T-id> §X=refreshed
```

### 9. FLIP

State `~` → `x`. Update `cite` column with commit SHA. Atomic write. Append §S:

```
<YYYY-MM-DD HH:MM> ds:build <T-id> DONE → x cite=<sha>
```

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

## Failure handling

- Lock active: refuse, suggest `--resume` or wait.
- Test fail + can't fix: leave row `~`, release lock, write §S w/ `BLOCKED: <reason>`. Operator decides.
- Commit fail: leave row `~`, release lock. Operator investigates.
- §X refresh fail (network / repo missing): row updates partial, flag in §S. Skill still proceeds to flip (work is done; §X is bookkeeping).

## Cite

- FORMAT.md §8 (§T format), §10 (§X format), §11 (§S format), §14 (locks), §15 (atomic writes), §16 (resume)
- ADAPTERS.md §rtk, §context-mode, §fastedit
