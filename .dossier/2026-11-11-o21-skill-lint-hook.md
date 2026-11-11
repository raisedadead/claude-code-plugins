# o21-skill-lint-hook contract

| field       | value                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| consumer    | Anyone with whetstone installed who writes or edits a SKILL.md with Claude Code, in any project          |
| reached-via | `plugins/whetstone/hooks/hooks.json` → `register.ts` PostToolUse on install; `bin/lint-skill <dir>` in CI |
| budget      | 6 commits                                                                                               |

## done-when

| id  | command | expect |
| --- | ------- | ------ |
| 1   | `claude plugin test plugins/whetstone` | exit 0 |
| 2   | `grep -q 'sharedTriggers' plugins/whetstone/skills/skill-smith/scripts/lint-skill-cli.ts` | exit 0 |
| 3   | `grep -q 'PostToolUse' plugins/whetstone/hooks/register.ts` | exit 0 |
| 4   | `grep -qE '^\| O21 ' RESEARCH.md` | exit 1 |
| 5   | `grep -q 'whetstone skill lint' ARCHITECTURE.md` | exit 0 |
| 6   | `python3 tools/check_rows.py` | exit 0 |
| 7   | `bash tools/ci.sh all` | exit 0 |
