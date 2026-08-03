---
name: backprop
description: 'Bug → §V protocol. Traces root cause, decides whether a new §V invariant prevents recurrence. Invoke when the user says "ds:backprop", "bug: <description>", "backprop B<N>", "root-cause this", "add invariant for <X>", or auto-trigger from ds:build on test failure.'
argument-hint: <B-id> | <bug-description> | --resume
---

# ds:backprop — bug → invariant protocol

Six steps. Append-only on §B + §V. Resumable.

## Inputs

- `<B-id>` (e.g. `B5`): existing bug row, resume / amend.
- `<bug-description>` free text: new bug, scaffold a §B row from it.
- `--resume`: explicit override of the auto-detected resume point.

## Steps

### 0. Detect host env

Per ADAPTERS.md. Note `HAS_CAVEMEM` (recurrence research benefits).

DOSSIER.md writes go through the bundled helpers (FORMAT.md §15): `$CLAUDE_PLUGIN_ROOT/hooks/lib-row-flip.sh <dir> <id> <state> [cite]` flips §T/§B state cells, `$CLAUDE_PLUGIN_ROOT/hooks/lib-s-append.sh <dir> "<event>"` appends §S. The §S code-fences below show the full line — pass only the text **after** the timestamp, which the script prepends.

### 1. Locate live dossier

Per `ds:status` step 1. Refuse when there is none.

### 2. Acquire lock

Write `<dir>/.ds-lock` with `skill: "ds:backprop", target: "B<N-or-pending>"`.

### 3. Resume detection

Read §S, grep `ds:backprop <target>`:

| Last event     | Resume point                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| (none)         | full run from step 4                                                                                     |
| `START`        | step 4 (re-scope)                                                                                        |
| `flake=<rate>` | 1.0 → step 5; 0.0 → step 4 (re-scope); 0\<r\<1 → write closed §B row (step 4.5 flaky branch) then step 9 |
| `test=<sha>`   | step 6                                                                                                   |
| `§B=B<N>`      | step 7 (invariant decision)                                                                              |
| `§V=V<N>`      | step 8 (fix)                                                                                             |
| `fix=<sha>`    | step 9 (close)                                                                                           |
| `DONE`         | exit                                                                                                     |

### 4. CLAIM + scope

Append §S as its own paragraph (blank line before AND after — per FORMAT.md §11; this holds for every §S append in this skill):

```
<YYYY-MM-DD HH:MM> ds:backprop <B-or-pending> START
```

Define:

- bug short label (≤80 chars)
- root cause hypothesis (≤2 lines)
- recurrence likelihood (low / mid / high)

A fuzzy root cause or a class-of-bug question: **spawn a `dossier-scout` subagent** with the mission "research <bug-label>: where does this class manifest? Prior occurrences? Test gaps?". With `HAS_CAVEMEM=1`, also query `mcp__cavemem__search` for prior observations of the same class.

### 4.5. FLAKE TRIAGE (failing-test bugs, whetstone compose, optional)

For a bug that IS a failing test. Resolve whetstone's runner deterministically — source checkout (`plugins/whetstone/skills/flaky-test-audit/scripts/flake_runner.sh`) or operator-set `DOSSIER_FLAKE_RUNNER` (the `DOSSIER_RUN_SLICE` rule, ADAPTERS §whetstone). Unresolvable → skip silently, §S `flake-triage=skipped`, proceed to step 5.

Run the failing test N times (default 5) before characterising:

```bash
"$FLAKE_RUNNER" 5 "$(mktemp -d)/results.json" <test-command...>
```

Rate = `fails/runs` from the results.json it writes (`{"<name>": {"runs": N, "fails": F}}`). Route:

- `rate=1.0` — fails on every observed run: reproducible, proceed to step 5. Label it OBSERVED-deterministic — N=5 can miss a low-probability flake, so this is a triage read rather than a proof.
- `rate=0.0` — passes every time: the bug is unreproduced; revisit step 4 scope (the "if it passes, it isn't characterised" rule).
- `0<r<1` — FLAKY rather than a bug. An invariant for nondeterminism is noise, so this branch mints no §V. Write the closed §B row now — atomic write, step 6's template with closed values: `| B<N> | <bug-label> | nondeterminism (rate=<r>, n runs) | — (quarantine via whetstone:flaky-test-audit) | — (flaky, no fix) |` — then jump to step 9 close-out. Point the operator at `whetstone:flaky-test-audit` for the quarantine flow, which runs outside backprop so this ledger stays the only driver.

Append §S: `ds:backprop <B> flake=<rate> runs=<n>` (the resume table keys on it).

### 5. WRITE REGRESSION TEST (RED)

Write the test that reproduces the bug and run it — it must FAIL (RED). A passing test means the bug is characterised wrongly; revisit step 4.

**Test comments stay phase-agnostic.** The link lives in the test name and the commit's `Refs §B B<N>`; the forms `// Phase N`, `// PH<n>-B<k>` and `// V<n> (Phase <m> / A<k>)` belong in neither the test body nor anywhere else in source. `marker_guard.py` flags them advisorily — it nudges and exits 0, so the write still lands. Treat it as a reminder rather than a gate.

Commit:

```
test(<scope>): repro <bug-label>

Refs §B B<N>
```

Append §S:

```
<YYYY-MM-DD HH:MM> ds:backprop B<N> test=<sha>
```

A non-testable bug (docs drift, infra config) skips the test commit; note `invariant added` = `— (non-testable)` in §B.

### 6. APPEND §B row

Atomic write of DOSSIER.md with the new §B row:

```
| B<N> | <bug-label> | <root-cause> | <pending> | <test-sha-or-—> |
```

Append §S:

```
<YYYY-MM-DD HH:MM> ds:backprop B<N> §B=B<N>
```

### 7. INVARIANT DECISION

Question: would a new §V invariant catch a recurrence?

| Recurrence | Class    | Decision              |
| ---------- | -------- | --------------------- |
| high       | systemic | YES — append §V row   |
| mid        | local    | maybe — operator call |
| low        | one-off  | NO — patch-only       |

YES → append a §V row pointing at the test from step 5 (or a new check):

```
| V<N> | <invariant claim> | <test-name> |
```

Update the §B `invariant added` column to `V<N>`. Atomic write.

Append §S:

```
<YYYY-MM-DD HH:MM> ds:backprop B<N> §V=V<N>
```

NO → §B `invariant added` stays `—`, and §S notes `§V=skipped:one-off`.

**Optional — graduate to a write-time guard (recurrence=high only):** when the invariant is a _forbidden code pattern_ (a regex the offending edit would contain), offer to register it so `invariant_guard.py` denies the bug class at Edit/Write time with exit 2 on every future edit, rather than surfacing it at the next `ds:check`. Append an entry to `.scratchpad/dossier/.invariant-guards.json` (a JSON list):

```json
{ "id": "V<N>", "pattern": "<forbidden-regex>", "message": "<why this is blocked>", "paths": ["<glob>"] }
```

`paths` scopes the guard (omit = every non-dossier source file). Keep the regex **tight**: a loose pattern denies legitimate edits, which is the one failure mode of a write-time guard. The guard is fail-open (missing registry / bad regex / out-of-scope path = no block) and bypassable with `DOSSIER_INVARIANT_GUARD=off` (log the rationale in §S). Reserve it for a genuinely mechanical, regex-expressible class; a semantic invariant stays a §V `check` predicate audited by `ds:check`.

### 8. FIX (GREEN)

Implement the fix. Regression test → GREEN. Full suite (or scoped) → no regressions.

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

Update the §B `fix cite` column to `<sha>`. Atomic write.

### 9. DONE

Append §S:

```
<YYYY-MM-DD HH:MM> ds:backprop B<N> DONE
```

Release the lock. Regen INDEX (the B count changed).

### 10. Report

```
ds:backprop B<N> → fixed
test=<sha>, fix=<sha>
§V<N> added [or skipped: <reason>]
```

## Common shortcuts (and why not)

Each rebuttal appears once in the steps above; they are collected here so the temptation and its answer sit together.

| Tempting shortcut                              | Why not                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Write the fix before a failing test            | §5 — a test that passes pre-fix doesn't characterize the bug. RED first; if it's green, revisit step 4.           |
| Skip the §V invariant ("it's a one-off")       | §7 — only `low`/one-off skips. `high`/systemic MUST add a §V row, or the whole class recurs.                      |
| Green the regression test, skip the full suite | §8 — a scoped GREEN can mask a fresh regression. Run the full (or scoped) suite before committing the fix.        |
| Tag the test with `// PH<n>-B<k>`              | §5 — test name + `Refs §B B<N>` carry the link. `marker_guard.py` nudges advisorily (exit 0) — nothing blocks it. |

## Auto-trigger from ds:build

A `ds:build` test failure invokes `ds:backprop` with bug-description = the test failure message, then `ds:build` resumes once backprop closes.

## Cite

- FORMAT.md §7 (§V format), §9 (§B format), §11 (§S format), §14 (locks), §16 (resume)
- ADAPTERS.md §cavemem
- agents/dossier-scout.md
- hooks/invariant_guard.py (write-time §V guard registry)
