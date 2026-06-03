# Changelog

Notable changes to the **dossier** plugin.

This plugin ships in commit-SHA versioning mode (no pinned `version` in `plugin.json` — every commit is its own version), so entries are grouped by date rather than semver.

## 2026-06-03

### Added

- Python hook test suite `hooks/test_python.py` (tlr round-trip, transcript reconstruction, verify-layer offline-safety, pattern-regex compile) — stdlib-only, runnable directly or under pytest.
- GitHub Actions CI (`.github/workflows/ci.yml`) running the python + shell test scripts, `ruff`, and `shellcheck` on push/PR. Actions are SHA-pinned (dogfooding the verify-layer's own rule).
- On-demand `skills/verify/references/authorities.md` holding the coverage matrix, per-source raw-JSON cheatsheet, and catalog-extension guide.

### Changed

- SessionStart injection is now compact and decision-first: a one-line §T progress summary, a §X repo/unpushed count, and surfaced blocked (`!`) / needs-research (`?`) rows. The full §T/§X tables and INDEX detail are injected only when a resume is pending — cutting the recurring per-session/per-resume token cost substantially.
- verify-layer reminders emit on a single channel (`additionalContext`) with two-line findings and one shared skip footer; stderr carries only a one-line finding count.
- `dossier-scout` Bash allow/deny tables collapsed into a single deny-by-default principle (harness-level `disallowedTools` remains the hard guard).
- Slimmed `skills/verify/SKILL.md` by moving the coverage matrix + cheatsheet into the on-demand reference file.

### Fixed

- The three python hooks (`marker_guard`, `verify_hook`, `precompact-roll`) now no-op cleanly on Python < 3.10 instead of raising.
- Removed a dead `os` import in `verify_hook.py`.
- Documented the `python3` ≥ 3.10 runtime prerequisite in the README install section.
