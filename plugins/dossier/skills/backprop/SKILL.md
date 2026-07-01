---
name: backprop
description: 'Bug → §V protocol. On bug report or failed test, trace root cause, decide whether a new §V invariant prevents recurrence, append §B row + optional §V row + regression test. One commit. Resumable. Invoke when the user says "ds:backprop", "bug: <description>", "backprop B<N>", "root-cause this", "add invariant for <X>", or auto-trigger from ds:build on test failure.'
argument-hint: <B-id> | <bug-description> | --resume
---

# ds:backprop — bug → invariant protocol

Six steps. Append-only on §B + §V. Resumable.

## Inputs

- `<B-id>` (e.g. `B5`): existing bug row, resume / amend.
- `<bug-description>` free text: new bug, scaffold §B row from it.
- `--resume`: explicit override of auto-detected resume point.

## Steps

### 0. Detect host env

Per ADAPTERS.md. Note `HAS_CAVEMEM` (recurrence research benefits).

DOSSIER.md writes use the bundled helpers (FORMAT.md §15): `$CLAUDE_PLUGIN_ROOT/hooks/lib-row-flip.sh <dir> <id> <state> [cite]` flips §T/§B state cells, `$CLAUDE_PLUGIN_ROOT/hooks/lib-s-append.sh <dir> "<event>"` appends §S. The §S code-fence examples below show the full line — pass only the text **after** the timestamp (the script prepends it).

### 1. Locate live dossier

Per `ds:status` step 1. Refuse if none.

### 2. Acquire lock

Write `<dir>/.ds-lock` with `skill: "ds:backprop", target: "B<N-or-pending>"`.

### 3. Resume detection

Read §S grep `ds:backprop <target>`:

| Last event   | Resume point                |
| ------------ | --------------------------- |
| (none)       | full run from step 4        |
| `START`      | step 4 (re-scope)           |
| `test=<sha>` | step 6                      |
| `§B=B<N>`    | step 7 (invariant decision) |
| `§V=V<N>`    | step 8 (fix)                |
| `fix=<sha>`  | step 9 (close)              |
| `DONE`       | exit                        |

### 4. CLAIM + scope

Append §S as its own paragraph (blank line before AND after — per FORMAT.md §11; applies to every §S append in this skill):

```
<YYYY-MM-DD HH:MM> ds:backprop <B-or-pending> START
```

Define:

- bug short label (≤80 chars)
- root cause hypothesis (≤2 lines)
- recurrence likelihood (low / mid / high)

If root cause is fuzzy or class-of-bug research needed: **spawn `dossier-scout` subagent** with mission "research <bug-label>: where does this class manifest? Prior occurrences? Test gaps?". If `HAS_CAVEMEM=1`, also query `mcp__cavemem__search` for prior observations of same class.

### 5. WRITE REGRESSION TEST (RED)

Write test that reproduces the bug. Run → must FAIL (RED). If it passes, the bug isn't characterized correctly — revisit step 4.

**Test comments stay phase-agnostic.** No `// Phase N`, `// PH<n>-B<k>`, `// V<n> (Phase <m> / A<k>)` in the test body. Test name and `Refs §B B<N>` in the commit message carry the link. The `marker_guard.py` PreToolUse hook blocks these — exit 2 on Edit/Write/MultiEdit if a phase marker leaks into source or test files.

Commit:

```
test(<scope>): repro <bug-label>

Refs §B B<N>
```

Append §S:

```
<YYYY-MM-DD HH:MM> ds:backprop B<N> test=<sha>
```

If bug is non-testable (docs drift, infra config, etc.): skip test commit. Note in §B `invariant added` = `— (non-testable)`.

### 6. APPEND §B row

Atomic write DOSSIER.md w/ new §B row:

```
| B<N> | <bug-label> | <root-cause> | <pending> | <test-sha-or-—> |
```

Append §S:

```
<YYYY-MM-DD HH:MM> ds:backprop B<N> §B=B<N>
```

### 7. INVARIANT DECISION

Question: would a new §V invariant catch recurrence?

| Recurrence | Class    | Decision              |
| ---------- | -------- | --------------------- |
| high       | systemic | YES — append §V row   |
| mid        | local    | maybe — operator call |
| low        | one-off  | NO — patch-only       |

If YES: append §V row pointing at the test from step 5 (or new check):

```
| V<N> | <invariant claim> | <test-name> |
```

Update §B `invariant added` column to `V<N>`. Atomic write.

Append §S:

```
<YYYY-MM-DD HH:MM> ds:backprop B<N> §V=V<N>
```

If NO: §B `invariant added` stays `—`. Note in §S `§V=skipped:one-off`.

### 8. FIX (GREEN)

Implement fix. Run regression test → GREEN. Run full test suite (or scoped) → no regressions.

Commit:

```
fix(<scope>): <imperative summary>

<body if non-obvious>

Refs §B B<N>
```

Append §S:

```
<YYYY-MM-DD HH:MM> ds:backprop B<N> fix=<sha>
```

Update §B `fix cite` column to `<sha>`. Atomic write.

### 9. DONE

Append §S:

```
<YYYY-MM-DD HH:MM> ds:backprop B<N> DONE
```

Release lock. Regen INDEX (B count change).

### 10. Report

```
ds:backprop B<N> → fixed
test=<sha>, fix=<sha>
§V<N> added [or skipped: <reason>]
```

## Auto-trigger from ds:build

If `ds:build` test fails: invoke `ds:backprop` with bug-description = test failure message. Then resume `ds:build` after backprop closes.

## Cite

- FORMAT.md §7 (§V format), §9 (§B format), §11 (§S format), §14 (locks), §16 (resume)
- ADAPTERS.md §cavemem
- agents/dossier-scout.md
