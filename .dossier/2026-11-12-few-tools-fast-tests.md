# few-tools-fast-tests contract

| field       | value                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| consumer    | The operator and every session that pushes this repo: the pre-push hook and GitHub CI run `tools/ci.sh` on each push |
| reached-via | `tools/ci.sh`, `.githooks/pre-push` and `.github/workflows/ci.yml` on `main`                                        |
| budget      | 30 commits                                                                                                         |

## done-when

| id  | command | expect |
| --- | ------- | ------ |
| 1   | `bash tools/ci.sh all` | exit 0 guard |
| 2   | `bash -c 'TIMEFORMAT=%R; t=$( { time CI_STEPS=dossier-tests bash tools/ci.sh dossier >/dev/null 2>&1; } 2>&1 ); awk -v t="$t" "BEGIN { exit !(t < 3) }"'` | exit 0 |
| 3   | `bash -c 'TIMEFORMAT=%R; t=$( { time CI_STEPS=whetstone-tests bash tools/ci.sh whetstone >/dev/null 2>&1; } 2>&1 ); awk -v t="$t" "BEGIN { exit !(t < 3) }"'` | exit 0 |
| 4   | `bash -c 'TIMEFORMAT=%R; t=$( { time bash tools/ci.sh all >/dev/null 2>&1; } 2>&1 ); awk -v t="$t" "BEGIN { exit !(t < 10) }"'` | exit 0 |
| 5   | `CI_STEPS=node-tests bash tools/ci.sh all` | exit 0 |
| 6   | `CI_STEPS=coverage bash tools/ci.sh all` | exit 0 |
| 7   | `grep -q 'bun-version' .github/workflows/ci.yml` | exit 0 |
| 8   | `bun test ./plugins/dossier/tests/test_converge_pipe_scan.ts` | exit 0 |
| 9   | `bun test ./plugins/dossier/tests/test_close_contract_only.ts` | exit 0 |
| 10  | `grep -q 'The repo checks run on Vitest' RESEARCH.md` | exit 1 |
