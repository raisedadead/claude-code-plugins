# Changelog

Notable changes to the **dossier** plugin.

This plugin ships in commit-SHA versioning mode (no pinned `version` in `plugin.json` — every commit is its own version), so entries are grouped by date rather than semver.

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

- The three python hooks (`marker_guard`, `verify_hook`, `precompact-roll`) now no-op cleanly on Python < 3.10 instead of raising.
- Removed a dead `os` import in `verify_hook.py`.
- Documented the `python3` ≥ 3.10 runtime prerequisite in the README install section.
