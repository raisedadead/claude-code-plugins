# few-tools-skills contract

| field       | value |
| ----------- | ----- |
| consumer    | Every session that has the dossier and whetstone plugins installed from this marketplace: after a plugin refresh it loads the skills, agents and `ds` from `main` |
| reached-via | `plugins/dossier/` and `plugins/whetstone/` on `main`, installed through `.claude-plugin/marketplace.json` |
| budget      | 45 commits |

## done-when

| id  | command | expect |
| --- | ------- | ------ |
| 1   | `bash tools/ci.sh all` | exit 0 guard |
| 2   | `bash -c 'test "$(ls plugins/*/skills/*/SKILL.md \| wc -l \| tr -d " ")" = 19'` | exit 0 |
| 3   | `grep -rn --exclude=CHANGELOG.md --exclude-dir=results -e whetstone:wizard -e whetstone:merge-resolve -e whetstone:flaky-test-audit -e dossier:check -e 'ds:check[^-]' -e 'ds:check$' -e skills/wizard/ -e skills/merge-resolve/ -e skills/flaky-test-audit/ -e skills/check/ plugins README.md ARCHITECTURE.md .claude-plugin .claude/skills tools` | exit 1 |
| 4   | `bash -c 'test "$(grep -c "subagent_type: dossier:dossier-builder" plugins/dossier/skills/build/SKILL.md)" = 1'` | exit 0 |
| 5   | `grep -q general-purpose plugins/dossier/skills/build/SKILL.md` | exit 1 |
| 6   | `grep -q '^effort: medium' plugins/whetstone/agents/whetstone-grounder.md` | exit 0 |
| 7   | `bash -c 'grep -l "by this prompt alone" plugins/*/agents/*.md'` | exit 1 |
| 8   | `bun test ./plugins/dossier/tests/test_new_finish.ts` | exit 0 |
| 9   | `bun test ./plugins/whetstone/tests/test_verify_clean.ts ./plugins/whetstone/tests/test_flake_runner.ts` | exit 0 |
| 10  | `bash -c 'test ! -e plugins/whetstone/skills/merge-resolve/scripts/verify_clean.sh && test ! -e plugins/whetstone/skills/flaky-test-audit/scripts/flake_runner.sh && ! compgen -G "plugins/whetstone/scripts/*.sh"'` | exit 0 |
| 12  | `bun test ./plugins/dossier/tests/test_design_check.ts` | exit 0 |
| 11  | `test -e plugins/whetstone/skills/diagnose/scripts/hitl-loop.template.sh` | exit 1 |
