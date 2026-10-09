# release-oct contract

| field       | value                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| consumer    | The operator and anyone who installs dossier or whetstone; the operator's Claude and Pi sessions for the rig voice |
| reached-via | Plugins: the git tag and GitHub release, then `/plugin update`. Rig: `chezmoi apply` from `~/.dotfiles`            |
| budget      | 30 commits                                                                                                         |

## done-when

| id  | command                                                                                                   | expect    |
| --- | --------------------------------------------------------------------------------------------------------- | --------- |
| 1   | `node --test plugins/dossier/tests/test_*.ts plugins/whetstone/tests/test_*.ts`                            | exit 0    |
| 2   | `for t in plugins/dossier/hooks/test_*.sh plugins/whetstone/tests/test_*.sh; do bash "$t" > /dev/null \|\| exit 1; done` | exit 0    |
| 3   | `claude plugin validate plugins/dossier && claude plugin validate plugins/whetstone`                      | exit 0    |
| 4   | `claude plugin test plugins/dossier && claude plugin test plugins/whetstone`                              | exit 0    |
| 5   | `plugins/whetstone/bin/lint-skill plugins/dossier/skills plugins/whetstone/skills`                        | exit 0    |
| 6   | `test -e plugins/dossier/skills/ship; echo $?`                                                            | stdout: 1 |
| 7   | `git ls-files '*.md' \| grep -v tests/fixtures/ \| xargs plugins/whetstone/bin/claim-check`               | exit 0    |
| 8   | `git tag --points-at HEAD \| grep -cE '^(dossier\|whetstone)-v1\.0\.0$'` | stdout: 2 |
| 9   | `grep -c 'Keep an instruction to 20 words' ~/.dotfiles/dot_claude/output-styles/terse.md`                 | stdout: 1 |
| 10  | `test -f ~/.dotfiles/docs/CREDITS.md`                                                                     | exit 0    |
| 11  | `ls .dossier \| grep -c 'md$'`                                                                            | stdout: 1 |
