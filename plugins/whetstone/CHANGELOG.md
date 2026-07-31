# Changelog

Notable changes to the **whetstone** plugin.

Ships in commit-SHA versioning mode (no pinned `version` in `plugin.json` — every commit is its own version), so entries are grouped by date.

## 2026-07-31 (leaner descriptions)

Every session injects each skill's full `description` frontmatter, so description length is a per-session context cost paid whether or not the skill is used.

### Changed

- Skill descriptions trimmed: **1,568 → 1,468 chars across 5 skills (6.4%)**. Deliberately small. These descriptions were already almost entirely trigger surface — `doubt-pass` and `skill-smith` were left byte-identical because every clause in them is a firing condition, and cutting one would trade context cost for discoverability. `tdd-cycle` gave up the most (−90) while keeping its `dossier:build` composition note, which is what makes the two plugins compose discoverably.

## 2026-07-31 (docs consolidation)

Docs moved to the repository root. No skill or script behaviour changed.

### Changed

- `README.md` is now a pointer. Install, the skill table and each skill's self-verify moved to the root README; the verdict-grammar table moved to root `ARCHITECTURE.md`, which is now its only home — it was previously duplicated here with a test enforcing byte-identity.
- `homepage` in `plugin.json` and `marketplace.json` points at the repo root rather than this directory.

## 2026-07-20 (cohesion)

Cohesion wave (driven from dossier's skills-cohesion): composed at every dossier gate, zero hooks still. `[90cd0cd..1fa3c25]`

### Changed

- tdd-cycle description recomposed — routing clause replaces the self-exclusion that caused 47 days of 0-use; standalone behavior unchanged.
- All five skills gain a `## Dossier breadcrumb` section: one §S verdict line into a live dossier, no-op without one (prose only, no hooks, no dossier dependency).
- README: shared `## Verdict grammar` table (identical to dossier's) + updated tdd-cycle row.

## 2026-07-20

Composition wave (driven from dossier's skills-uplift): `whetstone-doubter` now auto-fires at dossier's design-class build gate. `[d50f755..469b76b]`

### Changed

- README documents dossier auto-composition: design-class `ds:build` spawns `whetstone:whetstone-doubter` with no trigger phrase (see dossier `ADAPTERS.md` §whetstone for detection + graceful-skip semantics).

## 2026-07-07

Initial release. Five engineering-craft skills, each with a deterministic self-verify, built from the "designing loops" quality levers (give the model a way to verify its own work; separate the moments; deterministic over discretionary).

### Added

- `tdd-cycle` — one-slice red-green-refactor for ad-hoc work. `scripts/run_slice.sh` inverts the RED check (a test that passes first is rejected) and gates GREEN + full-suite on exit code. Refactor is explicitly outside the loop.
- `flaky-test-audit` — per-test flakiness by the number. `scripts/compute_flakiness.py` flags `0 < fails/runs < 1` and exits with the count of tests newly flaky since a baseline; `scripts/flake_runner.sh` accumulates N runs. Framework adapters in `reference/`.
- `doubt-pass` — pre-decision adversarial gate (CLAIM → EXTRACT → DOUBT → RECONCILE → STOP). Drives the `whetstone-doubter` agent — a fresh-context, read-only reviewer handed the artifact + contract only (no rationale) that returns a `DOUBT: FAILURES | NO FAILURE FOUND` verdict. 3-cycle cap, explicit "doubt theater" call-out.
- `merge-resolve` — hunk-by-hunk conflict resolution with `scripts/verify_clean.sh`: zero conflict markers AND pass-count ≥ pre-conflict baseline, both script-captured.
- `skill-smith` — lints a `SKILL.md` (`scripts/lint_skill.py`: name/dir match, kebab charset, trigger clause, third-person, line budget, reference depth) plus manual anatomy + failure-mode checklists. Self-hosted in CI against whetstone's own skills.
- CI job `whetstone` (python + shell tests + self-lint gate + ruff + advisory shellcheck).
