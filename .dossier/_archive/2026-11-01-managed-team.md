# managed-team contract

| field       | value                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| consumer    | The operator, in any repo with dossier installed, when `ds:build` hands a task row to a builder subagent |
| reached-via | `/plugin` install from this marketplace, then a plugin refresh; `ds:build` names the delegate route       |
| budget      | 25 commits                                                                                              |

## done-when

| id  | command | expect |
| --- | ------- | ------ |
| 1   | `pnpm vitest run plugins/dossier/tests/test_*.ts plugins/whetstone/tests/test_*.ts` | exit 0 |
| 2   | `pnpm oxfmt --check` | exit 0 |
| 3   | `pnpm oxlint --deny-warnings` | exit 0 |
| 4   | `pnpm tsc -p .` | exit 0 |
| 5   | `git ls-files '*.md' \| grep -v tests/fixtures/ \| xargs plugins/whetstone/bin/claim-check` | exit 0 |
| 6   | `python3 tools/test_check_rows.py` | exit 0 |
| 7   | `python3 tools/check_rows.py` | exit 0 |
| 8   | `python3 tools/census/test_census.py` | exit 0 |
| 9   | `plugins/whetstone/bin/lint-skill plugins/dossier/skills` | exit 0 |
| 10  | `claude plugin validate plugins/dossier` | exit 0 |
| 11  | `claude plugin test plugins/dossier` | exit 0 |
| 12  | `grep -q 'general-purpose' plugins/dossier/skills/build/SKILL.md` | exit 0 |
| 13  | `plugins/dossier/cli/ds delegation-check .scratchpad/dossier/2026-11-01-managed-team` | exit 0 |
| 14  | `bash tools/rails_ceiling.sh` | exit 0 |
| 15  | `claude plugin test plugins/whetstone` | exit 0 |
