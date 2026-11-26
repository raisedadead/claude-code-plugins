# ADAPTERS.md: what the plugin expects from the rig

This plugin is built for one operator's Claude Code rig, and is not meant for anyone else who installs it. It expects these parts of that rig and does not fall back when one is missing.

| Part | Used by | Where it lives |
| --- | --- | --- |
| Agents `whetstone:plan-checker`, `whetstone:reviewer`, `whetstone:gatherer` | `/dossier:plan`, `/dossier:ship`, `/dossier:backprop` | the whetstone plugin |
| The read-only shell and scratch-only writes of those agents, which ship with `Bash` and `Write` | every spawn of them | the rig (`validators.ts`, from dot_claude ff36c41) |
| `wt switch --create --no-cd` for the dossier worktree and the lane worktrees | `/dossier:build` | worktrunk's `wt` |
| The ship tool, which takes the worktree path, pushes, opens the PR behind one prompt, and renames a `<type>/cc-<session>-<topic>` branch to `<type>/<topic>` with `git branch -m` | `/dossier:ship` | the rig's `mcp__rig__ship` |
| The landing rule: a pull request, or a fast-forward merge into the base | `/dossier:ship` | the rig's kernel (`CLAUDE.md`) |
| The hook that writes `reviews.jsonl` when a reviewer ends, from the `REVIEWED:` line that `ds pack review` prints. `ds` only reads the file | `/dossier:ship` | the rig (`reviewlog.ts`) |
| The worktree tool, which removes a shipped worktree | `/dossier:close` | the rig's `mcp__rig__worktree_remove` |
| `ds` on PATH | every skill | the chezmoi shim `~/.bin/ds` |
| The ID counter `~/.local/state/ds/next-id` | `ds add` | this plugin |

The rig reads `ds triage --json` and `ds rows --json --session <id>` for its band and its Work and Dossiers views. A command that a mod runs gets no `CLAUDE_CODE_SESSION_ID`, so the rig names the session with `--session`. FORMAT.md gives the shape of `ds rows`.

The commands need Node 22.18 or later and git. `ds triage` uses `gh` to check `after pr` triggers, and skips them when `gh` fails. `ds ci` needs `gh`, and exits 2 when `gh` fails (`tests/test_handoff.ts`).
