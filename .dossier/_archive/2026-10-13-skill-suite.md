# skill-suite contract

| field       | value                                                                                 |
| ----------- | ------------------------------------------------------------------------------------- |
| consumer    | The operator, in any project where whetstone is installed                             |
| reached-via | `/plugin` install of whetstone from this marketplace; the skills route by description |
| budget      | 35 commits                                                                            |

## done-when

| id  | command                                                                                     | expect |
| --- | ------------------------------------------------------------------------------------------- | ------ |
| 1   | `test -s .scratchpad/dossier/2026-10-13-skill-suite/overlap.md`                             | exit 0 |
| 2   | `plugins/dossier/cli/ds assert-grill .scratchpad research-report`                           | exit 0 |
| 3   | `node_modules/.bin/vitest run`                                                              | exit 0 |
| 4   | `plugins/whetstone/bin/lint-skill plugins/whetstone/skills`                                 | exit 0 |
| 5   | `claude plugin validate plugins/whetstone`                                                  | exit 0 |
| 6   | `node_modules/.bin/oxlint --deny-warnings`                                                  | exit 0 |
| 7   | `node_modules/.bin/oxfmt --check`                                                           | exit 0 |
| 8   | `node_modules/.bin/tsc -p .`                                                                | exit 0 |
| 9   | `git ls-files '*.md' \| grep -v tests/fixtures/ \| xargs plugins/whetstone/bin/claim-check` | exit 0 |
| 10  | `python3 tools/check_rows.py`                                                               | exit 0 |
| 11  | `test -d plugins/whetstone/skills/html-report && test -d plugins/whetstone/skills/research-report` | exit 0 |
| 12  | `test -f plugins/whetstone/agents/whetstone-scout.md && test -f plugins/whetstone/agents/whetstone-grounder.md` | exit 0 |
| 13  | `test -f plugins/whetstone/workflows/verify-claims.js` | exit 0 |
| 14  | `plugins/whetstone/bin/html-report plugins/whetstone/tests/fixtures/report.md /tmp/skill-suite-report.html` | exit 0 |
| 15  | `claude plugin test plugins/whetstone` | exit 0 |
| 16  | `claude plugin validate plugins/dossier` | exit 0 |
| 17  | `! grep -q mattpocock-skills ~/.dotfiles/dot_claude/CLAUDE.md ~/.dotfiles/docs/SKILLS.md` | exit 0 |
| 18  | `! claude plugin list 2>/dev/null \| grep -q mattpocock-skills` | exit 0 |
