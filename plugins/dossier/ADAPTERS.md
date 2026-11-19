# ADAPTERS.md: what the plugin expects from the rig

This plugin is built for one operator's Claude Code rig, and is not meant for anyone else who installs it. It expects these parts of that rig and does not fall back when one is missing.

| Part | Used by | Where it lives |
| --- | --- | --- |
| Agents `whetstone:plan-checker`, `whetstone:reviewer`, `whetstone:gatherer` | `/dossier:plan`, `/dossier:ship`, `/dossier:backprop` | the whetstone plugin |
| The read-only shell and scratch-only writes of those agents, which ship with `Bash` and `Write` | every spawn of them | the rig (`validators.ts`, from dot_claude ff36c41) |
| `wt switch --create` for lane worktrees | `/dossier:build` | worktrunk's `wt` |
| The ship tool, which pushes and opens the PR behind one card | `/dossier:ship` | the rig's `mcp__rig__ship` |
| The hook that writes `reviews.jsonl` when a reviewer ends. `ds` only reads it | `/dossier:ship` | the rig (`reviewlog.ts`) |
| `ds` on PATH | every skill | the chezmoi shim `~/.bin/ds` |
| The ID counter `~/.local/state/ds/next-id` | `ds add` | this plugin |

The commands need Node 22.18 or later and git. `ds triage` uses `gh` to check `after pr` triggers, and skips them when `gh` fails. `ds ci` needs `gh`, and exits 2 when `gh` fails (`tests/test_handoff.ts`).
