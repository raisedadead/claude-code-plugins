---
name: roll
description: Persist Claude Code TaskList across session boundaries. Dumps current TaskList to a compact `.tlr` pipe-table file under .scratchpad/.tasklist-roll/, restorable in a fresh session via TaskCreate. PreCompact + SessionEnd hooks auto-dump. Invoke when user says "/dossier:roll", "roll the session", "save tasks before compact", "restore tasks", "dump tasklist".
argument-hint: dump | restore [<file>] | list
---

# ds:roll — TaskList persistence across sessions

Three verbs. Standalone — does not require a live dossier.

Storage: `<cwd>/.scratchpad/.tasklist-roll/<YYYY-MM-DD_HHMMSS>.tlr`

Format (compact pipe-table v1):

```
# tlr v1
sid: <session-id>
ts: <ISO-timestamp>
trig: explicit | precompact | sessionend

| i | st | subject | desc | actv | dep |
|---|----|---------|------|------|-----|
| 1 | x | Fix sort | INDEX regen sort flag wrong | Fixing sort | — |
| 2 | ~ | Soft-block Vm.X | warn+confirm on stale §X | Soft-blocking Vm.X | — |
| 3 | . | Wire integration | apply T10/T11 | — | 1,2 |
```

State legend (matches dossier §T): `.`=pending · `~`=in_progress · `x`=completed. `—` = absent / default (restore: `desc`/`actv` default to `subject`). `dep` = comma-sep `i` values of blocking tasks; `—` = none.

## Verbs

### `dump`

Snapshot the current Claude Code TaskList to a new `.tlr` file.

Steps:

1. Read live TaskList via `TaskList` tool.
1. For each task, capture: `id`, `subject`, `description`, `activeForm`, `status`, `blockedBy`. Drop `metadata` + `owner` in v1.
1. Render pipe-table per format above.
1. Write atomic to `<cwd>/.scratchpad/.tasklist-roll/<YYYY-MM-DD_HHMMSS>.tlr`. Tmp + rename.
1. Report: `rolled: <relpath> (<N> tasks, <P> pending)`.

Idempotent — timestamp namespaces filename, so re-running creates a new file.

### `restore [<file>]`

Recreate TaskList from a `.tlr` file.

Steps:

1. If `<file>` provided: use it. Else: pick newest `<ts>.tlr` in `<cwd>/.scratchpad/.tasklist-roll/`.
1. Refuse if no `.tlr` exists; suggest `dump` first.
1. **Identity check:** read the `doss:` header line. If it is a slug (not `—`) and differs from the current live dossier slug (INDEX first `live` row), WARN `roll is from <doss>, current live is <slug> — restore anyway? (y/N)` and default to no. A cross-dossier restore is usually a mistake.
1. Parse pipe-table (skip header lines starting with `#` or non-`|`; skip separator rows of `|---|`; ignore unknown trailing columns).
1. **Pass 1 (dedup by subject):** `TaskList` first; collect existing task subjects. For each row whose `subject` is NOT already present, call `TaskCreate` with `subject`, `description`, `activeForm` (defaulting `desc`/`actv` to `subject` when cell is `—`). For a row whose subject already exists, skip the create and reuse the existing id. Record `old_i → id` mapping either way.
1. **Pass 2:** for each row with `status != "."`, call `TaskUpdate` with the mapped id + status. (`~ → in_progress`, `x → completed`.)
1. **Pass 3:** for each row with non-`—` `dep`, call `TaskUpdate` with `addBlockedBy: [<mapped-ids>]` translated via the pass-1 map.
1. Report: `restored: <N> tasks from <file> (<created> new, <skipped> already present)`.

Restore is **idempotent by subject** — re-restoring the same roll, or restoring after `ds:status` already hydrated §T, creates no duplicates (the join key is the task subject, matching FORMAT.md §8). It never deletes existing tasks; the old manual "clear leftovers first" step is obsolete.

### `list`

Show all `.tlr` files under `<cwd>/.scratchpad/.tasklist-roll/`, newest first. For each: filename, task count, pending count, trig (explicit / precompact).

Read each file's header + count pipe rows. No TaskList calls.

## PreCompact / SessionEnd safety net

Plugin registers `PreCompact` and `SessionEnd` hooks (`hooks/precompact-roll.py`) that auto-dump the TaskList just before context is lost. Reads the session transcript, reconstructs final state, writes a `.tlr` with `trig: precompact` / `sessionend`, and surfaces a top-level `systemMessage` breadcrumb:

```
TaskList auto-rolled to .scratchpad/.tasklist-roll/<file> (<N> tasks, <P> pending).
Run /dossier:roll restore to resume.
```

SessionEnd and PreCompact have no `hookSpecificOutput` branch in the CC hook schema, so they cannot inject model context — restore reads the newest `.tlr` from disk, or `session-start.sh` surfaces it on the next session. Best-effort: any failure = silent skip; the compaction proceeds.

## Conventions

- Pipe + newline are table-breaking. Dump escapes `|` to `¦` and collapses newlines to spaces. Restore reverses.
- `id` (`i` column) is informational; restore generates fresh ids and re-maps `dep`.
- `.tlr` files are gitignored via the standard `.scratchpad/` rule.
- Old rolls are operator-managed — delete manually when stale.

## Hard rules

- Never mutate `<file>` on restore. Read-only.
- Never block a Write/Edit if `dump` is mid-flight (skill is operator-invoked; no concurrent mutation risk).
- Restore failures (parse error, TaskCreate refusal) → report partial state + the offending row. Don't roll back successful creates.

## Non-goals (v1)

- No cross-machine sync — `.tlr` lives in cwd, not central store.
- No conflict resolution between two restored TaskLists.
- No automatic pruning — operator deletes old rolls.
- No `metadata` / `owner` field preservation in v1 (add in v2 as extra columns).

## Cite

- `hooks/roll_lib.py` — parser/writer primitives
- `hooks/precompact-roll.py` — PreCompact hook
