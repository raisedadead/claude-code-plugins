# done-checks-judge-work contract

| field       | value                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| consumer    | The operator and every model session that runs a dossier wave in any repo, through `ds converge`, `ds close` and `ds handoff` |
| reached-via | the dossier plugin installed from `main` (D1), its `cli/ds` verbs and the `ds:build`, `ds:new` and `ds:converge` skills        |
| budget      | 15 commits                                                                                                                  |

## done-when

| id  | command | expect |
| --- | ------- | ------ |
| 1   | `node_modules/.bin/vitest run plugins/dossier/tests/test_converge_one_form.ts` | exit 0 |
| 2   | `node_modules/.bin/vitest run plugins/dossier/tests/test_converge_baseline.ts` | exit 0 |
| 3   | `node_modules/.bin/vitest run plugins/dossier/tests/test_close_contract_edit.ts` | exit 0 |
| 4   | `node_modules/.bin/vitest run plugins/dossier/tests/test_guard_scope.ts` | exit 0 |
| 5   | `node_modules/.bin/vitest run plugins/dossier/tests/test_handoff_goal.ts` | exit 0 |
| 6   | `grep -q 'printed DONE' plugins/dossier/engine/handoff.ts` | exit 1 |
| 7   | `grep -q 'Three files still spawn' RESEARCH.md` | exit 1 |
| 8   | `grep -qF '[\|]' plugins/dossier/FORMAT.md` | exit 0 |
| 9   | `grep -q 'second workaround' plugins/dossier/skills/build/SKILL.md` | exit 0 |
| 10  | `bash tools/ci.sh all` | exit 0 |
