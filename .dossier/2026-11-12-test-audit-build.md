# test-audit-build contract

| field       | value                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| consumer    | The operator and every agent that pushes this repo: `bash tools/ci.sh all` locally and the GitHub `ci` workflow |
| reached-via | the test files under `plugins/dossier/tests/` and `tools/`, run by `tools/ci.sh` and `.github/workflows` |
| budget      | 10 commits                                                                                              |

## done-when

| id  | command | expect |
| --- | ------- | ------ |
| 1   | `bash tools/ci.sh all` | exit 0 |
| 2   | `sh -c 'node_modules/.bin/vitest run --reporter=dot --maxWorkers=2 plugins/dossier/tests/ 2>&1 \| grep -E "Duration +([0-9]\|1[0-2])\.[0-9]+s"'` | exit 0 |
| 3   | `test -f plugins/dossier/tests/test_hook_contract.ts` | exit 0 |
| 4   | `grep -q 'elapsed < 1' plugins/dossier/tests/test_convergence_state.ts` | exit 1 |
| 5   | `grep -q 'test_the_repos_own_research_file_is_clean' tools/test_check_rows.py` | exit 1 |
| 6   | `sh -c 'grep -rl GIT_CONFIG_GLOBAL plugins/dossier/tests \| grep -q .'` | exit 0 |
| 7   | `python3 tools/check_rows.py` | exit 0 |
