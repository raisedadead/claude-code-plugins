# shell-tests-to-vitest contract

| field       | value                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| consumer    | The operator and every contributor, each time the pre-push hook or CI runs the dossier test suite      |
| reached-via | `bash tools/ci.sh all`, which `.githooks/pre-push` and `.github/workflows/ci.yml` both run             |
| budget      | 20 commits                                                                                             |

## done-when

| id  | command | expect |
| --- | ------- | ------ |
| 1   | `git ls-files 'plugins/dossier/hooks/test_*.sh'` | stdout: (nothing) |
| 2   | `pnpm vitest run plugins/dossier/tests/test_*.ts plugins/whetstone/tests/test_*.ts` | exit 0 |
| 3   | `pnpm oxfmt --check` | exit 0 |
| 4   | `pnpm oxlint --deny-warnings` | exit 0 |
| 5   | `pnpm tsc -p .` | exit 0 |
| 6   | `claude plugin test plugins/dossier` | exit 0 |
| 7   | `grep -q 'export async function main(args: string\[\]): Promise<number>' plugins/dossier/cli/dispatch.ts` | exit 0 |
| 8   | `grep -q 'hooks/\*\.sh' tools/ci.sh` | exit 1 |
| 9   | `bash tools/ci.sh dossier` | exit 0 |
