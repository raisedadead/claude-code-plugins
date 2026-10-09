# toolchain contract

| field       | value                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------- |
| consumer    | The operator and Claude sessions that push to this repo                                  |
| reached-via | `pnpm install`, then `git push` runs `.githooks/pre-push`; CI runs on each push and PR   |
| budget      | 12 commits                                                                               |

## done-when

| id  | command                                                                                                   | expect             |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | `node_modules/.bin/vitest run`                                                                            | exit 0             |
| 2   | `git grep -l "from 'node:test'" -- 'plugins/*/tests/'`                                                    | stdout: (nothing)  |
| 3   | `s=$(date +%s); node_modules/.bin/vitest run >/dev/null 2>&1; echo "fast=$(( $(date +%s) - s < 8 ))"`      | stdout: fast=1     |
| 4   | `node_modules/.bin/oxlint --deny-warnings`                                                                | exit 0             |
| 5   | `node_modules/.bin/oxfmt --check`                                                                         | exit 0             |
| 6   | `node_modules/.bin/tsc -p .`                                                                              | exit 0             |
| 7   | `bash tools/test_pre_push.sh`                                                                             | exit 0             |
| 8   | `grep -cE 'vitest run\|oxlint --deny-warnings\|oxfmt --check\|tsc -p' .github/workflows/ci.yml`            | stdout: 5          |
| 9   | `claude plugin validate . && claude plugin validate plugins/dossier && claude plugin validate plugins/whetstone` | exit 0       |
| 10  | `claude plugin test plugins/dossier && claude plugin test plugins/whetstone`                              | exit 0             |
| 11  | `git ls-files '*.md' \| grep -v tests/fixtures/ \| xargs plugins/whetstone/bin/claim-check`               | exit 0             |
| 12  | `python3 tools/check_rows.py`                                                                             | exit 0             |
