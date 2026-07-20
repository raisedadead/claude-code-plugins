---
name: close
description: Close a live dossier. Validates §T all-x, §X clean, §B all-fixed, writes §Z postscript (requires --complete or --successor <slug>), moves dir to _archive/. Atomic. Resumable. Invoke when the user says "ds:close", "close dossier", "wrap dossier", "archive this phase", "ds:close --complete", or "ds:close --successor <slug>".
argument-hint: --complete | --successor <slug> | --abandon "<reason>" | --resume
---

# ds:close — close + archive a dossier

Refuses to close without `--complete`, `--successor <slug>`, OR `--abandon "<reason>"`. `--complete`/`--successor` refuse if §T has non-`x` rows or §B has unfixed rows; `--abandon` is the escape hatch for a deprioritized / superseded / dead-end wave (skips the §T-all-x gate, still archives with an audit trail).

## Inputs

- `--complete`: project done, no follow-on dossier.
- `--successor <slug>`: next phase continues in dossier `<slug>` (validated against INDEX).
- `--abandon "<reason>"`: close an incomplete wave without finishing §T. Reason is mandatory (written to §Z + §S). Use when the wave is dropped, not done.
- `--resume`: re-enter incomplete close op.

## Steps

### 0. Detect host env

Per ADAPTERS.md.

DOSSIER.md writes use the bundled helpers (FORMAT.md §15): `$CLAUDE_PLUGIN_ROOT/hooks/lib-s-append.sh <dir> "<event>"` appends §S (the §S code-fence examples below show the full line — pass only the text **after** the timestamp; the script prepends it). §Z is written via `$CLAUDE_PLUGIN_ROOT/hooks/lib-z-write.sh <dir> <complete|successor|abandoned> <value> "<summary>" "<cites>"` — atomic, and it guarantees the §12 blank-line separation (replaces the old Edit-tool write).

### 1. Locate live dossier

Per `ds:status` step 1. Refuse if none.

### 2. Validate flags

Exactly one of `--complete`, `--successor <slug>`, or `--abandon "<reason>"` required. Refuse otherwise:

```
ds:close requires --complete OR --successor <slug> OR --abandon "<reason>".
Closing without one orphans the handoff.
```

If `--successor <slug>`: validate the successor exists in `.scratchpad/dossier/<...>-<slug>/DOSSIER.md` OR offer to scaffold via `ds:new <slug>` first.

### 3. Acquire lock

Write `<dir>/.ds-lock` with `skill: "ds:close", target: "—"`.

### 4. Resume detection

Read §S grep `ds:close`:

| Last event                   | Resume point                       |
| ---------------------------- | ---------------------------------- |
| (none)                       | step 5                             |
| `START`                      | step 5                             |
| `§Z=written` (header=`done`) | step 7 (guarded move — idempotent) |
| `DONE` + dir still live      | re-flip header `done`, then step 7 |
| `DONE` + dir archived        | exit (already closed)              |

### 5. VALIDATE

Pre-flight gates (`--abandon` skips the §T all-x, §T cites, and §B all-fixed gates — only the §X pushed warning still runs):

| Gate         | Rule                               | On fail                                                     |
| ------------ | ---------------------------------- | ----------------------------------------------------------- |
| §T all-x     | every row state=`x`                | refuse, list non-`x` rows                                   |
| §T cites     | every `x` row has `cite`           | refuse, list rows missing cite                              |
| §B all-fixed | every row has non-empty `fix cite` | refuse OR allow w/ `--accept-open-bugs` (operator override) |
| §X pushed    | every repo `pushed=yes`            | warn, allow operator decision (push or close anyway)        |

Advisory (non-blocking; `--complete`/`--successor` only — never on `--abandon`, whose incomplete §T would make the suggestion a dead end): when §T is all-`x` and no §X repo changelog carries this wave's range-cite section, print `consider ds:ship first`. Prints once, never refuses.

Append §S as its own paragraph (blank line before AND after — per FORMAT.md §11; applies to every §S append in this skill):

```
<YYYY-MM-DD HH:MM> ds:close — START successor=<slug-or-—> complete=<bool> abandon=<bool>
```

### 6. WRITE §Z

Write §Z through the bundled helper (atomic tmp+rename, and it guarantees the §12 blank-line separation so a formatter cannot merge the fields — the markdown blocks below show the resulting shape, not a manual edit):

```
"$CLAUDE_PLUGIN_ROOT"/hooks/lib-z-write.sh <dir> complete   —        "<summary>" "<key cites>"
"$CLAUDE_PLUGIN_ROOT"/hooks/lib-z-write.sh <dir> successor  <slug>   "<summary>" "<key cites>"
"$CLAUDE_PLUGIN_ROOT"/hooks/lib-z-write.sh <dir> abandoned  "<reason>" "<summary>" "<key cites>"
```

If `--complete`:

```markdown
## §Z — Closeout

<YYYY-MM-DD HH:MM> — closed

complete: true

summary: <operator-provided one-line summary>

key cites: <list of T-row cites, comma-separated>
```

If `--successor <slug>`:

```markdown
## §Z — Closeout

<YYYY-MM-DD HH:MM> — closed

successor: <slug>

summary: <operator-provided one-line summary>

key cites: <list of T-row cites>
```

If `--abandon "<reason>"`:

```markdown
## §Z — Closeout

<YYYY-MM-DD HH:MM> — closed

abandoned: true

reason: <operator reason>

summary: <state at abandonment — what shipped, what was dropped>

key cites: <any T-row cites, or —>
```

Flip the header state atomically via the bundled helper: `"$CLAUDE_PLUGIN_ROOT"/hooks/lib-header-state.sh <dir> done` (replaces the old Edit-tool header mutation; FORMAT.md §15). This flip MUST land **before** the `§Z=written` checkpoint below — a checkpoint may only trail a mutation already performed; otherwise a crash resumes past an unflipped header and archives a dir still reading `live` (inverse drift).

Append §S (checkpoint — §Z written AND header now `done`):

```
<YYYY-MM-DD HH:MM> ds:close — §Z=written
```

### 7. MOVE TO \_archive/

Guarded, resumable commit-point via the bundled helper — refuses a pre-existing dest (no nested move), asserts the move landed, preserves the source on failure (FORMAT.md §15):

```
"$CLAUDE_PLUGIN_ROOT"/hooks/lib-archive-move.sh .scratchpad/dossier/<date>-<slug> .scratchpad/dossier/_archive
```

Idempotent: re-running after a completed move is a no-op (resume-safe). On non-zero exit the source is intact — do NOT append `DONE`; surface the error and stop.

Append §S (to the moved file):

```
<YYYY-MM-DD HH:MM> ds:close — DONE archived
```

### 8. Regen INDEX

Run `lib-regen-index.sh`. INDEX flips dossier row to `state=done` + `§Z` column to `complete` or `→<slug>`.

### 9. Release lock

`rm <archived-dir>/.ds-lock`.

### 10. Report

```
ds:close <slug> → done
§Z: <complete | →<slug>>
archived: .scratchpad/dossier/_archive/<date>-<slug>/
next: <ds:new <successor> | nothing — project complete>
```

## Failure handling

- §T non-`x` rows present: refuse, list, suggest `ds:build --next`.
- §B unfixed rows: refuse, list, suggest `ds:backprop B<N>` per row.
- §Z already written but move failed (rare crash): `--resume` re-runs `lib-archive-move.sh` (idempotent — finishes or no-ops).
- Successor slug missing: offer `ds:new <successor>` inline scaffold.

## Cite

- FORMAT.md §2 (state values), §12 (§Z format), §13 (INDEX update), §14 (locks), §15 (atomic writes), §16 (resume), §17 (Vm.4)
