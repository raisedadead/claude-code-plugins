---
name: backprop
description: 'Bug → §V protocol. Traces root cause, decides whether a new §V invariant prevents recurrence. Invoke when the user says "ds:backprop", "bug: <description>", "backprop B<N>", "root-cause this", "add invariant for <X>", or auto-trigger from ds:build on test failure.'
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

Append §S as its own paragraph (blank line before AND after — per FORMAT.md §11; applies to every §S append in this skill):

```
<YYYY-MM-DD HH:MM> ds:backprop <B-or-pending> START
```

Define:

- bug short label (≤80 chars)
- root cause hypothesis (≤2 lines)
- recurrence likelihood (low / mid / high)

If root cause is fuzzy or class-of-bug research needed: **spawn `dossier-scout` subagent** with mission "research <bug-label>: where does this class manifest? Prior occurrences? Test gaps?". If `HAS_CAVEMEM=1`, also query `mcp__cavemem__search` for prior observations of same class.

### 4.5. FLAKE TRIAGE (failing-test bugs, whetstone compose, optional)

Only when the bug IS a failing test. Resolve whetstone's runner deterministically — source checkout (`plugins/whetstone/skills/flaky-test-audit/scripts/flake_runner.sh`) or operator-set `DOSSIER_FLAKE_RUNNER` (same rule as `DOSSIER_RUN_SLICE`, ADAPTERS §whetstone). Unresolvable → skip silently, §S `flake-triage=skipped`, proceed to step 5.

Run the failing test N times (default 5) before characterizing:

```bash
"$FLAKE_RUNNER" 5 "$(mktemp -d)/results.json" <test-command...>
```

Rate = `fails/runs` from the results.json it writes (`{"<name>": {"runs": N, "fails": F}}`). Route:

- `rate=1.0` — always fails across the observed runs: treat as reproducible, proceed to step 5. Label it OBSERVED-deterministic — N=5 can miss low-probability flakes; this is a triage read, not a proof.
- `rate=0.0` — always passes: bug not reproduced; revisit step 4 scope (the existing "if it passes, it isn't characterized" rule).
- `0<r<1` — FLAKY, not a bug: do NOT mint a §V invariant (an invariant for nondeterminism is noise). WRITE the closed §B row NOW — atomic write, step 6's template with closed values: `| B<N> | <bug-label> | nondeterminism (rate=<r>, n runs) | — (quarantine via whetstone:flaky-test-audit) | — (flaky, no fix) |` — then jump to step 9 close-out. Point the operator at `whetstone:flaky-test-audit` for the quarantine flow itself; it runs outside backprop, so backprop's ledger stays the only driver.

Append §S: `ds:backprop <B> flake=<rate> runs=<n>` (the resume row above keys on it).

### 5. WRITE REGRESSION TEST (RED)

Write test that reproduces the bug. Run → must FAIL (RED). If it passes, the bug isn't characterized correctly — revisit step 4.

**Test comments stay phase-agnostic.** No `// Phase N`, `// PH<n>-B<k>`, `// V<n> (Phase <m> / A<k>)` in the test body. Test name and `Refs §B B<N>` in the commit message carry the link. The `marker_guard.py` PreToolUse hook flags these advisorily — it nudges and exits 0, so the write still lands. Treat it as a reminder, not a gate.

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

**Optional — graduate to a write-time guard (recurrence=high only):** if the invariant is a _forbidden code pattern_ (a regex the offending edit would contain), offer to register it so `invariant_guard.py` blocks the bug class at Edit/Write time, exit 2, for every future edit — not merely flags it at the next `ds:check`. Append an entry to `.scratchpad/dossier/.invariant-guards.json` (a JSON list):

```json
{ "id": "V<N>", "pattern": "<forbidden-regex>", "message": "<why this is blocked>", "paths": ["<glob>"] }
```

`paths` scopes the guard (omit = every non-dossier source file). Keep the regex **tight** — a loose pattern blocks legitimate edits, the one failure mode of a write-time guard. The guard is fail-open (missing registry / bad regex / out-of-scope path = no block) and bypassable with `DOSSIER_INVARIANT_GUARD=off` (log the rationale in §S). Only offer this for a genuinely mechanical, regex-expressible class; a semantic invariant stays a §V `check` predicate audited by `ds:check`.

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

## Common shortcuts (and why not)

Every rebuttal here is already stated once in the steps above — collected so the skip-temptation and its answer sit together.

| Tempting shortcut                              | Why not                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Write the fix before a failing test            | §5 — a test that passes pre-fix doesn't characterize the bug. RED first; if it's green, revisit step 4.           |
| Skip the §V invariant ("it's a one-off")       | §7 — only `low`/one-off skips. `high`/systemic MUST add a §V row, or the whole class recurs.                      |
| Green the regression test, skip the full suite | §8 — a scoped GREEN can mask a fresh regression. Run the full (or scoped) suite before committing the fix.        |
| Tag the test with `// PH<n>-B<k>`              | §5 — test name + `Refs §B B<N>` carry the link. `marker_guard.py` nudges advisorily (exit 0) — nothing blocks it. |

## Auto-trigger from ds:build

If `ds:build` test fails: invoke `ds:backprop` with bug-description = test failure message. Then resume `ds:build` after backprop closes.

## Cite

- FORMAT.md §7 (§V format), §9 (§B format), §11 (§S format), §14 (locks), §16 (resume)
- ADAPTERS.md §cavemem
- agents/dossier-scout.md
- hooks/invariant_guard.py (write-time §V guard registry)
