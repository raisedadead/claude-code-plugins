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

### 0. Helpers

DOSSIER.md writes go through the bundled helpers (${CLAUDE_PLUGIN_ROOT}/FORMAT.md §15): `"${CLAUDE_PLUGIN_ROOT}"/cli/ds row-flip <dir> <id> <state> [cite]` flips a **§T** state cell, `"${CLAUDE_PLUGIN_ROOT}"/cli/ds s-append <dir> "<event>"` appends §S. The §S code-fences below show the full line — pass only the text **after** the timestamp, which the script prepends.

**There is no row-flip for §B.** `ds row-flip <dir> B<N> <state>` exits 1 printing `ds row-flip: refuses Bugs rows (no state column — would destroy cells); use ds:backprop` — §B carries `id | bug | root cause | invariant added | fix cite` and no state column at all (FORMAT.md §9, §15). Every §B mutation in this skill is therefore an atomic whole-file write: the row append in step 6, the `invariant added` update in step 7, the `fix cite` update in step 8.

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

A fuzzy root cause or a class-of-bug question: **spawn a `dossier-scout` subagent** with the mission "research <bug-label>: where does this class manifest? Prior occurrences? Test gaps?".

### 4.5. FLAKE TRIAGE (failing-test bugs, whetstone compose, optional)

For a bug that IS a failing test, when `flake-runner` is on `PATH` (whetstone `bin/`, ADAPTERS §whetstone). Not on `PATH` → skip silently, §S `flake-triage=skipped`, proceed to step 5.

Run the failing test N times (default 5) before characterising:

```bash
flake-runner 5 "$(mktemp -d)/results.json" <test-command...>
```

Rate = `fails/runs` from the results.json it writes (`{"<name>": {"runs": N, "fails": F}}`). Route:

- `rate=1.0` — fails on every observed run: reproducible, proceed to step 5. Label it OBSERVED-deterministic — N=5 can miss a low-probability flake, so this is a triage read rather than a proof.
- `rate=0.0` — passes every time: the bug is unreproduced; revisit step 4 scope (the "if it passes, it isn't characterised" rule).
- `0<r<1` — FLAKY rather than a bug. An invariant for nondeterminism is noise, so this branch mints no §V. Write the closed §B row now — atomic write, step 6's template with closed values: `| B<N> | <bug-label> | nondeterminism (rate=<r>, n runs) | — (quarantine via whetstone:flaky-test-audit) | — (flaky, no fix) |` — then jump to step 9 close-out. Point the operator at `whetstone:flaky-test-audit` for the quarantine flow, which runs outside backprop so this ledger stays the only driver.

Append §S: `ds:backprop <B> flake=<rate> runs=<n>` (the resume table keys on it).

### 5. WRITE REGRESSION TEST (RED)

Write the test that reproduces the bug and run it — it must FAIL (RED). A passing test means the bug is characterised wrongly; revisit step 4.

**Test comments stay phase-agnostic.** The link lives in the test name and the commit's `Refs §B B<N>`; the forms `// Phase N`, `// PH<n>-B<k>` and `// V<n> (Phase <m> / A<k>)` belong in neither the test body nor anywhere else in source. That is a convention you keep, and the dossier mod's marker guard covers only part of it:

| comment line           | marker guard                                                |
| ---------------------- | ----------------------------------------------------------- |
| `// PH3-B7`            | denies the Edit/Write with the reason                       |
| `// §V26`, `# §B3`     | denies — same                                               |
| `// Phase 2`           | silent, the write lands                                     |
| `// V3 (Phase 2 / A1)` | silent, the write lands                                     |

Its `MARKER_PATTERNS` are exactly two: a comment line containing `PH\d+-[A-Z]\d+`, or one carrying a `§[VBTSXGZ]\d+` sigil. A bare `Phase|Stage|Step N` is deliberately unmatched — it collides with legitimate `# Step 1: dump` comments — and the V-form carries no `§`, so neither of those two is reported by anything. It is also scoped: in a session whose cwd has no `.scratchpad/dossier` directory it scans nothing, so the guard is silent on all four forms outside a dossier repo. It denies the first two forms; the convention covers the other two.

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

**Optional — graduate to a write-time guard (recurrence=high only):** when the invariant is a _forbidden code pattern_ (a regex the offending edit would contain), offer to register it so the dossier mod's invariant guard denies the bug class at Edit/Write time on every future edit, rather than surfacing it at the next `ds:check`. Append an entry to `.scratchpad/dossier/.invariant-guards.json` (a JSON list):

```json
{ "id": "V<N>", "pattern": "<forbidden-regex>", "message": "<why this is blocked>", "paths": ["<glob>"] }
```

`pattern` is an ECMAScript regex; the Python forms `(?P<name>`, `(?P=name)`, a leading `(?i)` / `(?s)` / `(?m)`, `\A` and `\Z` are translated, and a pattern with any other Python-only syntax is skipped with an advisory. `paths` holds `fnmatch` globs, where `*` also matches `/`, and scopes the guard (omit = every non-dossier source file). Keep the regex **tight**: a loose pattern denies legitimate edits, which is the one failure mode of a write-time guard. The guard is fail-open (missing registry / bad regex / out-of-scope path = no block) and bypassable with `DOSSIER_INVARIANT_GUARD=off` (log the rationale in §S). Reserve it for a genuinely mechanical, regex-expressible class; a semantic invariant stays a §V `check` predicate audited by `ds:check`.

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
| Tag the test with `// PH<n>-B<k>`              | §5 — test name + `Refs §B B<N>` carry the link. The marker guard denies it (opt-out: `DOSSIER_MARKER_GUARD=off`). |

## Auto-trigger from ds:build

A `ds:build` test failure invokes `ds:backprop` with bug-description = the test failure message, then `ds:build` resumes once backprop closes.

## Cite

- FORMAT.md §7 (§V format), §9 (§B format), §11 (§S format), §14 (locks), §16 (resume)
- agents/dossier-scout.md
- engine/guards.ts and `cli/ds invariant-check` (write-time §V guard registry)
