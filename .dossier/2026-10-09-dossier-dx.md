# dossier-dx contract

| field       | value                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------- |
| consumer    | The operator and anyone who installs the dossier plugin, in each session that opens a wave        |
| reached-via | `raisedadead-plugins` marketplace → `/plugin update` → `/reload-plugins` in a Claude Code session |
| budget      | 30 commits                                                                                        |

## done-when

| id  | command                                                                                                                                                   | expect      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | `node --test plugins/dossier/tests/test_*.ts`                                                                                                             | exit 0      |
| 2   | `bash plugins/dossier/hooks/test_lib_dossier_edit.sh && bash plugins/dossier/hooks/test_lib_regen.sh && bash plugins/dossier/hooks/test_session_start.sh` | exit 0      |
| 3   | `claude plugin validate plugins/dossier`                                                                                                                  | exit 0      |
| 4   | `claude plugin test plugins/dossier`                                                                                                                      | exit 0      |
| 5   | `plugins/whetstone/bin/lint-skill plugins/dossier/skills`                                                                                                 | exit 0      |
| 6   | `grep -c disable-model-invocation plugins/dossier/skills/grill/SKILL.md \|\| true`                                                                        | stdout: 0   |
| 7   | `sh plugins/dossier/cli/ds progress plugins/dossier/tests/fixtures/progress --line`                                                                       | stdout: 47% |
| 8   | `ls .dossier \| grep -c 'md$'`                                                                                                                            | stdout: 1   |
| 9   | `grep -c '^\|\|\|\|\|\|\|' RESEARCH.md \|\| true`                                                                                                         | stdout: 0   |
| 10  | `git ls-files '*.md' \| grep -v tests/fixtures/ \| xargs plugins/whetstone/bin/claim-check`                                                               | exit 0      |
