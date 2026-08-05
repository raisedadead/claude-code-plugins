# lean-engine

`2026-08-04` · `live` · hand-driven (installed skills are stale; see Constraints)

| field       | value                                                                        |
| ----------- | ---------------------------------------------------------------------------- |
| consumer    | the operator asking "where are we at" and expecting state plus the next step |
| reached-via | shipped `SKILL.md` bodies, `FORMAT.md`, and the two positional `§` parsers   |
| budget      | 20 commits                                                                   |

## Map

What each section is for. This section exists because the previous encoding used single-letter sigils that meant nothing to the person reading them.

| section      | holds                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| Map          | this legend                                                                                 |
| Goal         | what this wave is for, in one paragraph                                                     |
| Constraints  | what the wave may not do, and what it must work around                                      |
| Done-when    | the contract: every row a command with an expected result. `lib-converge.sh` runs it        |
| Tasks        | the work. `state` is where it is, `who` is who can move it, `needs` is what must land first |
| Fog          | suspected work not yet sharp enough to be a task                                            |
| Out of scope | ruled out of this wave on purpose, so it stops being re-proposed                            |
| Status       | append-only timeline. One line per step, written before the step mutates anything           |

Task columns:

- `state` — `.` not started · `~` in progress · `x` done
- `who` — `A` the agent can do it alone · `H` needs the operator
- `needs` — task ids that must be `x` first, or `—`. The frontier is every `.` row whose `needs` are all `x`.

## Goal

Make the engine light and its state legible. Two failures drive it. The bodies have grown to 2,205 lines of `SKILL.md` across 18 skills against a comparable set that ships 22 skills in 1,464 lines, so every invocation pays for prose nobody reads. And the ledger is phase-shaped, which forces the operator to declare the shape of the work before it is known — the opposite of what they want, which is to ask where things are and be told the state and the next step.

The wave also carries the three defects a multi-lens review confirmed in the unreleased branch, because the contract runner is one of them and this wave depends on it.

## Constraints

- The installed plugin is `095289e615e8`; the branch is `f27558f`. Hooks are 28-of-30 byte-identical, so the guardrails are current. All 11 skill bodies differ. **No `/dossier:*` skill may be invoked during this wave** — the shell libs under `plugins/dossier/hooks/` are called directly instead.
- `marker_guard.py:99` is filename-scoped to `DOSSIER.md`, so this file is unpoliced. Probed: a Write payload for `.dossier/2026-08-04-probe.md` containing `| wip |` exits 0.
- `converge.py` currently reports MET on stderr text. T1 fixes it before anything else depends on the runner.
- Four primary operator verbs (D3). Nothing here adds one.
- Push and PR are the operator's. The wave completes at commit.

## done-when

Criteria 1-5 are **red today**. A criterion already MET before the work starts proves nothing about it — the rule `run_slice.sh` already applies when it fails a slice whose test passed on its first run. Criteria 6-12 are green today and guard against regression.

| id  | command                                                                                                                                     | expect |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | `python3 plugins/dossier/hooks/converge.py plugins/dossier/tests/fixtures/stderr-only.md`                                                   | exit 1 |
| 2   | `grep -q 'def test_a_subdirectory_root' plugins/whetstone/tests/test_tiger_check.py && python3 plugins/whetstone/tests/test_tiger_check.py` | exit 0 |
| 3   | `grep -q 'def test_a_hyphen_boundary' plugins/dossier/tests/test_converge.py && python3 plugins/dossier/tests/test_converge.py`             | exit 0 |
| 4   | `bash plugins/dossier/hooks/test_invocation_parity.sh`                                                                                      | exit 0 |
| 5   | `test "$(cat plugins/*/skills/*/SKILL.md \| wc -l)" -le 1600`                                                                               | exit 0 |
| 6   | `python3 plugins/dossier/tests/test_converge.py`                                                                                            | exit 0 |
| 7   | `python3 plugins/whetstone/tests/test_tiger_check.py`                                                                                       | exit 0 |
| 8   | `bash plugins/dossier/hooks/test_lib_vm_checks.sh`                                                                                          | exit 0 |
| 9   | `bash plugins/dossier/hooks/test_closure_parity.sh`                                                                                         | exit 0 |
| 10  | `python3 plugins/whetstone/skills/skill-smith/scripts/lint_skill.py plugins/dossier/skills`                                                 | exit 0 |
| 11  | `bash plugins/whetstone/bin/claim-check $(git ls-files '*.md' \| grep -v tests/fixtures/)`                                                  | exit 0 |
| 12  | `for t in plugins/dossier/hooks/test_*.sh; do bash "$t" >/dev/null 2>&1 \|\| exit 1; done`                                                  | exit 0 |

Criterion 1 asserts the negative space: a fixture whose only output goes to stderr must **not** satisfy a `stdout:` expect, so the runner reports UNMET and exits 1. Today it exits 0 — that is the defect. Criterion 5 is the lightness goal as a number: 2,205 lines today, 1,600 the ceiling. Criterion 4 names a test that does not exist yet — the guard for the D6 class, where a verb was made unreachable while a hook still named it as the remedy.

## Tasks

| id  | state | who | task                                                                         | needs  | cite | verify                                        |
| --- | ----- | --- | ---------------------------------------------------------------------------- | ------ | ---- | --------------------------------------------- |
| T1  | x     | A   | `converge.py` matches `stdout:` against stdout only, stderr kept for report  | —      | 44ac262 | criterion 1                                   |
| T2  | x     | A   | `tiger_check.py` resolves the work-tree top before diffing                   | —      | 44ac262 | criterion 2                                   |
| T3  | x     | A   | contract resolver uses date-stripped equality, not suffix match              | —      | 44ac262 | criterion 3                                   |
| T4  | x     | A   | §T gains `who` and `needs`, drops `P`; columns resolve by header name        | —      | 98dfa2f | `test_lib_vm_checks.sh`                       |
| T5  | ~     | A   | section anchors become words; `FORMAT.md` gains the Map                      | T4     | 89b35f0 | `test_closure_parity.sh`, `test_lib_regen.sh` |
| T6  | .     | A   | Fog section: encoding, parser, and `ds:new` scaffold                         | T5     | —    | `test_lib_assert_scaffold.sh`                 |
| T7  | .     | A   | the 11 skill bodies updated to the new encoding                              | T5, T6 | —    | criterion 10                                  |
| T8  | .     | A   | entrypoint/engine split: `build`, `backprop`, `new`, `close`, `migrate`      | T7     | —    | criterion 5                                   |
| T9  | .     | A   | `ds:grill` adopts the five grilling rules; description cut to human-facing   | T7     | —    | criterion 10                                  |
| T10 | .     | A   | `ds:status` emits the frontier and the flow map                              | T6, T8 | —    | manual: state + next step in one block        |
| T11 | .     | A   | `migrate`/`ship`/`roll` become user-invoked; add `test_invocation_parity`    | T8     | —    | criterion 4                                   |
| T12 | .     | A   | ponytail's ladder into `dossier-reviewer`'s Standards axis                   | —      | —    | criterion 10                                  |
| T13 | .     | A   | section anchors resolve case-insensitively; PARSE names the anchor it wanted | T5     | —    | new case in `test_converge.py`                |
| T14 | x     | A   | the stdlib test runners honour `-k`, or contracts stop using it              | —      | efe6a2e | new case in `test_converge.py`                |
| T15 | .     | A   | the header's `P<cur>/<tot>` counter goes with the phases it counted          | T4     | —    | `test_lib_regen.sh`, `test_session_start.sh`  |

Frontier now: T12, T15. T5 is `~` — every reader is on the section map; the writers still emit sigils.

T4 went further than "shift the indices". `lib-vm-checks.sh` and `lib-row-flip.sh` now read the `state` and `cite` positions out of the §T header row by name, so both the legacy `id|P|state|task|cite|verify` layout and the new `id|state|who|task|needs|cite|verify` one are read correctly and no archived dossier needs migrating. A header naming neither column is reported rather than skipped. That deletes the `FORMAT.md` rule which forbade a dependency column outright, and with it the reason the blast radius looked large.

A fresh-context review then found two blockers in it. `lib-regen-index.sh` was a **third** positional reader nobody had listed: `f[4] == "x"` counted done tasks, so under the new layout a completed row counted as not-done and the INDEX read `0/2` where it should read `1/2` — reproduced, and the new `test_lib_regen.sh` case goes red when the positional read is restored. And `ds:build --auto` still selected by phase prerequisite, a column this wave had just deleted, so with no `P` cells the prerequisite was vacuously true for every row and `needs` was honoured by nothing.

The same review caught two false sentences this wave wrote into `FORMAT.md`: that a layout change now "costs nothing" (untrue while a third reader still counted cells) and that the rule forbidding a dependency column had been replaced (it still shipped verbatim in `status/SKILL.md`). Both are the exact shape `CLAIMS.md` and the project rails name — right behaviour, wrong stated reason — written by the session that had just finished citing that rule at others.

Two findings came out of using the format by hand rather than from reading the code.

**T13.** `converge.py:68` splits on the literal `"## done-when"`, so a heading cased `## Done-when` produced `CONVERGE: PARSE — no done-when table, or it holds no numbered rows` — an error naming neither the anchor nor the case as the cause. Hit in the first five minutes.

**T14.** One of the six stdlib runners honours `-k`; the other five accept it and run everything. `test_convergence_state.py` filters and exits 1 on `-k zzz_nope`, so the shipped `harness-alignment` criterion 12 is sound. `test_converge.py`, `test_python.py`, `test_whetstone_py.py`, `test_tiger_check.py` and `test_claim_check.py` all exit 0 on the same input, so a contract that reaches for `-k` against any of them gets a false green. The fix is to transcribe the working implementation into the five, not to write a sixth.

The first version of this row claimed the runners ignore `-k` *generally* and that criterion 12 could not fail for the reason it named. Both were wrong: `test_converge.py` was probed and the conclusion generalised to a runner that behaves differently. It is recorded rather than quietly rewritten because it is the wave's own subject matter — a claim that outran its probe.

## Fog

Suspected, not yet sharp enough to be a task. Graduates when the question can be stated precisely — not when it can be answered.

- The three surfaces that phrase-track `mattpocock/skills` uncredited (`tdd-cycle`, `merge-resolve`, `dossier-reviewer`'s two axes). The correction to `INSPIRATIONS.md` is clear; whether the lineage rule needs a mechanical check is not.
- `TIGER_STYLE`'s "all errors must be handled" against F12's 287 hooks failing dark. Both name the same hole. What would actually catch it at runtime is unknown.
- Whether the entrypoint/engine split wants a shared convention (a naming rule, a lint) or is one-off per skill.
- The dossier `CHANGELOG.md` has no entry for the unreleased branch. Whether that is a task here or belongs to the release is undecided.

## Out of scope

Ruled out of this wave on purpose. Each returns only if the goal is redrawn.

- **Cross-agent portability.** The operator uses Claude. It is a safety net, not a requirement.
- **A standalone ADR practice** (O7). Adjacent to the Map work, but a separate decision.
- **Everything from ponytail beyond the ladder** — the intensity dial, the debt log, the repo-wide audit, published benchmarks.
- **New operator verbs.** D3 holds at four.
- **`wayfinder`'s tracker model.** The frontier is adopted; putting tickets on an issue tracker is not.

## Status

```
2026-08-04  lean-engine — wave opened by hand; installed skills stale, libs called from source
2026-08-04  T4 DONE → x cite=98dfa2f  columns resolve by header name, both layouts read
2026-08-04  T14 DONE → x cite=efe6a2e  -k honoured by all six runners, bare -k refused
2026-08-04  T1 T2 T3 DONE → x cite=44ac262  three confirmed defects closed
2026-08-05  T5 — nine readers onto one section map; both spellings read forever
2026-08-05  review — worded headings failed open; `## Tasks — Task ledger` disabled every check
2026-08-05  T5 — sit-rep was the third positional column reader; state came from `who`
2026-08-04  review — 12 findings on T4; T1-T3 clean under mutation (7/7 tests go red)
2026-08-04  T4 AMEND cite=e19bdaa  lib-regen-index.sh was the third positional reader
2026-08-04  T4 AMEND cite=9976e2e  --auto and blockedBy read needs; two false claims cut
```
