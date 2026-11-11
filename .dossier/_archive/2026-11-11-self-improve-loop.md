# self-improve-loop contract

| field       | value                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| consumer    | The operator, once a month and on a Claude Code minor bump, running `/suite-review` in this repo            |
| reached-via | `.claude/skills/suite-review/SKILL.md` in this checkout, plus `python3 tools/census/census.py opportunities` |
| budget      | 15 commits                                                                                                  |

## done-when

| id  | command | expect |
| --- | ------- | ------ |
| 1   | `python3 tools/census/test_census.py` | exit 0 |
| 2   | `grep -q '"opportunities"' tools/census/census.py` | exit 0 |
| 3   | `plugins/whetstone/bin/lint-skill .claude/skills/suite-review` | exit 0 |
| 4   | `python3 tools/test_check_rows.py` | exit 0 |
| 5   | `python3 tools/check_rows.py` | exit 0 |
| 6   | `awk '/^## [DFO] /{print $2; exit}' RESEARCH.md` | stdout: O |
| 7   | `sh -c 'test $(grep -cE "^[[:punct:]] O[0-9]+ " RESEARCH.md) -le 7'` | exit 0 |
| 8   | `grep -q 'measured argument for O21' RESEARCH.md` | exit 1 |
| 9   | `grep -q 'suite-review' ARCHITECTURE.md` | exit 0 |
| 10  | `grep -q '2026-12-01' .scratchpad/dossier/LATER.md` | exit 0 |
| 11  | `bash tools/ci.sh all` | exit 0 |
