---
name: build
description: Execute a §T task with TDD covenant. Claims row (. → ~), runs tests/edits, commits, refreshes §X, flips row to x with commit cite. Resumable on crash via §S step-log. Invoke when the user says "ds:build T<N>", "build next task", "ds:build --next", "implement T<N>", or "work on <task-description>".
argument-hint: <T-id> | --next | --auto | --resume | --review | --doubt
---

# ds:build — execute a §T task

TDD covenant: RED → GREEN → refactor. One commit per `x`-flip. Resumable.

## Inputs

- `<T-id>` (e.g. `T3`): explicit target.
- `--next`: pick first `state=.` row in §T.
- `--auto`: autonomous mode — loop over actionable §T rows to completion, pausing only on a real decision. See **Autonomous mode** below. Best driven by native `/goal`.
- `--resume`: re-enter incomplete op for the same target (auto-detected from §S; flag is explicit override).
- `--review`: spawn a fresh-context `dossier-reviewer` gate before COMMIT (step 6.5). Auto-on for destructive-class tasks.
- `--doubt`: spawn a fresh-context `whetstone:whetstone-doubter` gate before WORK (step 5.6). Auto-on for design-class tasks — the flag forces doubt on tasks outside the auto class; it is NOT the activation path.

## Steps

### 0. Detect host env

Per ADAPTERS.md. Note `HAS_RTK`, `HAS_FASTEDIT`.

DOSSIER.md writes use the bundled helpers (FORMAT.md §15): `$CLAUDE_PLUGIN_ROOT/hooks/lib-row-flip.sh <dir> <id> <state> [cite]` for §T flips, `$CLAUDE_PLUGIN_ROOT/hooks/lib-s-append.sh <dir> "<event>"` for §S appends. Always present, no detection. The §S code-fence examples below show the full line — pass only the text **after** the timestamp (`lib-s-append.sh` prepends it). `HAS_FASTEDIT` governs SOURCE code edits in step 6 only, never DOSSIER.md.

### 1. Locate live dossier

Per `ds:status` step 1. If none: refuse w/ "no live dossier. ds:new first."

### 2. Resolve target

- `<T-id>` provided: locate row in §T. Refuse if missing or already `x`.
- `--next`: pick the first **actionable** `state=.` row — phase prerequisites satisfied (every row in a lower `P<n>` is `x`). Skip `!`/`?`. Refuse if none actionable (suggest resolving a blocked row).
- Read row: `id`, `P`, `state`, `task`, `cite`, `verify`.

### 3. Acquire lock

Write `<dir>/.ds-lock`:

```json
{"pid": <PID>, "started": "<ISO>", "skill": "ds:build", "target": "<T-id>"}
```

If lock present + active (pid alive + age \<30min): refuse w/ "active op: <skill> pid <pid> since <time>". Caller decides.

If stale: clear + proceed.

### 4. Resume detection

Read §S grep `ds:build <T-id>`. Identify last event:

| Last event     | Resume point                       |
| -------------- | ---------------------------------- |
| (no entries)   | full run from step 5               |
| `START`        | step 5 (re-run safe)               |
| `commit=<sha>` | step 8 (work already committed)    |
| `§X=partial`   | step 8 (retry §X refresh)          |
| `§X=refreshed` | step 9 (flip only)                 |
| `DONE`         | nothing to do; release lock + exit |

### 5. CLAIM

If state still `.`: flip to `~`. Atomic write. Append §S as its own paragraph (blank line before AND after — per FORMAT.md §11; applies to every §S append in this skill):

```
<YYYY-MM-DD HH:MM> ds:build <T-id> START
```

**TaskList mirror:** if a TaskList task exists whose subject starts with `<T-id>` (hydrated by `ds:status`), `TaskUpdate` it to `in_progress`. Keeps the operator's watch surface live. Skip silently if absent.

### 5.5. PIN CHECK (before RED — read-mostly)

Before writing any test or code, ensure the libraries this task introduces are pinned:

- For each package/version the task will add: confirm §I "Pinned deps" already has a resolved entry.
- If a needed lib is missing: `python3 "${CLAUDE_PLUGIN_ROOT}"/hooks/resolve_pins.py <ecosystem>:<pkg>`, append the row to §I via the Edit tool (DOSSIER.md is `.md` → not fastedit), and append §S `ds:build <T-id> pin=<pkg>@<ver>` (or `pin=offline` if unreachable).
- Optionally ground the API SHAPE via the `§context7` adapter (ADAPTERS.md): `resolve-library-id` then `query-docs`; WebFetch the official docs as fallback.

Runs OUTSIDE the RED→GREEN→refactor cycle — a dossier-bookkeeping write (like §X refresh), never a source commit. The model then writes source using the §I version, so the reactive verify hook fires on a warm-cache HIT and stays silent.

### 5.6. DOUBT (design-class gate, pre-WORK)

Runs when `--doubt` is set, or auto for a **design-class** task — no flag required (mirror of `--review` auto-on destructive-class; opt-in alone never activates). design-class = the task implies a design decision (new skill / new agent / new interface or contract / schema / data model / protocol / cross-plugin wiring / architecture choice).

Availability gate per ADAPTERS §whetstone: proceed only if the session agent list has `whetstone:whetstone-doubter`. Absent → append §S `ds:build <T-id> doubt=skipped-absent`, continue to WORK. A spawn that still errors `Agent type ... not found` takes the same skip path. Never block, never prompt.

When present:

1. EXTRACT the intended approach: artifact (what will be built) + contract (§T task text, `verify` predicate, touched §V invariants). No reasoning trail.
1. Spawn `whetstone:whetstone-doubter` (`Agent` tool, artifact-only mission per whetstone's doubt-pass template).
1. Parse the verdict line — `DOUBT: FAILURES | NO FAILURE FOUND` (model-judgment parsed, not computed).
1. FAILURES → classify each finding actionable / not-actionable; fold actionable ones into the approach BEFORE the first RED. A finding that contradicts the §T contract itself: interactive → surface to operator; under `--auto` → PAUSE (`ambiguous`).
1. Append §S: `ds:build <T-id> doubt=<FAILURES:<n>-actionable | clean>`.

**One doubt cycle max per task** — in-build doubt is a gate, not the full doubt-pass loop; a contested design after one cycle escalates instead of looping. Zero actionable findings = say so plainly (doubt-theater guard), never "design validated".

### 6. WORK (TDD)

**Baseline check (before RED):** confirm the existing suite for the touched package is green (or note known-failing). A new RED must be attributable to THIS task — never build atop already-broken ground. Under `--auto`, an unexpected red baseline is a PAUSE (`ambiguous`).

If `verify` column references `V<N>`:

- Locate test for `V<N>` (search §V row's `check` column).
- If test exists + fails: run, capture output.
- If test absent: write test FIRST (RED). Commit (`test(<scope>): add <V-id> check`).

Then implement. Run test → GREEN. Refactor if needed.

If `verify` is shell predicate: run after work, must exit 0. If `verify` is `—`: implement, no test gate. (Discouraged; only for docs / config.)

**run_slice route (whetstone compose, optional):** when whetstone's `run_slice.sh` resolves — this repo's source checkout (`plugins/whetstone/skills/tdd-cycle/scripts/run_slice.sh`) or an operator-set `DOSSIER_RUN_SLICE` path — prove the cycle through it: `run_slice.sh red <test-cmd>` (exits non-zero if the test PASSED), `green <test-cmd>`, `full <suite-cmd>`. Three exit codes replace prose judgment of test output. Unresolvable → raw test commands exactly as above (absent-skip; see ADAPTERS §whetstone for why there is no auto-discovery).

Use `fastedit` if `HAS_FASTEDIT=1` for surgical code edits. Else Edit tool.

**Skill-lint route (whetstone compose, touched SKILL.md only):** lint before COMMIT when whetstone's linter resolves — source checkout (`plugins/whetstone/skills/skill-smith/scripts/lint_skill.py <path>`) or operator-set `DOSSIER_LINT_SKILL` (ADAPTERS §whetstone). Exit 0 gates the commit — same yardstick CI enforces repo-wide. Unresolvable → skip silently, §S `skill-lint=skipped-absent` (CI still lints on push; either plugin alone stays functional).

**Source comments stay phase-agnostic.** Never write `// Phase N`, `// Step N`, `// Stage N`, `// V<n> (Phase <m> / A<k>)`, or `// PH<n>-B<k>` in source or test files. Phase / audit tracking lives in DOSSIER.md §B and §S. Comments in source answer _why_ (workaround refs, non-obvious invariants, upstream-bug links), not _which phase_. The `marker_guard.py` PreToolUse hook watches for this, but it is advisory: it emits a nudge and exits 0, so the write proceeds. Nothing blocks a phase marker at write time — keeping them out is on you.

**Conflict route (whetstone compose, merge-class only):** a plain `git merge` conflict during WORK, with `whetstone:merge-resolve` in the available-skills list, resolves per that skill's process — hunk-by-hunk with intent, then the `verify_clean.sh` proof (baseline `-` marker-mode when no pre-conflict count exists; the step-6 full-suite GREEN gate already floors regressions). §S: `ds:build <T-id> conflict=resolved verify_clean=0`. Skill absent → resolve inline as before, §S `conflict=resolved-inline`. Routing is model-judgment (trigger-phrase match); the verify_clean exit code is the code-enforced part. Conflicts from `rebase` / `cherry-pick` are OUT of this route — their `--continue` creates commits outside step 7's task-scoped discipline: under `--auto` PAUSE (`destructive`); interactive, hand to the operator (standalone `whetstone:merge-resolve` already owns that trigger).

**Stall rule:** the same identical failure twice in a row is a stuck signal, not bad luck — the second occurrence forces a strategy change (different diagnosis, different seam, or scout spawn), never a third identical retry. Retry caps count ATTEMPTS; this rule catches the tighter loop inside them.

If tests fail and root cause unclear: **spawn `dossier-scout` subagent** with mission "root-cause this failure: <test-name>, repo=<repo>, last-passing=<sha>". Use report to guide fix. Scout output is caveman-compressed; main thread aggregates.

If failure suggests a missing invariant: trigger `ds:backprop` flow (don't just patch the symptom).

### 6.5. REVIEW (fresh-context, optional)

Runs when `--review` is set, or auto for a **destructive-class** task (delete / drop / migrate / force / schema). A pre-commit gate — the context that wrote the fix does not get to be the only judge that GREEN is enough. This is the discipline the plugin's own hardening wave used ("two adversarial review rounds"), encoded for downstream builds.

Spawn one `dossier-reviewer` subagent (`Agent` tool, `subagent_type: dossier:dossier-reviewer`) with an **artifact-only** mission — no parent transcript:

- the §T row (task text) + its §V `check` / `verify` predicate,
- the staged diff (`git diff --staged` restricted to the files this task touched),
- the captured test output (the GREEN proof from step 6),
- the repo path.

Read its verdict line:

- `REVIEW: PASS` → proceed to step 7.
- `REVIEW: CHANGES` (≥1 `Critical:`) → address the Critical findings (back to step 6 WORK: fix, re-run to GREEN), then re-review **once**. Still `CHANGES` after that one cycle → under `--auto` PAUSE (`review`); interactive, present the findings and let the operator decide. `Warn:` / `Nit:` never block the commit.

One review cycle max — the reviewer does a single pass and the build retries at most once, so a genuine disagreement escalates instead of looping (addyosmani "doubt theater" cap).

Skip entirely if neither `--review` nor destructive-class — keeps the fast path fast.

Built-in `/review`, `/security-review`, `/simplify` complement (never replace) this artifact-only gate for whole-branch looks — invoke them rather than reimplementing their checks; the `skill_gate.py` hook breadcrumbs their invocation mid-build so the verdict lands in §S instead of evaporating (reminder is non-blocking; honoring it is model-judgment).

### 7. COMMIT

`git add` only files touched by this task. `git commit` with subject pattern:

```
<type>(<scope>): <imperative summary>

<optional body — only if "why" isn't obvious>

Refs §T <T-id>
```

Capture SHA. Append §S:

```
<YYYY-MM-DD HH:MM> ds:build <T-id> commit=<sha>
```

If commit hooks fail: investigate root cause (do NOT `--no-verify`). Fix, retry commit.

### 8. §X REFRESH

For each repo in §X, refresh the row via `$CLAUDE_PLUGIN_ROOT/hooks/lib-x-refresh.sh <dir> "<repo-label>" <repo-path>` — it runs the git probes (current branch, `origin/<branch>..HEAD` ahead-count, nearest tag, push state), rewrites branch/ahead/tag/pushed, preserves the `notes` cell, and writes atomically. Supply each repo's on-disk path (you already know it from the task work). `ahead=no-upstream` + `pushed=no` when the branch has no `origin/` tracking ref.

The `notes` cell is operator free-text — `lib-x-refresh.sh` never touches it. Edit notes manually if they've gone stale.

Multi-repo path-resolution sweep before the loop: parallel Bash calls. The per-row write itself stays with `lib-x-refresh.sh`.

Append §S (one entry summarising the sweep). Emit `§X=refreshed` **only if every repo refreshed cleanly**; if any repo was unreachable or only partially refreshed, emit `§X=partial` instead so the stale guard (8a) fires before the flip:

```
<YYYY-MM-DD HH:MM> ds:build <T-id> §X=refreshed
```

### 8a. Vm.X STALE GUARD

Before flip: check §X freshness. Trigger the guard if the last §X event in §S is `§X=partial`, OR the last `§X=refreshed` is >30min stale, OR §X was never refreshed:

```
⚠ §X stale (>30min, last refresh: <ts>). Proceed with flip? (y/N)
```

- `n` / default: refuse flip, release lock, exit. §S: `§X=stale-refused`.
- `y`: proceed. §S: `§X=stale-confirmed`.

Skip guard entirely if step 8 emitted `§X=refreshed` (all repos clean) within the last 30min.

### 9. FLIP

State `~` → `x`. Update `cite` column with commit SHA. Atomic write. Append §S:

```
<YYYY-MM-DD HH:MM> ds:build <T-id> DONE → x cite=<sha>
```

**TaskList mirror:** `TaskUpdate` the `<T-id>` task to `completed`.

### 10. Regen INDEX

Run `lib-regen-index.sh`. INDEX now reflects updated `T <done>/<total>`.

### 11. Release lock

`rm <dir>/.ds-lock`.

### 12. Report

```
ds:build <T-id> → x
commit=<sha>
§X: <repo> ahead=<n> [+ refreshes]
next: ds:build --next [or remaining T-ids]
```

## Common shortcuts (and why not)

Every rebuttal here is already stated once in the steps above — collected so the skip-temptation and its answer sit together.

| Tempting shortcut                                      | Why not                                                                                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Build on a red baseline ("tests were already failing") | A new RED must trace to THIS task (§6). Under `--auto` a red baseline is a PAUSE (`ambiguous`), not a green light.                      |
| Skip PIN CHECK, code against a remembered API          | §5.5 — unpinned libs drift; the verify hook fires on a cache miss. Pin first, then code against the §I version.                         |
| `git commit --no-verify` past a failing hook           | §7 — a hook failure is a root-cause signal, not a speed bump. Fix it, retry the commit.                                                 |
| Auto-confirm the §X stale guard                        | §8a / Vm.X — stale §X hides push/ahead drift. Under `--auto` it's a PAUSE (`x-stale`), never an auto-`y`.                               |
| Keep retrying a red test past 2 attempts               | `retries-exhausted` PAUSE (2 fixes + one auto-`ds:backprop`). Looping burns turns — escalate the decision.                              |
| Patch the symptom, skip the invariant                  | §6 — if the failure implies a missing invariant, run `ds:backprop`; don't just green the test.                                          |
| Tag source with `// Phase N` to track the work         | Phase tracking lives in §B/§S. `marker_guard.py` exits 2. Source comments answer _why_, never _which phase_.                            |
| Retry the same fix after an identical failure          | Stall rule (§6) — twice-identical output is a stuck signal; change strategy or spawn a scout, never a third identical run.              |
| Blow past the budget ceiling mid-task                  | `budget` PAUSE — land clean: WIP commit, `~` row, §S handoff. An unrecorded tree is the expensive part.                                 |
| Keep correcting the same issue in a stale context      | Failure handling — two failed corrections = contaminated context; reset via `ds:roll` + fresh session, lesson recorded.                 |
| Skip the doubt gate on a design-class task             | §5.6 — design flaws are cheapest pre-RED. Auto-fires without a flag; absent whetstone logs `doubt=skipped-absent`, never a silent skip. |

## Autonomous mode (`--auto`)

Drives the §T ledger to completion without per-task operator approval. The operator steers by watching the TaskList + transcript, not by approving each step.

**Loop — one iteration = one task** (each its own commit + §S DONE, so a crash resumes cleanly):

1. SELECT next actionable row: first `state=.` whose phase prerequisites are satisfied (every row in lower `P<n>` is `x`). Resume any crashed `~` first (step 4). Skip `!` and `?`.
1. No actionable row → §S `ds:build — auto-stop=no-unblocked`, print `DONE`, stop.
1. A PAUSE condition (below) holds → §S `ds:build <id> PAUSE reason=<class>:<detail>`, print `PAUSE: <reason>`, release lock, stop.
1. Else run steps 5–12 verbatim (full covenant + TaskList mirror), then print `CONTINUE` (more `.` remain) or `DONE`.

**Driver — wrap with native `/goal`** so a fresh evaluator keeps the turn going until done:

```
/goal Keep running ds:build --auto until it prints DONE or PAUSE. Stop on PAUSE.
```

`/goal clear` (or Esc) ends the run cleanly. Do NOT use Workflows or `/loop` (background / no mid-run steer / not dependency-ordered).

**Decision boundary — MUST PAUSE (never auto-resolve):**

| class               | trigger                                                                                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blocked`           | row state `!` or `?`                                                                                                                                                                                                                                            |
| `ambiguous`         | `verify=—` on a behaviour-bearing task, or >1 reasonable implementation                                                                                                                                                                                         |
| `destructive`       | task implies delete/drop/migrate/force, schema change, files outside §X repos, or a rebase/cherry-pick conflict hit mid-WORK (§6 conflict route)                                                                                                                |
| `push`              | any `git push` / network-mutating op (never auto-push)                                                                                                                                                                                                          |
| `retries-exhausted` | test still RED after 2 fix attempts + one auto-`ds:backprop`                                                                                                                                                                                                    |
| `review`            | `--review` set and `dossier-reviewer` returns `CHANGES` after one fix cycle (§6.5)                                                                                                                                                                              |
| `x-stale`           | the Vm.X §X-stale guard (§8a) would prompt — do NOT auto-confirm                                                                                                                                                                                                |
| `budget`            | `--max-tasks <n>` (default 10) or a turn ceiling reached → §S `auto-stop=budget`. Clean landing: commit WIP work to the task's files (a `~` row never enters the ds:ship pipeline), row stays `~`, §S handoff note — never stop mid-air with an unrecorded tree |

**Excuse table — the rationalization each class invites, and why it never wins.** Prose rails, model-enforced; the PAUSE itself stays the contract:

| class               | tempting excuse                           | rebuttal                                                                                  |
| ------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `blocked`           | "the `!` row is probably fine to attempt" | `!`/`?` encode a human's unanswered question — attempting it answers FOR the human        |
| `ambiguous`         | "any reasonable reading will do"          | two readings = two different diffs; the operator picks, or the wrong one ships silently   |
| `destructive`       | "it's a small migration"                  | small deletes are still irreversible; blast radius is judged before, not after            |
| `push`              | "pushing saves the operator a step"       | publishing is the operator's irreversible act; nothing network-mutating is ever auto      |
| `retries-exhausted` | "third time's the charm"                  | two failed fixes = the diagnosis is wrong, not the luck; more turns buy noise, not signal |
| `review`            | "the reviewer misread it — overrule"      | a second `CHANGES` after a fix cycle is a genuine disagreement; humans arbitrate those    |
| `x-stale`           | "refresh later, flip now"                 | stale §X hides push/ahead drift; a flip on stale state forges the ledger                  |
| `budget`            | "one more task won't hurt"                | ceilings exist because 'one more' compounds; land clean (commit + §S) and hand back       |

**Rails:** never auto-push · never auto-close (stop at the last `x`-flip; `ds:close` stays an explicit operator step) · per-task lock · atomic writes · `marker_guard` + `verify` hooks stay active during WORK. Every PAUSE writes its reason to §S so `ds:status` shows WHY on return (Vm.14).

## Failure handling

- Lock active: refuse, suggest `--resume` or wait.
- Test fail + can't fix: leave row `~`, release lock, write §S w/ `BLOCKED: <reason>`. Operator decides.
- Two failed corrections on the SAME issue: stop patching in place — the context is contaminated by its own wrong theory. Interactive: offer the operator a reset — `ds:roll` the TaskList, §S the state, re-enter from a fresh context with the lesson written down (resume protocol picks up mid-task). Under `--auto` this never self-triggers: the `retries-exhausted` PAUSE trips at the same threshold.
- Commit fail: leave row `~`, release lock. Operator investigates.
- §X refresh fail (network / repo missing): row updates partial, flag in §S. Triggers Vm.X stale guard (§8a) — operator confirms before flip.

## Cite

- FORMAT.md §8 (§T format), §10 (§X format), §11 (§S format), §14 (locks), §15 (atomic writes), §16 (resume)
- ADAPTERS.md §rtk, §fastedit
- agents/dossier-scout.md (step 6 failure analysis), agents/dossier-reviewer.md (step 6.5 pre-commit gate)
