# Changelog

Notable changes to the **dossier** plugin.

This plugin ships in commit-SHA versioning mode (no pinned `version` in `plugin.json` — every commit is its own version), so entries are grouped by date rather than semver.

## 2026-07-29 (optional quality gates)

Two default-off, env-gated quality backstops for ad-hoc (non-covenant) work, plus a light-path sit-rep and a recovery mode on `ds:status`. All new hooks are inert until opted in, so they ship safely to every user.

### Added

- `slop_guard.py` (PreToolUse) — denies placeholder markers (TODO/FIXME/XXX/HACK) and hardcoded weak-secret literals in new edit content. Off unless `DOSSIER_SLOP_GATE` is truthy; markdown skipped. Layers under, never duplicates, dossier-reviewer's judgement.
- `fakeimpl_stop.py` (Stop, Layer A) — runs `DOSSIER_FAKEIMPL_CMD` on a dirty tree and blocks completion on a non-zero exit, so an unverified "it works" can't stand. Off unless the var is set; never duplicates the in-covenant `run_slice.sh` proof.
- `ds:status` light sit-rep — with no `.scratchpad/dossier/` tree in cwd, falls through to `git status` + last-N commits (plus optional `$DS_HEALTH_CMD`) instead of bailing.
- `ds:status --recover` — reconstruct context after a crash or compaction: cavemem first, session-transcript grep fallback, always names which source fired.

## 2026-07-20 (cohesion)

Skills-cohesion wave: the pair reads as one system — whetstone composed at every dossier lifecycle gate, both directions, one verdict grammar. 8 tasks, TDD, doubt gates drew 11 actionable findings. `[90cd0cd..1fa3c25]`

### Added

- ADAPTERS §whetstone script/skill routes: `run_slice.sh` RED/GREEN proof (ds:build step 6), `whetstone:merge-resolve` merge-class conflict route, `flake_runner.sh` triage (ds:backprop step 4.5), `lint_skill.py` touched-SKILL gate — all deterministic-resolution (`DOSSIER_RUN_SLICE` / `DOSSIER_FLAKE_RUNNER` / `DOSSIER_LINT_SKILL`), all absent-skip.
- `skill_gate.py` whetstone branch — reverse breadcrumbs: whetstone skill invocations on any live dossier get a reminder to record ONE §S verdict line (first live row = current; whetstone stays zero-hook).
- Backprop flake triage: `0<r<1` = flaky → closed §B row + quarantine pointer, no §V invariant minted; resume row keyed on `flake=<rate>`.
- Loop rails in the build covenant: stall rule (identical failure twice = strategy change), budget clean-landing (WIP commit + §S handoff), reset-don't-patch (fresh context via ds:roll); mirrored in the shortcuts table.
- Shared `## Verdict grammar` table, byte-identical in both READMEs; doc-contract tests for every route, all CI-wired.

### Changed

- tdd-cycle description recomposed: self-exclusion clause (root cause of 47-day 0-use) inverted into a routing clause — standalone drives; under a covenant `dossier:build` drives and composes `run_slice.sh`.
- CI lints ALL dossier skills (dir sweep replaces per-file list); ds:build auto-lints any touched SKILL.md (absent-skip).
- Root README + marketplace.json present the pair as a suite (install-both, either-works-alone).

## 2026-07-20

Skills-uplift wave: whetstone composes into the dossier lifecycle (doubt gate at design-class builds), Define + Ship coverage gaps closed. 7 tasks, TDD, adversarial doubt + fresh-context review per task. `[d50f755..469b76b]`

### Added

- `skills/grill/` — Define-phase interrogation (`ds:grill`): FACT-vs-DECISION tree, serial→frontier-batch questioning, stakeholder questionnaire fork, artifact gated by `hooks/lib-assert-grill.sh` (slug-glob discovery, `CONSUMED:` stamp, `--consume` atomic mode).
- `skills/ship/` — Ship-stage changelog (`ds:ship`): §T ledger × git log derivation, cite classifier (`cat-file -t`, no pathspec fallback), spec-vs-convention mapping tables in `reference/changelog-mapping.md`, atomic `hooks/lib-changelog-write.sh` keyed on wave range-cite.
- `hooks/skill_gate.py` — non-blocking breadcrumb when built-in `/review` `/security-review` `/simplify` fires mid-build (PreToolUse `Skill` matcher + `UserPromptExpansion`); live-dossier + `.ds-lock` correlation, session dedup, fail-open; payload shape inferred, disclosed in docstring.
- ADAPTERS `§whetstone` — agent-availability detection path (session agent list + recoverable `Agent type not found` error contract, SPIKE-verified on 2.1.205).
- Five new test suites (`test_adapters_whetstone`, `test_build_doubt_gate`, `test_whetstone_surfaces`, `test_lib_assert_grill`, `test_lib_changelog_write`, `test_skill_gate`), all CI-wired; CI now lints grill + ship via whetstone skill-smith.

### Changed

- `ds:build` gains `--doubt` and step 5.6 DOUBT gate — auto-fires `whetstone:whetstone-doubter` on design-class tasks (forcing function, not opt-in); Autonomous mode gains the 8-class excuse-rebuttal table.
- `ds:new` gains conditional step 1.5 grill gate (exit-code routed, trivial runs untouched); `ds:close` step 5 gains the non-blocking `ds:ship` advisory.
- READMEs (dossier + whetstone) cross-surface the composition — whetstone discoverable from the dossier flow without typing its trigger.

## 2026-07-07

Loops-uplift wave: borrowing the "designing loops" article's levers — scripts over reasoning, deterministic exit criteria, a fresh-context reviewer, and encode-the-fix-into-the-system. 9 tasks, TDD. `[e8ddd78..8ad517e]`

### Added

- `hooks/lib-vm-checks.sh` — deterministic Vm.2/3/6/8/9 sweep (§S ISO timestamp, §T `x`-row cite, START/DONE pairing, write-temp orphans, stale locks). Replaces the prose one-liners `ds:check` re-derived from scratch each run; findings are prefixed `CRITICAL` / `WARN` and fold straight into the 🔴 / 🟡 buckets.
- `hooks/lib-assert-scaffold.sh` — `ds:new` post-scaffold assertion (step 3.5): exits non-zero naming any missing §-section or title before the §S DONE append, instead of eyeballing the Write output.
- `hooks/invariant_guard.py` — opt-in PreToolUse write-time §V guard. Blocks (exit 2) an edit matching a project-registered forbidden pattern; **fail-open** with a missing / empty / malformed registry, so it changes nothing until `ds:backprop` registers an invariant. Registry at `.scratchpad/dossier/.invariant-guards.json`; bypass `DOSSIER_INVARIANT_GUARD=off`.
- `hooks/eval_skill_routing.py` + `evals/README.md` — deterministic trigger-phrase collision lint (in CI via `test_python.py`) plus the manual live-model routing-eval recipe it cannot replace.
- `agents/dossier-reviewer.md` — fresh-context, artifact-only pre-commit reviewer for `ds:build --review` (auto for destructive-class tasks): severity-tagged two-axis findings, deterministic `REVIEW: PASS | CHANGES` verdict.
- Two new shell suites (`test_lib_assert_scaffold`, `test_lib_vm_checks`) plus invariant-guard and routing-lint cases in `test_python.py`, all wired into CI.

### Changed

- `ds:check` step 3 calls `lib-vm-checks.sh` for Vm.2/3/6/8/9 instead of re-deriving shell one-liners from prose; the §3 Vm table marks them deterministic.
- `ds:build` gains `--review` (step 6.5 reviewer gate) and a `review` PAUSE class; `ds:new` gains the scaffold-completeness assertion.
- `lib-clear-stale-locks.sh` gains `--dry-run` (non-mutating list) so the read-only `ds:check` Vm.9 probe never clears a lock.
- README documents the standalone `lib-ds-check.sh` drift gate for CI / pre-push; FORMAT.md gains a §-section TOC; `ds:build` and `ds:backprop` gain "common shortcuts (and why not)" anti-rationalization tables.

## 2026-07-01

Lifecycle-hardening wave: a rolled/fresh session can no longer be surprised by a phantom-live "sealed-zombie". 15 tasks, two adversarial review rounds. `[0e0569f..d00668e]`

### Fixed

- **The "two live dossiers" incident.** A closed-but-not-archived dossier — an interrupted `ds:close`, or a legacy/non-canonical `sealed` header token — was silently re-stamped `live` by INDEX regen on every session, so a fresh session mis-reported it as a second live dossier. Root cause: `lib-regen-index.sh` trusted directory location and only special-cased `paused`, while `ds:close` flipped the header and moved the directory as separate non-atomic steps. Regen is now a level-triggered reconciler over three witnesses (header token × location × §Z closure) rendering a distinct `drift!` state — never phantom-`live` — for any disagreement or non-canonical token.

### Added

- `hooks/lib-reconcile-state.sh` — SessionStart self-heal: a §Z-closed dossier stranded outside `_archive/` (or an archived dossier with a stale header) is auto-repaired under lock with a §S breadcrumb.
- `hooks/lib-archive-move.sh` — the guarded, idempotent, resume-safe `ds:close` commit-point (refuses a pre-existing dest, asserts the move landed, preserves the source on failure).
- `hooks/lib-ds-check.sh` — deterministic Vm.1/Vm.4/Vm.15 gate; exits non-zero naming any dossier in drift, replacing the model-discretionary heuristics that missed the zombie.
- `hooks/lib-z-write.sh` — atomic §Z closeout writer (`complete`/`successor`/`abandoned`) guaranteeing the §12 blank-line separation.
- **Vm.15** (header ⇔ location ⇔ §Z concordance) plus a §17 `enforced-by` column marking each meta-invariant `code` vs `model` — ending the false "ds:check validates all Vm rules" claim.
- Six new test suites (`test_lib_regen`, `test_lib_archive_move`, `test_lib_reconcile`, `test_lib_clear_locks`, `test_lib_ds_check`, `test_lib_z_write`), all wired into CI.

### Changed

- `session-start.sh` surfaces drift loudly via `systemMessage`, counts live by exact `state==live` (not substring), scans ALL non-archived dirs for unfinished ops (§S-scoped, `skill:target` keyed), and self-heals before regen.
- `ds:close` reordered so the header flip precedes the `§Z=written` checkpoint and the move routes through `lib-archive-move.sh` — atomic-or-resumable from every crash point.
- `marker_guard.py` blocks (exit 2) a non-canonical header-token Edit/Write to DOSSIER.md; `lib-header-state.sh` remains the sole sanctioned writer.
- Mutation helpers use unique `mktemp` temps for concurrency safety; `lib-row-flip` is §T-scoped and refuses §B rows and cite-less `x`; `lib-clear-stale-locks` is UTC-correct, never reaps a live-pid lock, and falls back to file mtime.
- `verify_hook.py` is cache-only on the edit hot-path (no blocking network) and exempts dossier paths; `ds:roll` restore dedups by task subject and records the source dossier identity in `.tlr`.

## 2026-06-05

### Added

- SessionStart hook emits `sessionTitle` set to the live dossier slug — only on `startup`/`resume` sources, and only when no title is already set (never clobbers `--name`/`/rename` or other title-emitting hooks); fails open on malformed input or missing jq/python3. New `hooks/test_session_start.sh` covers source gating, title precedence, and fail-open paths.
- `§workflow` adapter (ADAPTERS.md): `ds:check`/`ds:migrate` route scout missions through the native Workflow tool when scanning >2 repos — schema-validated findings, pipelined dispatch, budget-gated width, crash-resumable. Parallel Agent spawns remain the default at ≤2 repos and on installs without the tool. `ds:build` stays Workflow-free by design.

### Changed

- `ds:close` and `ds:migrate` are now manual-only (`disable-model-invocation: true`): the model can never auto-fire archive/convert mutations; invoke via `/dossier:close` and `/dossier:migrate`.

### Removed

- `context-mode` adapter purged from ADAPTERS.md, README, FORMAT.md, the scout agent, and all skills — phantom dependency; its uses were already covered by the documented native fallbacks (parallel Bash/Read, Agent/Workflow fan-out). Standing rule: adapters only where no native harness equivalent exists.

## 2026-06-03

### Added

- Python hook test suite `hooks/test_python.py` (tlr round-trip, transcript reconstruction, verify-layer offline-safety, pattern-regex compile) — stdlib-only, runnable directly or under pytest.
- GitHub Actions CI (`.github/workflows/ci.yml`) running the python + shell test scripts, `ruff`, and `shellcheck` on push/PR. Actions are SHA-pinned (dogfooding the verify-layer's own rule).
- On-demand `skills/verify/references/authorities.md` holding the coverage matrix, per-source raw-JSON cheatsheet, and catalog-extension guide.
- `hooks/lib-header-state.sh` — atomic header `<state>` flip (`live`/`done`/`paused`); the sole writer of the dossier header state.
- `hooks/resolve_pins.py` — proactive latest-version + EOL resolver (reuses the verify registry + shared 24h cache); seeds §C/§I pins before coding so the model writes the right version the first time.

### Changed

- SessionStart injection is now compact and decision-first: a one-line §T progress summary, a §X repo/unpushed count, and surfaced blocked (`!`) / needs-research (`?`) rows. The full §T/§X tables and INDEX detail are injected only when a resume is pending — cutting the recurring per-session/per-resume token cost substantially.
- verify-layer reminders emit on a single channel (`additionalContext`) with two-line findings and one shared skip footer; stderr carries only a one-line finding count.
- `dossier-scout` Bash allow/deny tables collapsed into a single deny-by-default principle (harness-level `disallowedTools` remains the hard guard).
- Slimmed `skills/verify/SKILL.md` by moving the coverage matrix + cheatsheet into the on-demand reference file.
- Lifecycle gained pause/resume (atomic `ds:status` actions) + `ds:close --abandon "<reason>"` for dropped waves; `paused` is now a reachable, INDEX-rendered state.
- SessionStart surfaces multiple live dossiers loudly via a user-visible `systemMessage`; `ds:status` / `ds:check` warn on >1 live (Vm.12) and stale-live (Vm.13).
- `ds:new` (Step 2.5) and `ds:build` (Step 5.5 PIN CHECK) resolve + pin current versions / API docs before coding (proactive companion to the reactive verify hook); new `§context7` adapter for API-shape grounding.
- `ds:status` is now the **driver**: hydrates the Claude Code TaskList from §T (a projection — §T stays source of truth, `!`/`?` rows surface as blockers) and leads with a decision-first sit-rep (`--full` for the §T/§X tables).
- `ds:build --auto`: autonomous mode loops actionable §T rows under native `/goal`, pausing only on a real decision (Vm.14 reason classes); mirrors §T ↔ TaskList at claim/flip; never auto-pushes or auto-closes.
- TaskList now auto-dumps on `SessionEnd` as well as `PreCompact`.
- Read-only verbs (`status`, `check`) declare `disallowed-tools: Edit, Write, NotebookEdit` (defense-in-depth; mutations route through Bash helpers).
- README reframed around 4 primary verbs + autonomy; `build`/`backprop`/`roll`/`verify` documented as auto/internal/power-user.
- `ds:new` gained a clarify gate (resolve underspecified §G/§C before §T is authored); `ds:build` gained a baseline-green check before RED and dependency-aware `--next`/`--auto` selection (phase prerequisites must be `x`).
- `ds:migrate --from-ck` converts a cavekit (`ck`) root `SPEC.md` into a DOSSIER.md — near-1:1 given the shared §G/§C/§I/§V/§T/§B schema.

### Fixed

- `precompact-roll.py` no longer emits `hookSpecificOutput.additionalContext` on `SessionEnd`/`PreCompact` — neither is a member of the CC hook output union, so the emit failed validation (`Hook JSON output validation failed — (root): Invalid input`) on every session end and compaction. It now surfaces a top-level `systemMessage` breadcrumb; the `.tlr` write (the restore source) was always unaffected.
- `marker_guard.py` downgraded from an exit-2 hard block to a non-blocking PreToolUse advisory, and narrowed to the unambiguous `PH<n>-<A><n>` audit-id form. Bare `Phase|Stage|Step N` comments no longer block legitimate infra/CI/shell writes (e.g. `# Step 1: dump` in a backup CronJob) across non-dossier repos.
- The three python hooks (`marker_guard`, `verify_hook`, `precompact-roll`) now no-op cleanly on Python < 3.10 instead of raising.
- Removed a dead `os` import in `verify_hook.py`.
- Documented the `python3` ≥ 3.10 runtime prerequisite in the README install section.
