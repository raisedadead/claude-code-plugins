# suite-review-apply contract

| field       | value                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------- |
| consumer    | The operator, in any repo where dossier or whetstone is installed, and installers without the rig  |
| reached-via | `/plugin` install from this marketplace, then a plugin refresh; skills route by description        |
| budget      | 30 commits                                                                                         |

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
| 10  | `plugins/whetstone/bin/lint-skill plugins/whetstone/skills` | exit 0 |
| 11  | `claude plugin validate plugins/dossier` | exit 0 |
| 12  | `claude plugin validate plugins/whetstone` | exit 0 |
| 13  | `claude plugin test plugins/dossier` | exit 0 |
| 14  | `claude plugin test plugins/whetstone` | exit 0 |
| 15  | `grep -q 'First principles' ARCHITECTURE.md` | exit 0 |
| 16  | `grep -q 'SUBTRACT:' plugins/whetstone/skills/doubt-pass/SKILL.md` | exit 0 |
| 17  | `grep -q 'SubagentStop' plugins/dossier/hooks/register.tsx` | exit 0 |
| 18  | `ls plugins/*/evals/*/prompt.md \| wc -l \| tr -d ' '` | stdout: 17 |
| 19  | `grep -c '2.1.287' .github/workflows/ci.yml` | stdout: 0 |
