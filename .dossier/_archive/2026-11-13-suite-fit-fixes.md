# suite-fit-fixes contract

| field       | value                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| consumer    | The operator and every agent that runs the dossier and whetstone plugins, after a push and a plugin refresh                 |
| reached-via | the plugin cache: `claude plugin` update of `raisedadead-plugins`, then the skills, agents, workflows and hooks in `plugins/` |
| budget      | 14 commits                                                                                                                  |

## done-when

| id  | command | expect |
| --- | ------- | ------ |
| 1   | `bash tools/ci.sh all` | exit 0 guard |
| 2   | `bun -e 'for (const f of ["plugins/dossier/skills/new/SKILL.md", "plugins/dossier/skills/grill/SKILL.md"]) Bun.YAML.parse((await Bun.file(f).text()).split("---")[1])'` | exit 0 |
| 3   | `plugins/whetstone/skills/tdd-cycle/scripts/run_slice.sh red --expect boom sh -c 'echo boom; exit 1'` | exit 0 |
| 4   | `grep -q '2 failed fixes' plugins/whetstone/skills/diagnose/SKILL.md` | exit 0 |
| 5   | `sh -c 'test "$(grep -li "data, not instructions" plugins/*/agents/*.md \| wc -l)" -eq 7'` | exit 0 |
| 6   | `grep -q 'sec-default' RESEARCH.md` | exit 0 |
| 7   | `sh -c 'test "$(grep -c "a shell write is not checked" ARCHITECTURE.md)" -eq 4'` | exit 0 |
| 8   | `bun -e 'import { findingLines } from "./plugins/dossier/engine/verdicts.ts"; process.exit(findingLines("DOUBT: FAILURES\n- a → b\n## Caveats\n- c", "whetstone:whetstone-doubter").length === 1 ? 0 : 1)'` | exit 0 |
| 9   | `python3 -c 'import sys; sys.path.insert(0, "tools/census"); import census; sys.exit(0 if hasattr(census, "recurring_findings") else 1)'` | exit 0 |
| 10  | `test -f plugins/whetstone/agents/whetstone-reviewer.md` | exit 0 |
| 11  | `grep -q 'whetstone:whetstone-reviewer' plugins/whetstone/workflows/lens-review.js` | exit 0 |
| 12  | `grep -q 'lens-review' plugins/whetstone/THIRD_PARTY_NOTICES.md` | exit 0 |
| 13  | `grep -q "Extend built-ins, don't reinvent" ARCHITECTURE.md` | exit 1 |
| 14  | `sh -c 'test "$(grep -l sec-default README.md plugins/dossier/README.md plugins/whetstone/README.md \| wc -l)" -eq 3'` | exit 0 |
| 15  | `sh -c 'grep -q "red --expect" plugins/whetstone/skills/tdd-cycle/SKILL.md && grep -q "red --expect" plugins/dossier/skills/build/SKILL.md'` | exit 0 |
| 16  | `sh -c 'plugins/whetstone/skills/tdd-cycle/scripts/run_slice.sh green --expect boom true; test $? -eq 2'` | exit 0 |
