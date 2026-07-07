# Changelog

Notable changes to the **whetstone** plugin.

Ships in commit-SHA versioning mode (no pinned `version` in `plugin.json` — every commit is its own version), so entries are grouped by date.

## 2026-07-07

Initial release. Five engineering-craft skills, each with a deterministic self-verify, built from the "designing loops" quality levers (give the model a way to verify its own work; separate the moments; deterministic over discretionary).

### Added

- `tdd-cycle` — one-slice red-green-refactor for ad-hoc work. `scripts/run_slice.sh` inverts the RED check (a test that passes first is rejected) and gates GREEN + full-suite on exit code. Refactor is explicitly outside the loop.
- `flaky-test-audit` — per-test flakiness by the number. `scripts/compute_flakiness.py` flags `0 < fails/runs < 1` and exits with the count of tests newly flaky since a baseline; `scripts/flake_runner.sh` accumulates N runs. Framework adapters in `reference/`.
- `doubt-pass` — pre-decision adversarial gate (CLAIM → EXTRACT → DOUBT → RECONCILE → STOP). Drives the `whetstone-doubter` agent — a fresh-context, read-only reviewer handed the artifact + contract only (no rationale) that returns a `DOUBT: FAILURES | NO FAILURE FOUND` verdict. 3-cycle cap, explicit "doubt theater" call-out.
- `merge-resolve` — hunk-by-hunk conflict resolution with `scripts/verify_clean.sh`: zero conflict markers AND pass-count ≥ pre-conflict baseline, both script-captured.
- `skill-smith` — lints a `SKILL.md` (`scripts/lint_skill.py`: name/dir match, kebab charset, trigger clause, third-person, line budget, reference depth) plus manual anatomy + failure-mode checklists. Self-hosted in CI against whetstone's own skills.
- CI job `whetstone` (python + shell tests + self-lint gate + ruff + advisory shellcheck).
