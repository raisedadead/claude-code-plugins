---
name: build
description: Execute a §T task with TDD covenant. Resumable on crash. Invoke when the user says "ds:build T<N>", "build next task", "ds:build --next", "implement T<N>", or "work on <task-description>".
argument-hint: <T-id> | --next | --auto | --resume | --review | --doubt
---

# ds:build — execute a §T task

TDD covenant: RED → GREEN → refactor. One commit per `x`-flip. Resumable.

## Inputs

- `<T-id>` (e.g. `T3`): explicit target.
- `--next`: pick the first frontier row — `state=.`, `needs` all `x`, `who=A`.
- `--auto`: autonomous mode — loop over actionable §T rows to completion, pausing only on a real decision. See **Autonomous mode** below. Best driven by native `/goal`.
- `--resume`: re-enter incomplete op for the same target (auto-detected from §S; flag is explicit override).
- `--review`: spawn a fresh-context `dossier-reviewer` gate before COMMIT (step 6.5). Auto-on for destructive-class tasks.
- `--doubt`: spawn a fresh-context `whetstone:whetstone-doubter` gate before WORK (step 5.6). Auto-on for design-class tasks — the flag forces doubt on tasks outside the auto class; it is NOT the activation path.

## Steps

### 0. Helpers

DOSSIER.md writes use the bundled helpers (${CLAUDE_PLUGIN_ROOT}/FORMAT.md §15): `"${CLAUDE_PLUGIN_ROOT}"/cli/ds row-flip <dir> <id> <state> [cite]` for §T flips, `"${CLAUDE_PLUGIN_ROOT}"/cli/ds s-append <dir> "<event>"` for §S appends. Always present, no detection. The §S code-fence examples below show the full line — pass only the text **after** the timestamp (`ds s-append` prepends it).

### 1. Locate live dossier

Per `ds:status` step 1. If none: refuse w/ "no live dossier. ds:new first."

### 2. Resolve target

- `<T-id>` provided: locate row in §T. Refuse if missing or already `x`.
- `--next`: pick the first **frontier** row — `state=.`, every id in its `needs` cell already `x`, and `who=A`. Skip `!`/`?`, and leave `who=H` to the operator. Refuse if none actionable (suggest resolving a blocked row).
- Read row: `id`, `state`, `who`, `task`, `needs`, `cite`, `verify`.

### 3. Acquire lock

Write `<dir>/.ds-lock`:

```json
{"pid": <PID>, "started": "<ISO>", "skill": "ds:build", "target": "<T-id>"}
```

If lock present + active (pid alive + age \<30min): refuse w/ "active op: <skill> pid <pid> since <time>". Caller decides.

If stale: clear + proceed.

### 4. Resume detection

Read §S grep `ds:build <T-id>`. Identify last event:

| Last event                 | Resume point                                                         |
| -------------------------- | -------------------------------------------------------------------- |
| (no entries)               | full run from step 5                                                 |
| `START`                    | step 5 (re-run safe)                                                 |
| `delegate=`                | a clean tree (item 1's check) goes to step 6.2 item 2; otherwise, after `red=skipped-green` or with a `—` verify cell, item 4; otherwise item 3 on the builder's test |
| `red=skipped-green`        | step 6.2 item 2, the `—` mission, with a fresh builder               |
| `red=`                     | step 6.2 item 3, the GREEN half, with a fresh builder                |
| `rebuild=1`                | step 6.2 item 4 on the tree as it stands                             |
| `review=PASS`              | step 7 on the staged diff                                            |
| `review=CHANGES`           | step 6.5's `CHANGES` path; with an earlier `review=CHANGES` in §S, its after-one-cycle branch; a delegated row goes to step 6.2 item 5, where one after `rebuild=1` is a PAUSE (`review`) |
| `PAUSE`                    | the operator answers the §S reason first, then the event before it   |
| `commit=<sha>`             | step 8 (work already committed)                                      |
| `§X=partial`               | step 8 (retry §X refresh)                                            |
| `§X=refreshed`             | step 9 (flip only)                                                   |
| `DONE`                     | nothing to do; release lock + exit                                   |

### 5. CLAIM

If state still `.`: flip to `~`. Atomic write. Append §S as its own paragraph (blank line before AND after — per FORMAT.md §11; applies to every §S append in this skill):

```
<YYYY-MM-DD HH:MM:SS> ds:build <T-id> START
```

**TaskList mirror:** if a TaskList task exists whose subject starts with `<T-id>` (hydrated by `ds:status`), `TaskUpdate` it to `in_progress`. Keeps the operator's watch surface live. Skip silently if absent.

### 5.5. PIN CHECK (before RED — read-mostly)

Before writing any test or code, ensure the libraries this task introduces are pinned:

- For each package/version the task will add: confirm §I "Pinned deps" already has a resolved entry.
- If a needed lib is missing: `"${CLAUDE_PLUGIN_ROOT}"/cli/ds resolve-pins <ecosystem>:<pkg>`, append the row to §I via the Edit tool, and append §S `ds:build <T-id> pin=<pkg>@<ver>` (or `pin=offline` if unreachable, or if `cli/ds` exits 69 or 70).
- When the task calls a library API this session has not read, ground its shape with the `§context7` adapter (${CLAUDE_PLUGIN_ROOT}/ADAPTERS.md): `resolve-library-id` then `query-docs`. With no context7 tools in the session, WebFetch the official docs.

Runs OUTSIDE the RED→GREEN→refactor cycle: it lands as a dossier-bookkeeping write, the same class as the §X refresh. The model then writes source using the §I version, so the reactive verify hook fires on a warm-cache HIT and stays silent.

### 5.6. DOUBT (design-class gate, pre-WORK)

Runs when `--doubt` is set, or auto for a **design-class** task — no flag required (mirror of `--review` auto-on destructive-class; opt-in alone never activates). design-class = the task implies a design decision (new skill / new agent / new interface or contract / schema / data model / protocol / cross-plugin wiring / architecture choice).

Availability gate per ADAPTERS §whetstone: proceed only if the session agent list has `whetstone:whetstone-doubter`. Absent → append §S `ds:build <T-id> doubt=skipped-absent`, continue to WORK. A spawn that still errors `Agent type ... not found` takes the same skip path. The build continues either way, with no prompt to the operator.

When present:

1. EXTRACT the intended approach: artifact (what will be built, with its `PROBE: <command> → <output line>` lines) + contract (§T task text, `verify` predicate, touched §V invariants). No reasoning trail. The contract also states: each host call the design depends on (a host API, a spawned CLI, an MCP tool, a path the host installs) has a `PROBE:` line from a real session; a host call without one is a FAILURE.
1. Spawn `whetstone:whetstone-doubter` (`Agent` tool, artifact-only mission per whetstone's doubt-pass template). Pass no `model`, so this break mission runs on the agent's own `opus` (RESEARCH D29).
1. Parse the verdict line — `DOUBT: FAILURES | NO FAILURE FOUND` (model-judgment parsed, not computed).
1. FAILURES → classify each finding actionable / not-actionable; fold actionable ones into the approach BEFORE the first RED. A finding that contradicts the §T contract itself: interactive → surface to operator; under `--auto` → PAUSE (`ambiguous`).
1. Append §S: `ds:build <T-id> doubt=<FAILURES:<n>-actionable | clean>`.

**One doubt cycle max per task** — in-build doubt is a gate, not the full doubt-pass loop; a contested design after one cycle escalates instead of looping. Zero actionable findings = report exactly that, in those words (doubt-theater guard): the doubter found nothing actionable.

### 6. WORK (TDD)

**Baseline check (before RED):** confirm the existing suite for the touched package is green (or note known-failing). A new RED must be attributable to THIS task, so start from a green baseline. Under `--auto`, an unexpected red baseline is a PAUSE (`ambiguous`).

A row whose task cell carries `route=delegate` or `route=pi` goes to step 6.2 after this baseline, not to the steps below.

If `verify` column references `V<N>`:

- Locate test for `V<N>` (search §V row's `check` column).
- If test exists + fails: run, capture output.
- If test absent: write test FIRST (RED). Commit (`test(<scope>): add <V-id> check`).

Then implement. Run test → GREEN. Refactor if needed.

If `verify` is shell predicate: run after work, must exit 0. If `verify` is `—`: implement, no test gate. (Discouraged; only for docs / config.)

**run-slice route (whetstone compose, when on `PATH`):** when `run-slice` is on `PATH` — whetstone ships it in `bin/` (ADAPTERS §whetstone) — prove the cycle through it: `run-slice red <test-cmd>` (exits non-zero if the test PASSED), `green <test-cmd>`, `full <suite-cmd>`. Three exit codes replace prose judgment of test output. Not on `PATH` → raw test commands exactly as above.

**Skill-lint route (whetstone compose, touched SKILL.md only):** lint before COMMIT when `lint-skill` is on `PATH` (whetstone `bin/`, ADAPTERS §whetstone): `lint-skill <path>`; `whetstone:skill-smith` holds the rubric behind each `FAIL` line. Commit only on exit 0 — model-judgment, since no hook runs `lint-skill` at commit. Not on `PATH` → skip silently, §S `skill-lint=skipped-absent`.

**Source comments stay phase-agnostic.** A comment in source or test answers _why_: a workaround ref, a non-obvious invariant, an upstream-bug link. Phase and audit tracking live in DOSSIER.md §B and §S, which hold the whole record — so `// Phase N`, `// Step N`, `// Stage N`, `// V<n> (Phase <m> / A<k>)` and `// PH<n>-B<k>` stay out of every source and test file, and a comment that would carry one is rewritten as a _why_ or dropped. The dossier mod's marker guard denies the audit-id and `§`-cite forms on Edit/Write; the bare `Phase N` / `Step N` forms pass it, and this paragraph is what keeps them out.

**Conflict route (whetstone compose, merge-class only):** a plain `git merge` conflict during WORK resolves hunk by hunk, keeping the intent of both sides. Then, when `verify-clean` is on `PATH` (whetstone `bin/`, ADAPTERS §whetstone), prove it: `verify-clean <root> <baseline|-> <count-command...>` exits 0 only with zero conflict markers under `<root>` and a pass count at or above the baseline; pass `-` when no pre-conflict count exists, since the step-6 full-suite GREEN gate already floors regressions. §S: `ds:build <T-id> conflict=resolved verify_clean=0`. Not on `PATH` → §S `conflict=resolved-inline`. The `verify-clean` exit code is the code-enforced part; the hunk choices are model-judgment. Conflicts from `rebase` / `cherry-pick` are OUT of this route — their `--continue` creates commits outside step 7's task-scoped discipline: under `--auto` PAUSE (`destructive`); interactive, hand to the operator.

**Stall rule:** an identical failure twice running is a stuck signal rather than bad luck. The second occurrence forces a strategy change before the third attempt — a different diagnosis, a different seam, or a scout spawn. Retry caps count ATTEMPTS; this rule catches the tighter loop inside them.

**Repeat workaround:** a second workaround for the same tool defect is a bug, not a habit. Before the commit that carries it, write a §B row for the defect, then run `ds:backprop` on it. Seeing that two workarounds share a defect is model-judgment; no hook checks it.

Tests failing with an unclear root cause: **spawn a `dossier-scout` subagent** with the mission "root-cause this failure: <test-name>, repo=<repo>, last-passing=<sha>", and let its report guide the fix.

A failure that implies a missing invariant: run `ds:backprop`, which registers the invariant first and greens the symptom under it. Any test failure that is a bug, not this task's new RED, gets the same hand-off: name `ds:backprop <bug>` before the fix, so the bug can leave an invariant behind.
A test that fails and then passes on a rerun with no change is a flake signal. When `flake-runner` is on `PATH` (whetstone `bin/`), measure it before any fix: `FLAKE_TEST_NAME=<test-id> flake-runner 10 "$(mktemp -d)/results.json" <test-command>` prints `FLAKY <fails>/<runs> <rate> <test-id>` for a rate between 0 and 1. A flaky test is a `ds:backprop` FLAKY branch, not a fix in this task.

### 6.2. DELEGATE (a `route=delegate` row)

The operator marks a row for a builder by writing `route=delegate` in its task cell, as a bare word outside backticks; a marker in backticks reads as prose. The build reads the marker and only the operator writes one, and `ds delegation-check <dossier-dir>` exits 1 when a marked or delegated `x` row has no review line, a row has two rebuilds, or a started `route=pi` row has no approval. Such a row is built by one `dossier-builder` subagent; the baseline, the routes and the failure rules of step 6 still bind the main thread. A `route=pi` row needs the operator's approval in §S, `ds:build <T-id> route=pi approved="<operator verbatim>"`, and the Pi route is not built yet: under `--auto` PAUSE (`ambiguous`); interactively, hand it to the operator.

Run every git command in this step from the repo root; the `.` pathspec covers only the current directory.

1. **Clean tree.** `git status --porcelain -uall -- . ':(exclude).scratchpad'` must print nothing, so every later change is the builder's. Otherwise PAUSE (`ambiguous`).
1. **Spawn for RED.** Rewrite `.ds-lock` with a fresh `started`, then spawn one `Agent` with `subagent_type: dossier:dossier-builder` and no `model`, so the builder runs on Sonnet at medium effort, as its definition sets. Append §S `ds:build <T-id> delegate=dossier-builder`. The mission is artifact-only, as in step 6.5. A verify cell of `—` has no RED: its mission opens with `Build one task in <repo path>.`, ends with `Now: make the change.`, `OUTPUT: the changed files, or one QUESTION: line.` and `DONE: the change is in the files`, and goes to item 4. Run any other verify command before the spawn; when it already exits 0, the row has no RED either: append §S `ds:build <T-id> red=skipped-green` and use the `—` mission. Every other row gets:

   ```
   Build one task in <repo path>.
   Task: <§T task text>
   Verify: <the verify cell's command, or the check of the §V row it names>
   Invariants: <each touched §V row with its check>
   Design: <the notes= path from §S `ds:new signoff=`; omit this line when §S has none>
   Rules: change only the files this task needs. Leave the commit to me, and
   leave .scratchpad/ and DOSSIER.md as they are. Add no comment that tracks a phase, a step or a task id.
   Now: write the failing test and run it.
   OUTPUT: the test command and its output verbatim, then the changed files;
   or exactly one line `QUESTION: <question>` when the task cannot be built as written.
   DONE: <the test command> fails for the missing behaviour
   ```

1. **RED, then GREEN.** A `QUESTION:` line is a PAUSE (`ambiguous`) with the question in §S; interactively, put it to the operator. Otherwise run the verify command yourself, or, when it does not run the new test, the builder's test command after you read it and see that it only runs the test file the builder wrote. It must fail for the missing behaviour (`run-slice red` when on `PATH`); a pass, or a failure for another cause, is a PAUSE (`ambiguous`). Append §S `ds:build <T-id> red=<n>-failed`, with `<n>` the failing-test count the RED output prints. Then `SendMessage` the same builder: `Implement now. OUTPUT: the GREEN output verbatim with its command, then the changed files. DONE: <verify command> exits 0`. Without `SendMessage`, or on a resume where the builder is gone, spawn a fresh builder with the mission up to its `Rules:` line, then `The failing test is in place: <command>. Implement now.` and the `OUTPUT:` and `DONE:` lines of that message.
1. **Return.** Rewrite `.ds-lock`. A `QUESTION:` line is a PAUSE (`ambiguous`), as in item 3. Otherwise the builder's report is advisory: re-run the verify command (none for `—`) and the touched package's full suite yourself, and use that as the GREEN proof. A red result goes back to the builder once, as a rebuild under item 5; the main thread does not write the code. Stage the tracked changes with `git add -u -- . ':(exclude).scratchpad'`, and only the untracked files the builder's changed-files list names. Compare one file at a time against `git status --porcelain -uall -- . ':(exclude).scratchpad'`; an untracked file it did not name is a PAUSE (`ambiguous`). Give step 6.5 the whole `git diff --staged`.
1. **Review, one rebuild.** Step 6.5 runs on every delegated row, and this item replaces its `CHANGES` path. `REVIEW: CHANGES` → spawn a fresh `dossier:dossier-builder` with `model: opus`, so the one rebuild runs on the stronger model. Its mission is item 2's mission up to the `Rules:` line, then the Critical findings. A row with a RED adds `The failing test is in place: <command>. Fix these. Keep the test unless a finding names it. Implement now.`, `OUTPUT: the GREEN output verbatim with its command, then the changed files.` and `DONE: <verify command> exits 0`. A row with no RED adds `Fix these. Now: make the change.`, `OUTPUT: the changed files, or one QUESTION: line.` and `DONE: the change is in the files`. Append §S `ds:build <T-id> rebuild=1`, then run items 4 and 5 again. A second `CHANGES`, or a second red result, is a PAUSE (`review`).
1. **Commit** (step 7) from the main thread.

A builder that runs past 30 minutes leaves a lock that FORMAT.md §14 calls stale, so start no other `ds:build` on this dossier while it runs. No step runs `ds delegation-check`. The operator who writes the first `route=delegate` marker in a wave also adds the done-when row `| <n> | \`<plugin>/cli/ds delegation-check <dossier-dir>\` | exit 0 guard |` to the wave contract, so `ds:converge` runs it.

### 6.5. REVIEW (fresh-context, optional)

Runs when `--review` is set, auto for a **destructive-class** task (delete / drop / migrate / force / schema), and on every delegated row (step 6.2). A pre-commit gate: a second context judges whether GREEN is enough, which is the discipline this plugin's own hardening wave used.

Spawn one `dossier-reviewer` subagent (`Agent` tool, `subagent_type: dossier:dossier-reviewer`) with an **artifact-only** mission — no parent transcript:

- the §T row (task text) + its §V `check` / `verify` predicate,
- the staged diff (`git diff --staged` restricted to the files this task touched; for a delegated row, the whole staged diff),
- the captured test output (the GREEN proof from step 6),
- the repo path,
- the wave's design notes: the `notes=` path from the §S `ds:new signoff=` line, when §S has one; with no such line the mission names no design file.

Read its verdict line:

- `REVIEW: PASS` → proceed to step 7.
- `REVIEW: CHANGES` (≥1 `Critical:`) → address the Critical findings (back to step 6 WORK: fix, re-run to GREEN; a delegated row follows step 6.2 item 5 instead), then re-review **once**. Still `CHANGES` after that one cycle → under `--auto` PAUSE (`review`); interactive, present the findings and let the operator decide. `Warn:` / `Nit:` never block the commit.

One review cycle max — the reviewer does a single pass and the build retries at most once, so a genuine disagreement escalates instead of looping (addyosmani "doubt theater" cap).

Append §S either way, as the doubt gate at §5.6 does — `ds:build <T-id> review=<PASS:<n>-warn | CHANGES:<n>-critical>`. The breadcrumb is what keeps this gate's verdict on the record; without it, the one artifact-only reviewer leaves no trace.

Skip entirely if neither `--review`, nor destructive-class, nor a delegated row (step 6.2) — keeps the fast path fast. A skipped review on a behaviour-bearing task still leaves one line in the step-12 report: `review: skipped — /dossier:build <T-id> --review runs the fresh-context reviewer`, so the gate stays visible.

Built-in `/code-review` (alias `/review`), `/security-review` and `/simplify` sit alongside this artifact-only gate and cover whole-branch looks it cannot — invoke them rather than reimplementing their checks; the dossier mod's skill gate breadcrumbs their invocation mid-build so the verdict lands in §S instead of evaporating (reminder is non-blocking; honoring it is model-judgment).

### 7. COMMIT

`git add` only files touched by this task.

**Tiger route (whetstone compose, every build commit).** Measure the column budget of the lines this task ADDS, between the `git add` and the `git commit` — never before the `git add`, because the checker reads `git diff --cached` and an empty index always reports clean. Resolve the checker as `tiger-check` on `PATH`: whetstone ships it in `bin/`, which Claude Code adds to the Bash tool's `PATH` while that plugin is enabled. It carries no flag, so D7's failure mode — a gate the operator never turns on — misses this one. The other failure mode lands: no hook fires on `git commit`, so running this at all is model-judgment. The verdict is computed; arriving at it is not. Read the reach caveat below before treating it as universal.

**Read the verdict line before the exit code.** A broken install makes the interpreter behind the wrapper exit 2 — the number the checker uses for NAG — so a code-only reading reports a result for a check that never ran. Require a `TIGER:` line in stdout. No such line means unresolvable, whatever the number was.

With that line present, route on the exact exit code rather than on "non-zero": `0` clean, commit — the line carries how many files were examined and how many were staged but skipped, and a bare `CLEAN 0 files` with no skipped count means no path with added lines was staged — an empty index, or a deletion-only commit; `CLEAN 0 files, 3 skipped` is an ordinary docs-only commit · `2` the built-in 100-column fallback was exceeded — print the offences and commit; `whetstone:tiger-style` reads them against the shape rules · `1` a limit the repo itself declared was exceeded, which is a `tiger` PAUSE under `--auto` and an operator decision interactively · `64` the path is not a work tree, treat as unresolvable. Unresolvable → skip silently.

**Where this actually resolves.** A consumer gets `tiger-check` on `PATH` whenever whetstone is enabled, so the route reaches them without configuration — `bin/` is the supported way across plugins, since `${CLAUDE_PLUGIN_ROOT}` names only the running plugin's own root. With whetstone absent the command is simply not on `PATH`: record `tiger=skipped-absent` and continue, the same absent-skip every composed route uses.

§S records non-clean runs only — `tiger=block@<n>`, `tiger=nag@<n>`, or `tiger=skipped-absent`. A clean run writes nothing; logging every uneventful pass buries the events that matter.

Then `git commit` with subject pattern:

```
<type>(<scope>): <imperative summary>

<optional body — only if "why" isn't obvious>
```

Capture SHA. Append §S:

```
<YYYY-MM-DD HH:MM:SS> ds:build <T-id> commit=<sha>
```

If commit hooks fail: a hook failure is a signal about the change, so investigate the root cause, fix it, and retry the same commit — never `--no-verify` past it. One flag disarms every gate the step just ran, and nothing this plugin ships denies it.

### 8. §X REFRESH

For each repo in §X, refresh the row via `"${CLAUDE_PLUGIN_ROOT}"/cli/ds x-refresh <dir> "<repo-label>" <repo-path>` — it runs the git probes (current branch, `origin/<branch>..HEAD` ahead-count, nearest tag, push state), rewrites branch/ahead/tag/pushed, preserves the `notes` cell, and writes atomically. Supply each repo's on-disk path (you already know it from the task work). `ahead=no-upstream` + `pushed=no` when the branch has no `origin/` tracking ref.

The `notes` cell is operator free-text — `ds x-refresh` never touches it. Edit notes manually if they've gone stale.

Multi-repo path-resolution sweep before the loop: parallel Bash calls. The per-row write itself stays with `ds x-refresh`.

Append §S (one entry summarising the sweep). Emit `§X=refreshed` **only if every repo refreshed cleanly**; if any repo was unreachable or only partially refreshed, emit `§X=partial` instead so the stale guard (8a) fires before the flip:

```
<YYYY-MM-DD HH:MM:SS> ds:build <T-id> §X=refreshed
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
<YYYY-MM-DD HH:MM:SS> ds:build <T-id> DONE → x cite=<sha>
```

**TaskList mirror:** `TaskUpdate` the `<T-id>` task to `completed`, when step 5 found one.

### 10. Regen INDEX

Run `ds regen-index`. INDEX now reflects updated `T <done>/<total>`.

### 11. Release lock

`rm <dir>/.ds-lock`.

### 12. Report

```
ds:build <T-id> → x
commit=<sha>
§X: <repo> ahead=<n> [+ refreshes]
next: ds:build --next [or remaining T-ids]
```

## Common shortcuts and what holds instead

Every answer here is already stated once in the steps above — collected so the skip-temptation and the move that answers it sit together.

| Tempting shortcut                                      | What holds instead                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build on a red baseline ("tests were already failing") | A new RED must trace to THIS task (§6). Under `--auto` a red baseline is a PAUSE (`ambiguous`), not a green light.                               |
| Skip PIN CHECK, code against a remembered API          | §5.5 — unpinned libs drift; the verify hook fires on a cache miss. Pin first, then code against the §I version.                                  |
| `git commit --no-verify` past a failing hook           | §7 — a hook failure is a root-cause signal, not a speed bump. Fix it, retry the commit.                                                          |
| Auto-confirm the §X stale guard                        | §8a / Vm.X — stale §X hides push/ahead drift. Under `--auto` it is a PAUSE (`x-stale`) and the operator answers the prompt.                      |
| Keep retrying a red test past 2 attempts               | `retries-exhausted` PAUSE (2 fixes + one auto-`ds:backprop`). Looping burns turns — escalate the decision.                                       |
| Patch the symptom, skip the invariant                  | §6 — if the failure implies a missing invariant, run `ds:backprop` to register it, then green the test under it.                                 |
| Tag source with `// Phase N` to track the work         | Phase tracking lives in §B/§S. The marker guard passes a bare `Phase N`. Source comments answer _why_; §B/§S answer _which phase_.               |
| Retry the same fix after an identical failure          | Stall rule (§6) — twice-identical output is a stuck signal; change strategy or spawn a scout before the third attempt.                           |
| Blow past the budget ceiling mid-task                  | `budget` PAUSE — land clean: WIP commit, `~` row, §S handoff. An unrecorded tree is the expensive part.                                          |
| Keep correcting the same issue in a stale context      | Failure handling — two failed corrections = contaminated context; reset via a §S handoff + fresh session, lesson recorded.                       |
| Skip the doubt gate on a design-class task             | §5.6 — design flaws are cheapest pre-RED. Auto-fires without a flag; absent whetstone logs `doubt=skipped-absent`, so the skip is on the record. |

## Autonomous mode (`--auto`)

Drives the §T ledger to completion without per-task operator approval. The operator steers by watching the TaskList + transcript, not by approving each step.

**Loop — one iteration = one task** (each its own commit + §S DONE, so a crash resumes cleanly):

1. PUSH ROWS: a frontier `who=H` row whose task names a push is done once each §X repo it names has `git -C <repo-path> rev-list --count @{u}..HEAD` at `0` after a `git fetch`. Run the CI watch below on it, then flip it `x` with the pushed SHA as cite and §S `ds:build <id> operator=pushed`. Recognising a push row is model-judgment; every other `who=H` row stays the operator's to flip.
1. SELECT next actionable row: the first frontier row with `who=A` — `state=.`, every id in its `needs` cell already `x`, and the agent able to finish it alone. Resume any crashed `~` first (step 4). Leave the remaining `who=H` rows, and `!` and `?`, to the operator.
1. No actionable row → §S `ds:build — auto-stop=no-unblocked`, print `DONE`, then the hand-off below, stop.
1. A PAUSE condition (below) holds → §S `ds:build <id> PAUSE reason=<class>:<detail>`, print `PAUSE: <reason>`, release lock, print the hand-off below, stop.
1. Else run steps 5–12 verbatim (full covenant + TaskList mirror), then print `CONTINUE` (more `.` remain) or `DONE`.

**Hand-off.** Run `"${CLAUDE_PLUGIN_ROOT}"/cli/ds handoff <dir>` and print its lines verbatim as the last lines of the turn. It computes them from §T: the `/goal` and `/dossier:build --auto` lines when an agent row can run after the operator's next step (each `after:` line names that step), else the operator's step (`operator:`, `answer:`) or `close:` when every row is `x`. A push row whose latest §S line is a `ci` PAUSE gets `ci: <id> <detail>` in place of its `after:` or `operator:` line. An agent row whose latest `ds:build <id>` line in §S is a PAUSE of another class gets `answer: <id> PAUSE <reason>` and no goal; the goal lines follow only when another agent row can run. A `budget` PAUSE asks nothing, so its row resumes under the goal lines. The goal condition carries the current time to the second, so §S lines from earlier runs cannot satisfy it. After `DONE`, when no goal is active, the output holds a `/goal` line and the `ProposeGoal` tool is present, also call it with that condition. After a `PAUSE` the operator answers first, so only print the lines.

**CI watch after a push.** For each §X repo the push row names: the SHA is `git -C <repo-path> rev-parse @{u}`, the commit the push sent, and the GitHub name is `gh repo view <url> --json nameWithOwner --jq .nameWithOwner` with `<url>` from `git -C <repo-path> remote get-url origin`. List every run with `gh run list --repo <repo> --commit <sha> --json databaseId,status,conclusion,url`; while the list is empty, list again for up to 60 s. Watch each run with `gh run watch <id> --repo <repo> --exit-status` in the foreground, then read the verdict from `gh run view <id> --repo <repo> --json status,conclusion,url`. The watch's exit code alone is no verdict: a Bash timeout also exits non-zero. A run whose `status` is not yet `completed` gets another watch. Every `conclusion` `success`, `skipped` or `neutral` → flip. Any other conclusion → PAUSE `ci:<url>`. Still no run after 60 s → §S `ds:build <id> ci=none` and flip. `gh` absent or failing → PAUSE `ci:gh-unavailable`.

**Driver — native `/goal`.** A fresh evaluator keeps the turn going until done. Start `--auto` by setting it yourself: when no goal is active and the `ProposeGoal` tool is present, call it with the condition of the `/goal` line that `ds handoff <dir>` prints. When it prints no `/goal` line because the answered row's PAUSE is still its latest `ds:build <id>` line, run `ds handoff <dir>` again after that row's START line:

```
§S of <slug> records a ds:build PAUSE or auto-stop line stamped after <YYYY-MM-DD HH:MM:SS>.
```

The judge reads the transcript and no files, so it sees a stop line only when a tool result prints it: write every PAUSE and auto-stop line with `ds s-append`, which prints the line it wrote. Whether the judge rules the condition met is model-judgment.

`ask_user` stays at its default (`true`): the operator approves the goal once, then the loop needs no further turn from them. `ProposeGoal` absent → print the two lines of `ds handoff` that the operator types, in this order: `/goal <condition>` first, then `/dossier:build --auto`. Continue the loop in this turn. Proposing the goal is model-judgment; the evaluator that holds it is the harness.

`/goal clear` (or Esc) ends the run cleanly. `/goal` is the driver because it runs in the foreground, takes mid-run steer, and respects dependency order — Workflows and `/loop` give up all three, so the `--auto` loop stays on `/goal`.

An operator-written goal such as "finish the dossier" cannot pass an open `who=H` row, and the model cannot clear a goal (anthropics/claude-code#92242). When such a goal is active and the frontier holds only `who=H` rows, say once that the goal waits on the operator and that `/goal clear` ends it. Then end each later turn in one line with no tool call. Prefer the `--auto` condition above, which ends on PAUSE.

**Decision boundary — MUST PAUSE, the operator resolves these:**

| class               | trigger                                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blocked`           | row state `!` or `?`                                                                                                                                                                                              |
| `ambiguous`         | `verify=—` on a behaviour-bearing task, or >1 reasonable implementation                                                                                                                                           |
| `destructive`       | task implies delete/drop/migrate/force, schema change, files outside §X repos, or a rebase/cherry-pick conflict hit mid-WORK (§6 conflict route)                                                                  |
| `push`              | any `git push` / network-mutating op — stop and hand back; never auto-push                                                                                                                                        |
| `retries-exhausted` | test still RED after 2 fix attempts + one auto-`ds:backprop`                                                                                                                                                      |
| `review`            | `--review` set and `dossier-reviewer` returns `CHANGES` after one fix cycle (§6.5)                                                                                                                                |
| `tiger`             | `tiger-check` exit 1 (§7 tiger route) — an added line exceeds a limit the repo itself declared. Exit 2 is advisory and never pauses                                                                               |
| `x-stale`           | the Vm.X §X-stale guard (§8a) would prompt — the operator answers it                                                                                                                                              |
| `ci`                | a CI run on a pushed commit ends in a conclusion other than `success`, or `gh` cannot list the runs (CI watch above)                                                                                             |
| `budget`            | `--max-tasks <n>` (default 10) or a turn ceiling reached → §S `auto-stop=budget`. Clean landing: commit WIP work to the task's files, row stays `~`, §S handoff note — the tree is recorded before the loop stops |

**Excuse table — the rationalization each class invites, and the answer that holds.** Prose rails, model-enforced; the PAUSE itself stays the contract:

| class               | tempting excuse                           | rebuttal                                                                                                                       |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `blocked`           | "the `!` row is probably fine to attempt" | `!`/`?` encode a human's unanswered question — attempting it answers FOR the human                                             |
| `ambiguous`         | "any reasonable reading will do"          | two readings = two different diffs; the operator picks, or the wrong one ships silently                                        |
| `destructive`       | "it's a small migration"                  | small deletes are still irreversible; blast radius is judged before, not after                                                 |
| `push`              | "pushing saves the operator a step"       | publishing is the operator's irreversible act; nothing network-mutating is ever auto                                           |
| `retries-exhausted` | "third time's the charm"                  | two failed fixes = the diagnosis is wrong, not the luck; more turns buy noise, not signal                                      |
| `review`            | "the reviewer misread it — overrule"      | a second `CHANGES` after a fix cycle is a genuine disagreement; humans arbitrate those                                         |
| `tiger`             | "the limit is arbitrary — bump it"        | the repo chose that number; raising a declared limit to pass a check decides something about the codebase, not about this task |
| `x-stale`           | "refresh later, flip now"                 | stale §X hides push/ahead drift; a flip on stale state forges the ledger                                                       |
| `ci`                | "the failure is flaky, carry on"          | rows after a push build on that commit; a red run is the operator's to read before anything stacks on it                       |
| `budget`            | "one more task won't hurt"                | ceilings exist because 'one more' compounds; land clean (commit + §S) and hand back                                            |

**Rails:** push stays the operator's, never automatic · `ds:close` stays an explicit operator step, so the loop stops at the last `x`-flip · per-task lock · atomic writes · marker guard + `verify` hooks stay active during WORK. Every PAUSE writes its reason to §S so `ds:status` shows WHY on return (Vm.14).

## Failure handling

- Lock active: refuse, suggest `--resume` or wait.
- Test fail + can't fix: leave row `~`, release lock, write §S w/ `BLOCKED: <reason>`. Operator decides.
- Two failed corrections on the SAME issue: stop patching in place — the context is contaminated by its own wrong theory. Interactive: offer the operator a reset — §S the state, re-enter from a fresh context with the lesson written down (resume protocol picks up mid-task). Under `--auto` this never self-triggers: the `retries-exhausted` PAUSE trips at the same threshold.
- Commit fail: leave row `~`, release lock. Operator investigates.
- §X refresh fail (network / repo missing): row updates partial, flag in §S. Triggers Vm.X stale guard (§8a) — operator confirms before flip.

## Cite

- FORMAT.md §8 (§T format), §10 (§X format), §11 (§S format), §14 (locks), §15 (atomic writes), §16 (resume)
- ADAPTERS.md §context7, §whetstone
- agents/dossier-scout.md (step 6 failure analysis), agents/dossier-reviewer.md (step 6.5 pre-commit gate)
