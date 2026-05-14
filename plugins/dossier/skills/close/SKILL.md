---
name: close
description: Close a live dossier. Validates §T all-x, §X clean, §B all-fixed, writes §Z postscript (requires --complete or --successor <slug>), moves dir to _archive/. Atomic. Resumable. Invoke when the user says "ds:close", "close dossier", "wrap dossier", "archive this phase", "ds:close --complete", or "ds:close --successor <slug>".
argument-hint: --complete | --successor <slug> | --resume
---

# ds:close — close + archive a dossier

Refuses to close without `--complete` OR `--successor <slug>`. Refuses if §T has non-`x` rows or §B has unfixed rows.

## Inputs

- `--complete`: project done, no follow-on dossier.
- `--successor <slug>`: next phase continues in dossier `<slug>` (validated against INDEX).
- `--resume`: re-enter incomplete close op.

## Steps

### 0. Detect host env

Per ADAPTERS.md.

### 1. Locate live dossier

Per `ds:status` step 1. Refuse if none.

### 2. Validate flags

Exactly one of `--complete` or `--successor <slug>` required. Refuse otherwise:

```
ds:close requires --complete OR --successor <slug>.
Closing without either orphans the handoff.
```

If `--successor <slug>`: validate the successor exists in `.scratchpad/dossier/<...>-<slug>/DOSSIER.md` OR offer to scaffold via `ds:new <slug>` first.

### 3. Acquire lock

Write `<dir>/.ds-lock` with `skill: "ds:close", target: "—"`.

### 4. Resume detection

Read §S grep `ds:close`:

| Last event              | Resume point          |
| ----------------------- | --------------------- |
| (none)                  | step 5                |
| `START`                 | step 5                |
| `§Z=written`            | step 7 (mv)           |
| `DONE` + dir still live | step 7 (mv)           |
| `DONE` + dir archived   | exit (already closed) |

### 5. VALIDATE

Pre-flight gates:

| Gate         | Rule                               | On fail                                                     |
| ------------ | ---------------------------------- | ----------------------------------------------------------- |
| §T all-x     | every row state=`x`                | refuse, list non-`x` rows                                   |
| §T cites     | every `x` row has `cite`           | refuse, list rows missing cite                              |
| §B all-fixed | every row has non-empty `fix cite` | refuse OR allow w/ `--accept-open-bugs` (operator override) |
| §X pushed    | every repo `pushed=yes`            | warn, allow operator decision (push or close anyway)        |

Append §S:

```
<YYYY-MM-DD HH:MM> ds:close — START successor=<slug-or-—> complete=<bool>
```

### 6. WRITE §Z

Atomic write DOSSIER.md with §Z section populated:

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

Append §S:

```
<YYYY-MM-DD HH:MM> ds:close — §Z=written
```

Update header line at top of DOSSIER.md: state `live` → `done`.

### 7. MOVE TO \_archive/

Atomic POSIX rename:

```
mv .scratchpad/dossier/<date>-<slug>/ .scratchpad/dossier/_archive/<date>-<slug>/
```

Ensure `_archive/` exists first (`mkdir -p`).

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
- §Z already written but mv failed (rare crash): `--resume` finishes mv.
- Successor slug missing: offer `ds:new <successor>` inline scaffold.

## Cite

- FORMAT.md §2 (state values), §12 (§Z format), §13 (INDEX update), §14 (locks), §15 (atomic writes), §16 (resume), §17 (Vm.4)
