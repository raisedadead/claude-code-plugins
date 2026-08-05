# Changelog

Notable changes to the **dossier** plugin.

This plugin ships in commit-SHA versioning mode (no pinned `version` in `plugin.json` — every commit is its own version), so entries are grouped by date rather than semver.

## 2026-08-05 (the ledger reads by name)

### Changed

- **Task rows carry `who` and `needs`, and no phase.** `| id | state | who | task | needs | cite | verify |`. `who` is `A` (the agent can finish it alone) or `H` (it needs the operator), set when the row is written rather than discovered when a run stalls. `needs` lists the ids that must reach `x` first and defaults to empty, so a row states a dependency only where one exists. The frontier — every `.` row whose `needs` are all `x` — is derived on read, never stored. A phase column made the operator declare the shape of the work before the work was understood; `needs` expresses the same ordering only where it is real.

- **Sections are words, not sigils.** `## Goal`, `## Tasks`, `## Status`, `## Closeout` and the rest. `hooks/lib-sections.sh` holds one pattern per section, matching both this spelling and the `## §G — Goal` … `## §Z — Closeout` form every dossier written before today carries, with a descriptive tail allowed after either. `ds:new` writes words; nothing rewrites an existing ledger, so archived dossiers stay readable indefinitely and no migration exists to run.

- **Columns resolve by header name.** `lib-vm-checks.sh`, `lib-row-flip.sh`, `lib-regen-index.sh` and `session-start.sh` read the positions they need out of the header row. Three separate readers had been counting cells, each found only when something read a ledger in the new shape; `FORMAT.md` had a rule forbidding a dependency column outright because adding one would shift them. Both the rule and the class it guarded are gone. `lib-vm-checks.sh` warns, `lib-row-flip.sh` refuses at exit 1, and `lib-regen-index.sh` writes a stderr line when a Tasks header names no `state` column.

### Fixed

- `converge.py` matched a `stdout:` expect against stdout **and** stderr, so a wave reported MET on text the command never printed to stdout, and `stdout: (nothing)` reported UNMET against an empty stdout sitting beside a warning. The streams are separate; a failed criterion now shows its first stderr line on the report line.
- `converge.py` resolved a contract by any hyphen-delimited suffix while its docstring claimed equality against the date-stripped slug, so `check.md` claimed wave `2026-08-01-claim-check`. It now matches what the docstring says.
- `lib-row-flip.sh` exits 1 on a row with fewer cells than its header names, rather than writing past its end.
- `session-start.sh` lost the whole sit-rep body to an awk range that collapsed on its own opening heading: no `just did:` lines, and the resume-context dumps shipped as bare headers. The regression was introduced and closed in the same wave; `test_session_start.sh` now reads that output.
- All six stdlib test runners honour `-k`, refuse a bare `-k`, and exit 1 when the filter matches nothing. One honoured it; five accepted and ignored it, so a contract criterion naming a test that does not exist reported success.

## 2026-07-31 (slop gate leaves the plugin)

### Removed

- **`slop_guard.py` and its test are gone.** Denying `TODO` / `FIXME` / `XXX` / `HACK` and hardcoded credentials is a coding standard, not dossier workflow, and a plugin should not ship one person's style opinion to everyone who installs it. Every sibling PreToolUse hook detects something intrinsically dossier — a ledger header token, a §V citation, a registered invariant. This one detected `TODO`; the live-wave scope added two days ago existed only to justify its address here. It now lives in the operator's own harness, where it applies in every repo and no longer lapses between waves. Consumers who relied on `DOSSIER_SLOP_GATE` should move the rule to their own hook config; nothing in this plugin replaces it.

- **`dossier_header.py` and `test_header_parity.sh` are gone** as a direct consequence. That module existed to stop the marker guard and the slop gate from drifting apart on what a ledger header means. With one consumer left, the two live constants moved back into `marker_guard.py` and the other 98 lines — the on-disk state reader, its bounds and its awk-parity harness — had no caller but their own test.

### Changed

- Tenet 7 in `ARCHITECTURE.md` now names `ds:backprop` as the zero-technical-debt mechanism, which is what it actually was; the marker gate was never the plugin's contribution to that idea.

## 2026-07-31 (claims match code)

### Changed

- `verify/SKILL.md` no longer says the PreToolUse hook "fires on every Edit/Write inside the build". It is active inside a build, but `verify_hook.py:99` returns 0 for `.scratchpad/` paths and for `DOSSIER.md` / `PLAN.md` / `SPEC.md`, so ledger writes are never scanned — a large share of the writes a build actually makes.
- `test_manifest.sh` asserts that `ci.yml` invokes it. The test it replaced carried that guard and the replacement dropped it; a gate nobody runs enforces nothing.
- `dossier_header.py` documents that a UTF-8 BOM on line 1 reads as no-state, and why the obvious `utf-8-sig` fix is not applied: `lib-regen-index.sh` does not strip a BOM either, so changing one side alone would reintroduce the awk-vs-Python divergence this module exists to prevent. Both readers change together or neither does.

## 2026-07-31 (frontmatter that actually parses)

### Fixed

Three skills carried YAML frontmatter the host could not parse as intended. A skill whose frontmatter fails to parse loads with **every field silently dropped** — it keeps its file but loses its name, description and trigger surface, so it simply stops firing. Nothing reported an error; `claude plugin validate` was what surfaced it.

- `backprop` — the description's `"bug: <description>"` trigger puts a colon-space inside the scalar, so it has to be quoted. It always was. **The trim in the previous entry stripped the quotes**: that rewrite replaced the whole `description:` line and emitted a plain scalar, not noticing the original was single-quoted. `backprop` was the only description in either plugin that carried quotes, which is exactly why it was the only one broken. Re-quoted; the trigger text is byte-identical either way.
- `ship` — `argument-hint` opened with `[`, which YAML reads as a flow sequence. Two bracketed groups in a row is a parse error. This predates the trim.
- `migrate` — same bracket shape, but well-formed, so it parsed *successfully* into a **list** instead of a string. No error anywhere; the wrong type just loaded. This predates the trim.

## 2026-07-31 (leaner descriptions, precise claims)

Every session injects each skill's full `description` frontmatter, so description length is a per-session context cost paid whether or not the skill is used. This wave cuts that cost without touching the trigger surface.

### Changed

- Skill descriptions trimmed: **4,201 → 2,694 chars across 10 listed dossier skills (35.9%)**. Mechanism prose was cut; every quoted invocation phrase and every firing condition was kept verbatim. A script asserted each replacement 1:1 and re-checked all 59 quoted triggers against the rewritten text, because a skill that stops firing is indistinguishable from a skill that was not needed. Three were deliberately protected: `verify`'s `.scratchpad/dossier/` scope clause, `migrate`'s legacy-artifact shapes (`PLAN+SPEC+AUDIT+closeout/`, `ck/cavekit/SPEC.md`), and `tdd-cycle`'s `dossier:build` composition note.

### Fixed

- `build/SKILL.md` and `backprop/SKILL.md` rebuttal tables claimed `marker_guard.py` "exits 2" on phase markers in source. It does not — that path emits an advisory nudge and exits 0; only a non-canonical DOSSIER.md header token exits 2. The prose in both files was corrected earlier in the same wave; the table rows carrying the identical claim were missed.
- `fakeimpl_stop.py`'s docstring opened by saying `.scratchpad` is "excluded by pathspec" and then said, four lines later, that exclusion is deliberately *not* a git pathspec. The first sentence was a leftover from the abandoned approach.

## 2026-07-31 (gate scoping and honest claims)

Behaviour changes a consumer will notice, plus corrections to documentation that overstated what is enforced.

### Fixed

- **Slop gate no longer fires in projects that never asked for it.** It was the only PreToolUse hook without a scope check, so `TODO` in any file in any repo was hard-denied. It is now a dossier workflow policy: active only while a wave is `live` or `paused`, silent once closed or archived, silent in a bare repo. An unparseable ledger counts as not-active.

- **Fake-impl backstop now sees new files.** Dirty-tree detection used `git diff --name-only HEAD`, which is empty when a session's only output is untracked — precisely where a fake implementation lives. It now uses `git status --porcelain -uall`, filtering out any path under a `.scratchpad` directory — the suite writes there itself, and in a repo that does not gitignore it those writes would otherwise arm the gate on a tree you never dirtied. The filter is applied to the paths rather than as a git pathspec, because a pathspec anchors to the directory git runs in and would miss a `.scratchpad` nested below it or sitting above it. Still default-off.

- **Links in this plugin's README resolve from the install path.** They pointed at repo-root docs with `../../`, which exists in the repo and not in the plugin cache.

- **Vm.6 can now see a crashed `ds:close`.** Its target-token pattern required `[A-Za-z0-9_-]`, but `ds:close` writes the em-dash target that `close/SKILL.md` mandates, so an unclosed `ds:close — START` was invisible to `ds:check` — the exact operation whose interrupted state Vm.6 exists to catch. `session-start.sh` saw it; the two enforcers disagreed.

- `lib-changelog-write.sh` now removes its temp file on failure. It is the only ledger writer whose target sits outside `.scratchpad/`, so an interrupted write left a `CHANGELOG.md.tmp.XXXXXX` in the project root.

### Removed

- `hooks/lib-drift-gate.sh`. It wrapped `lib-ds-check.sh` in a `git diff --exit-code` on `.scratchpad/INDEX.md`, which only means anything where `.scratchpad` is tracked; where it is gitignored the gate either passed vacuously or, after being taught to detect that, refused outright. `ds:check` and `ds:status` already call `lib-ds-check.sh` directly, so nothing is lost.

### Changed

- `verify` no longer claims to fire on every edit; it is dormant without a `.scratchpad/dossier/` directory, and now says so.
- `DS_HEALTH_CMD`, `DS_LIGHT_LOG` and `DS_RECOVER_DAYS` are documented as honoured by the `status` skill rather than by hook code — strong defaults, not enforcement.
- Adapter coverage moved from grepping `ADAPTERS.md` prose to resolving every `plugin:id` referenced in shipped docs against a real skill or agent file.

## 2026-07-31 (docs consolidation)

Repo-level architecture and decision docs; plugin README gutted to a pointer. No plugin behaviour changed.

### Added

- Root `ARCHITECTURE.md` — declared priority ordering (Honesty > Recoverability > Leverage), the evidence-strength enforcement rule, tenets, testing standard, evolution mechanism, sourced lineage. The verdict-grammar table now lives here and only here.
- Root `RESEARCH.md` — append-only ledger of decisions with their rejected alternatives, facts with a recheck trigger, and open strides. Records why there is no `version` field, so it stops being re-proposed.
- Root `CLAUDE.md` — pointer plus the rails cheapest to violate.

### Changed

- `README.md` at this path is now a pointer; install, commands, gates, configuration and the drift-gate recipe moved to the root README. `FORMAT.md` and `ADAPTERS.md` unchanged and still local.
- `homepage` in `plugin.json` and `marketplace.json` points at the repo root rather than this directory.

### Removed

- `test_verdict_grammar.sh`, `test_whetstone_surfaces.sh` — asserted that two READMEs contained matching prose. `test_bundle_ux.sh` replaced by `test_manifest.sh`, keeping only the `marketplace.json` structural checks.

## 2026-07-29 (optional quality gates)

Two env-gated quality backstops for ad-hoc (non-covenant) work, plus a light-path sit-rep and a recovery mode on `ds:status`. The slop gate is ON by default (opt-out); the fake-impl backstop stays opt-in.

### Added

- `slop_guard.py` (PreToolUse) — denies placeholder markers (TODO/FIXME/XXX/HACK) and hardcoded weak-secret literals in new edit content. **On by default**; set `DOSSIER_SLOP_GATE=0` (or false/no/off) to disable. Markdown skipped. Layers under, never duplicates, dossier-reviewer's judgement.
- `fakeimpl_stop.py` (Stop, Layer A) — runs `DOSSIER_FAKEIMPL_CMD` on a dirty tree and blocks completion on a non-zero exit, so an unverified "it works" can't stand. Off unless the var is set; never duplicates the in-covenant `run_slice.sh` proof.
- `ds:status` light sit-rep — with no `.scratchpad/dossier/` tree in cwd, falls through to `git status` + last-N commits (plus optional `$DS_HEALTH_CMD`) instead of bailing.
- `ds:status --recover` — reconstruct context after a crash or compaction: cavemem first, session-transcript grep fallback, always names which source fired.

### Changed

- Slop gate flipped to **on by default** (opt-out via `DOSSIER_SLOP_GATE=0`) — placeholder/secret slop is blocked without opt-in.
- Root marketplace README overhauled: features, the commands a human actually types, and a quality-gates + env-var reference.

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
