---
name: roll
description: Persist Claude Code TaskList across session boundaries. PreCompact + SessionEnd hooks auto-dump. Invoke when user says "/dossier:roll", "roll the session", "save tasks before compact", "restore tasks", "dump tasklist".
argument-hint: dump | restore [<file>] | list
---

# ds:roll — TaskList persistence across sessions

Three verbs, standalone: a live dossier is optional.

Storage: `<cwd>/.scratchpad/.tasklist-roll/<YYYY-MM-DD_HHMMSS>.tlr`

Format (compact pipe-table v1):

```
# tlr v1
sid: <session-id>
doss: <live-dossier-slug or —>
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

1. Read the live TaskList via the `TaskList` tool.
1. Per task capture `id`, `subject`, `description`, `activeForm`, `status`, `blockedBy`. v1 drops `metadata` and `owner`.
1. Read the current live dossier slug for the `doss:` header (`—` when there is none).
1. Render the pipe-table per the format above.
1. Write atomically to `<cwd>/.scratchpad/.tasklist-roll/<YYYY-MM-DD_HHMMSS>.tlr` — tmp + rename.
1. Report: `rolled: <relpath> (<N> tasks, <P> pending)`.

Idempotent — the timestamp namespaces the filename, so a re-run adds a file.

### `restore [<file>]`

Recreate the TaskList from a `.tlr` file.

1. `<file>` when given, else the newest `<ts>.tlr` in `<cwd>/.scratchpad/.tasklist-roll/`.
1. No `.tlr` present → say so and suggest `dump` first.
1. **Identity check:** read the `doss:` header. A slug (rather than `—`) that differs from the current live dossier slug (INDEX first `live` row) gets `roll is from <doss>, current live is <slug> — restore anyway? (y/N)`, defaulting to no. A cross-dossier restore is usually a mistake.
1. Parse the pipe-table: skip header lines starting with `#` or without a leading `|`, skip `|---|` separator rows, ignore unknown trailing columns.
1. **Pass 1 (dedup by subject):** `TaskList` first, collecting existing subjects. A row whose `subject` is new gets `TaskCreate` with `subject`, `description`, `activeForm` (`desc`/`actv` defaulting to `subject` on `—`); a row whose subject exists reuses that id. Record `old_i → id` either way.
1. **Pass 2:** every row with `status != "."` gets `TaskUpdate` with the mapped id and status (`~ → in_progress`, `x → completed`).
1. **Pass 3:** every row with a non-`—` `dep` gets `TaskUpdate` with `addBlockedBy: [<mapped-ids>]`, translated through the pass-1 map.
1. Report: `restored: <N> tasks from <file> (<created> new, <skipped> already present)`.

Restore is **idempotent by subject** — re-restoring the same roll, or restoring after `ds:status` already hydrated §T, creates no duplicates (the join key is the subject, matching FORMAT.md §8). Existing tasks survive it, which is why the old manual "clear leftovers first" step is gone.

### `list`

Show every `.tlr` under `<cwd>/.scratchpad/.tasklist-roll/`, newest first: filename, task count, pending count, trig (explicit / precompact). Reads each header and counts pipe rows — no TaskList calls.

## PreCompact / SessionEnd safety net

The plugin registers `PreCompact` and `SessionEnd` hooks (`hooks/precompact-roll.py`) that auto-dump the TaskList just before context is lost. Each reads the session transcript, reconstructs final state, writes a `.tlr` with `trig: precompact` / `sessionend`, and surfaces a top-level `systemMessage` breadcrumb:

```
TaskList auto-rolled to .scratchpad/.tasklist-roll/<file> (<N> tasks, <P> pending).
Run /dossier:roll restore to resume.
```

SessionEnd and PreCompact carry no `hookSpecificOutput` branch in the CC hook schema, so they cannot inject model context, and **nothing surfaces the roll in the next session either**: `session-start.sh` has no reference to rolls, `.tlr` files or the TaskList — `grep -ciE 'tlr|tasklist|roll' hooks/session-start.sh` prints `0`. The breadcrumb above reaches the operator only inside the dying session's `systemMessage`, and a compaction they did not watch leaves no trace in the new context.

So recovery is manual and the operator has to know to ask. Next session: `/dossier:roll list` to see what was dumped, then `/dossier:roll restore` for the newest. Best-effort: any failure is a silent skip and the compaction proceeds.

## Conventions

- Pipe and newline are table-breaking. Dump escapes `|` to `¦` and collapses newlines to spaces; restore reverses both.
- `id` (the `i` column) is informational; restore generates fresh ids and re-maps `dep`.
- `.tlr` files are gitignored via the standard `.scratchpad/` rule.
- Old rolls are operator-managed — delete them when stale.

## Hard rules

- Restore treats `<file>` as read-only; its writes go through TaskList calls.
- A `dump` in flight leaves Write/Edit alone: the skill is operator-invoked, so there is no concurrent mutation to guard.
- A restore failure (parse error, `TaskCreate` refusal) reports the partial state and the offending row. Successful creates stand.

## Non-goals (v1)

- No cross-machine sync — `.tlr` lives in cwd, not a central store.
- No conflict resolution between two restored TaskLists.
- No automatic pruning — the operator deletes old rolls.
- No `metadata` / `owner` preservation in v1 (v2 adds them as extra columns).

## Cite

- `hooks/roll_lib.py` — parser/writer primitives
- `hooks/precompact-roll.py` — PreCompact hook
