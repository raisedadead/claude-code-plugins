---
name: roll
description: Persist Claude Code TaskList across session boundaries. A SessionEnd hook auto-dumps. Invoke when user says "/dossier:roll", "roll the session", "save tasks before compact", "restore tasks", "dump tasklist".
argument-hint: dump | restore [<file>] | list
---

# ds:roll — TaskList persistence across sessions

Three verbs, standalone: a live dossier is optional.

Storage: `<project root>/.scratchpad/.tasklist-roll/<YYYY-MM-DD_HHMMSS>.tlr` — the auto-dump hook takes that root from its payload `cwd`, so a subdirectory does not fork the tree.

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

`trig` values: `explicit` and `sessionend` are current; `precompact` is legacy, carried by files written before the PreCompact registration was dropped, and still read.

State legend (matches dossier §T): `.`=pending · `~`=in_progress · `x`=completed. `—` = absent / default (restore: `desc`/`actv` default to `subject`). `dep` = comma-sep `i` values of blocking tasks; `—` = none.

## Verbs

### `dump`

Snapshot the current Claude Code TaskList to a new `.tlr` file.

1. Read the live TaskList via the `TaskList` tool.
1. Per task capture `id`, `subject`, `description`, `activeForm`, `status`, `blockedBy`. v1 drops `metadata` and `owner`.
1. Read the current live dossier slug for the `doss:` header (`—` when there is none).
1. Render the pipe-table per the format above.
1. Write atomically to `<project root>/.scratchpad/.tasklist-roll/<YYYY-MM-DD_HHMMSS>.tlr` — tmp + rename. Take the filename and the `ts:` header from UTC, not local time. The hook uses UTC, the `ts:` field is `Z`-suffixed, and filename order is the ordering every verb here relies on; a local-time name sorts against the hook's by your offset.
1. Report: `rolled: <relpath> (<N> tasks, <P> pending)`.

Idempotent — the timestamp namespaces the filename, so a re-run adds a file.

`dump` is transcription, not a copy. Every step above runs in the model, so long descriptions get paraphrased and some get dropped. Measured on `2026-09-09_191440.tlr`: 21 of 49 rows kept a description, and task 46 came out 504 characters against the 732 in the harness store, reworded and missing three file paths. The hook-written roll is the faithful one — it is code, and it copies each field verbatim. When both exist for a session, restore from the newest `trig: sessionend` file and treat an `explicit` one as a summary.

### `restore [<file>]`

Recreate the TaskList from a `.tlr` file.

1. `<file>` when given. Otherwise the newest `trig: sessionend` file, which is code-written and verbatim; fall back to the newest file of any trigger only when no `sessionend` roll exists. Do not simply take the newest name — an `explicit` roll is model-transcribed (see `dump`), and on this machine `.tlr` files written before 2026-09-09 mix UTC and local-time names, so filename order is not write order across that boundary.
1. No `.tlr` present → say so and suggest `dump` first.
1. **Identity check:** read the `doss:` header. A slug (rather than `—`) that differs from the current live dossier slug (INDEX first `live` row) gets `roll is from <doss>, current live is <slug> — restore anyway? (y/N)`, defaulting to no. A cross-dossier restore is usually a mistake.
1. Parse the pipe-table: skip header lines starting with `#` or without a leading `|`, skip `|---|` separator rows, ignore unknown trailing columns.
1. **Pass 1 (dedup by subject):** `TaskList` first, collecting existing subjects. A row whose `subject` is new gets `TaskCreate` with `subject`, `description`, `activeForm` (`desc`/`actv` defaulting to `subject` on `—`); a row whose subject exists reuses that id. Record `old_i → id` either way.
1. **Pass 2:** every row with `status != "."` gets `TaskUpdate` with the mapped id and status (`~ → in_progress`, `x → completed`).
1. **Pass 3:** every row with a non-`—` `dep` gets `TaskUpdate` with `addBlockedBy: [<mapped-ids>]`, translated through the pass-1 map.
1. Report: `restored: <N> tasks from <file> (<created> new, <skipped> already present)`.

Restore is **idempotent by subject** — re-restoring the same roll, or restoring after `ds:status` already hydrated §T, creates no duplicates (the join key is the subject, matching FORMAT.md §8). Existing tasks survive it, which is why the old manual "clear leftovers first" step is gone.

### `list`

Show every `.tlr` under `<project root>/.scratchpad/.tasklist-roll/`, newest first: filename, task count, pending count, trig (explicit / sessionend / precompact, the last being a legacy value on files written before the PreCompact registration was dropped). Reads each header and counts pipe rows — no TaskList calls.

## SessionEnd safety net

The plugin registers a `SessionEnd` hook (`hooks/sessionend-roll.py`) that auto-dumps the TaskList as the session ends. It reads the session transcript, reconstructs final state, writes a `.tlr` with `trig: sessionend`, prunes the directory to the newest `roll_lib.ROLL_RETAIN` files, and surfaces a top-level `systemMessage` breadcrumb:

```
TaskList auto-rolled to .scratchpad/.tasklist-roll/<file> (<N> tasks, <P> pending).
Run /dossier:roll restore to resume.
```

There is no `PreCompact` registration. The harness TaskList survives compaction — post-compaction `TaskUpdate` calls still address task ids created before the boundary — so a compact-time roll only duplicated state the harness still held. The roll covers the cross-session case, where the TaskList does not carry over. Files written before that change carry `trig: precompact`; `list` and `restore` still read them.

SessionEnd carries no `hookSpecificOutput` branch in the CC hook schema, so it cannot inject model context, and **nothing surfaces the roll in the next session either**: `session-start.sh` has no reference to rolls, `.tlr` files or the TaskList — `grep -ciE 'tlr|tasklist|roll' hooks/session-start.sh` prints `0`. The breadcrumb above reaches the operator only inside the dying session's `systemMessage`.

So recovery is manual and the operator has to know to ask. Next session: `/dossier:roll list` to see what was dumped, then `/dossier:roll restore` for the newest. Best-effort: any failure is a silent skip and the session ends regardless.

## Conventions

- Pipe and newline are table-breaking. Dump escapes `|` to `¦` and collapses newlines to spaces; restore reverses both.
- `id` (the `i` column) is informational; restore generates fresh ids and re-maps `dep`.
- `.tlr` files are gitignored via the standard `.scratchpad/` rule.
- The SessionEnd hook keeps the newest `roll_lib.ROLL_RETAIN` (20) rolls and unlinks the rest. An explicit `dump` does not prune.

## Hard rules

- Restore treats `<file>` as read-only; its writes go through TaskList calls.
- A `dump` in flight leaves Write/Edit alone: the skill is operator-invoked, so there is no concurrent mutation to guard.
- A restore failure (parse error, `TaskCreate` refusal) reports the partial state and the offending row. Successful creates stand.

## Non-goals (v1)

- No cross-machine sync — `.tlr` lives in cwd, not a central store.
- No conflict resolution between two restored TaskLists.
- No pruning on an explicit `dump` — only the SessionEnd hook prunes.
- No `metadata` / `owner` preservation in v1 (v2 adds them as extra columns).

## Cite

- `hooks/roll_lib.py` — parser/writer primitives
- `hooks/sessionend-roll.py` — SessionEnd hook
