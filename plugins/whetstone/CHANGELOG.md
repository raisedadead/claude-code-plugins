# Changelog

Notable changes to the **whetstone** plugin.

Ships in commit-SHA versioning mode (no pinned `version` in `plugin.json` — every commit is its own version), so entries are grouped by date.

## 2026-08-02 (claims name their backing)

### Added

- `claim-check` (`bin/claim-check`, `skills/skill-smith/scripts/claim_check.py`): flags a shipped sentence that claims runtime enforcement — `blocks`, `enforces`, `gates`, `denies`, `prevents`, `refuses` — while naming neither an exit code, a citation, nor an advisory/model-judgment label. Shape only, by design: whether the named exit code is the real one stays a reader's question. Exit `0` `CLAIMS: CLEAN`, `1` `CLAIMS: FLAGGED <n>`, `64` usage.

## 2026-08-01 (one shape rule computed, the rest read by hand)

### Added

- `tiger-style`, a sixth skill: the one TIGER_STYLE rule cheap to compute from a diff — the column budget of the lines a change ADDS. `tiger_check.py` reads the staged index, resolves a limit per file (`WHETSTONE_TIGER_COLS`, then `.editorconfig` `max_line_length`, then a 100-column fallback) and exits `0` clean, `1` for a limit the repo declared, `2` for the advisory fallback, `64` for a non-work-tree.

  The split is the point. A repo that has stated its limit gets it enforced; a repo that has not gets told, never stopped. The other four TIGER_STYLE rules — function length, assert adequacy, loop bounds, magic numbers — need a reader, so they ship as a labelled manual pass with no exit code, and the skill says plainly that nothing enforces them. A checklist that presents itself as a gate is worse than no gate.

  Width is display columns, not code points: a tab advances to its stop, a wide character counts two, a combining mark counts zero. A verdict line carries how many files were examined and how many were staged but skipped, so a docs-only commit reads differently from a real pass rather than as the same "clean". A bare `CLEAN 0 files` covers an empty index and a deletion-only commit alike — a deletion adds no line to measure.

  Ships on `PATH` as `bin/tiger-check`: Claude Code adds an enabled plugin's `bin/` to the Bash tool's `PATH`, so a consuming project reaches the checker without configuration. An earlier draft of this entry said the composed route could not address its sibling from the plugin cache — `bin/` is what closed that.

## 2026-07-31 (lint what the host actually parses)

### Added

- `lint_skill.py` now fails a frontmatter value that will not survive a real YAML parse: an unquoted scalar containing a colon-space, or one opening with a flow/block indicator (`[ { * & ! % @ \` > |\`). The linter reads frontmatter with a regex, so until now a value that broke YAML linted perfectly clean and then loaded with every field dropped — the skill kept its file and lost its trigger surface. Three shipped dossier skills were in that state.

  The gate is deliberately stricter than "does it parse". `migrate`'s `argument-hint: [<repo-path> | --all | --gc]` parsed *fine* — into a `list` rather than a `str`. A parse-only check reports success on exactly the defect that matters.

  Four tests: colon-space fires, flow indicator fires, quoted values do not false-positive, and a plain `<T-id> | --next` value with pipes is not flagged.

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
