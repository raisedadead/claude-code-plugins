## Pi runtime

Resolve bundled paths against this file, not the project working directory. The plugin root is `.` from this file's directory. Before each shell call that uses `$DOSSIER_PLUGIN_ROOT`, set that variable to the shell-quoted absolute plugin root in that same shell. Pi does not supply it. Keep the shell working directory in the consuming project.

Load another installed skill with `read` on its advertised SKILL.md path; user commands use `/skill:<name>`. Check the available skills and tools before an optional sibling route. An absent sibling means skip, never install or scan caches. Pi does not add plugin bin directories to PATH: resolve bundled tools by absolute path. For dossier-to-whetstone script routes, check `../whetstone/bin/<tool>` relative to dossier's plugin root; if absent, use the documented absent-skip result.

Use `read/edit/write/bash/grep/find` for the corresponding host operations. Fresh missions use `dossier_delegate` or `whetstone_delegate` for that plugin's named agents, with unqualified `agent` and artifact-only `task`. The tool uses the current model unless the operator supplies an exact `provider/model`. Builders use `agent: general-purpose, write: true`; named reviewers cannot use edit/write. Bash read-only is prompt-only, not a sandbox. A return is final: a follow-up mission is a fresh call, not a message to a retained agent. Parallel independent missions may use concurrent calls.

Web tools and advisor tools are optional. Use installed web tools when present, or read-only `curl`/`gh api` through bash; identify any inaccessible source. The Pi extension supplies mutation guards and model-facing advisories. The task ledger is authoritative; `/dossier-tasks` is a read-only view, not a second task store.

# Pi adapters

The native extensions register independent delegation tools and lifecycle hooks. Use `dossier_delegate` for dossier missions, `whetstone_delegate` for whetstone missions, and `whetstone_verify_claims` for sourced grounding. Check tool availability before a sibling route. Missing siblings are skipped. Optional context7 and web tools remain detect-and-skip. No Workflow API or Claude settings are required.
