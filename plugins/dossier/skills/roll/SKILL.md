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
1. Parse pipe-table (skip header lines starting with `#` or non-`|`; skip separator rows of `|---|`; ignore unknown trailing columns).
1. **Pass 1:** for each row, call `TaskCreate` with `subject`, `description`, `activeForm` (defaulting `desc`/`actv` to `subject` when cell is `—`). Record `old_i → new_id` mapping.
1. **Pass 2:** for each row with `status != "."`, call `TaskUpdate` with the new id + status. (`~ → in_progress`, `x → completed`.)
1. **Pass 3:** for each row with non-`—` `dep`, call `TaskUpdate` with `addBlockedBy: [<new-ids>]` translated via the pass-1 map.
1. Report: `restored: <N> tasks from <file>`.

Restore is **additive** — does not delete existing TaskList entries. If a fresh session has leftover tasks, operator clears them manually (TaskUpdate status=deleted) before restoring.

### `list`

Show all `.tlr` files under `<cwd>/.scratchpad/.tasklist-roll/`, newest first. For each: filename, task count, pending count, trig (explicit / precompact).

Read each file's header + count pipe rows. No TaskList calls.

## PreCompact safety net

Plugin registers a `PreCompact` hook (`hooks/precompact-roll.py`) that auto-dumps the TaskList just before context compresses. Reads the session transcript, reconstructs final state, writes a `.tlr` with `trig: precompact`, emits a breadcrumb in `additionalContext`:

```
TaskList auto-rolled to .scratchpad/.tasklist-roll/<file> (<N> tasks, <P> pending).
Run /dossier:roll restore to resume on the post-compact side.
```

Best-effort. Any failure = silent skip; the compaction proceeds.

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
