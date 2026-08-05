# audit-debt

| field       | value                                                                               |
| ----------- | ----------------------------------------------------------------------------------- |
| consumer    | a session running any `ds:*` or `whetstone:*` skill in a project with these plugins |
| reached-via | shipped `SKILL.md` bodies, `hooks/*.py`, `hooks/lib-*.sh`, `whetstone/skills/*`     |
| budget      | 20 commits                                                                          |

## done-when

Criteria 1-9 are red today: each names a test that does not exist yet, or a command that fails today. 10-13 are green and guard against regression.

| id  | command                                                                                                                                                       | expect |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | `grep -q 'def test_a_paused_wave_whose_prose_says_live_is_not_live' plugins/dossier/tests/test_converge.py && python3 plugins/dossier/tests/test_converge.py` | exit 0 |
| 2   | `grep -q 'tiger-style' plugins/dossier/hooks/skill_gate.py && bash plugins/dossier/hooks/test_skill_gate.sh`                                                  | exit 0 |
| 3   | `grep -q 'ASCII-hyphen' plugins/dossier/hooks/test_lib_dossier_edit.sh && bash plugins/dossier/hooks/test_lib_dossier_edit.sh`                                | exit 0 |
| 4   | `test "$(grep -cE 'Goal\|Constraints\|Interfaces\|Invariants\|Bugs\|Repos' plugins/dossier/hooks/test_lib_assert_scaffold.sh)" -ge 6`                         | exit 0 |
| 5   | `grep -q 'def test_verify_hook_dedups_a_repeat_inside_one_call' plugins/dossier/hooks/test_python.py && python3 plugins/dossier/hooks/test_python.py`         | exit 0 |
| 6   | `grep -q 'lockfile' plugins/whetstone/tests/test_tiger_check.py && python3 plugins/whetstone/tests/test_tiger_check.py`                                       | exit 0 |
| 7   | `grep -q 'missing_results' plugins/whetstone/tests/test_flake_runner.sh && bash plugins/whetstone/tests/test_flake_runner.sh`                                 | exit 0 |
| 8   | `test "$(grep -rlE 'trim.*state' plugins/dossier/hooks/*.sh \| wc -l)" -eq 4`                                                                                 | exit 0 |
| 9   | `bash -c '! grep -rq "mcp__claude_ai_Context7__" plugins/'`                                                                                                   | exit 0 |
| 10  | `bash plugins/whetstone/bin/claim-check $(git ls-files '*.md' \| grep -v tests/fixtures/)`                                                                    | exit 0 |
| 11  | `python3 plugins/whetstone/skills/skill-smith/scripts/lint_skill.py plugins/dossier/skills`                                                                   | exit 0 |
| 12  | `for t in plugins/dossier/hooks/test_*.sh; do bash "$t" >/dev/null 2>&1 \|\| exit 1; done`                                                                    | exit 0 |
| 13  | `for t in plugins/whetstone/tests/test_*.sh; do bash "$t" >/dev/null 2>&1 \|\| exit 1; done`                                                                  | exit 0 |

Criterion 8 counts the readers that resolve a §T column by header name. It must return 4 — `lib-vm-checks.sh`, `lib-row-flip.sh`, `lib-regen-index.sh`, `session-start.sh` — and `FORMAT.md` must carry a discovery command that returns the same four. The version that shipped there exited 2 for a missing `-r`, and matched two of four once fixed, because the awk spelling differs per reader.

## notes

Criteria 1, 3, 4, 5 and 8 were renamed after the work landed under different test names and a different discovery pattern. Each underlying change was verified present before the criterion was edited: `converge.py:159` `_HEADER`, twelve section assertions in `test_lib_assert_scaffold.sh`, `test_verify_hook_dedups_a_repeat_inside_one_call`, and four readers matching the corrected pattern. A criterion edited to match what was built is worthless unless the build is checked first.

Criterion 3's grep was case- and separator-wrong (`ascii hyphen` against `ASCII-hyphen`), so it short-circuited before the test ever ran while criterion 12 ran the same script green. Before the string was corrected: `lib-row-flip.sh:77` treats `-` as empty, `test_lib_dossier_edit.sh:126` asserts flip/`lib-vm-checks.sh` parity for it, and deleting the `"-"` arm of that condition in a scratch copy turns the suite red on `flip wrote cite '-' on a ->x row that lib-vm-checks.sh reports as a Vm.3 violation`.

Source: a 102-agent read of all 133 tracked files (workflow `w7jzwpla2`). 695 claims catalogued, 427 suspicions raised, 66 confirmed after each was handed to a separate agent told to refute it. Report at `repo-audit-report.json`, untracked.

Two confirmed findings are lines written the previous day while correcting other false claims: `FORMAT.md:70` named three header parsers when there are four (`marker_guard.py:60` is the fourth, and the only one that hard-blocks), and `FORMAT.md:215` shipped a `grep` that exits 2.

## out of scope

- Dropping the header's third field. Four parsers require it; removing it is its own wave.
- The `P1/1` counter and the INDEX `P` column.
- Anything from ponytail.dev beyond what is already recorded.
- New operator verbs. D3 holds at four.
