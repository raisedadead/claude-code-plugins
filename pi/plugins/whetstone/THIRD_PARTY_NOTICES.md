## Pi runtime

Resolve bundled paths against this file, not the project working directory. The plugin root is `.` from this file's directory. Before each shell call that uses `$WHETSTONE_PLUGIN_ROOT`, set that variable to the shell-quoted absolute plugin root in that same shell. Pi does not supply it. Keep the shell working directory in the consuming project.

Load another installed skill with `read` on its advertised SKILL.md path; user commands use `/skill:<name>`. Check the available skills and tools before an optional sibling route. An absent sibling means skip, never install or scan caches. Pi does not add plugin bin directories to PATH: resolve bundled tools by absolute path. For dossier-to-whetstone script routes, check `../whetstone/bin/<tool>` relative to dossier's plugin root; if absent, use the documented absent-skip result.

Use `read/edit/write/bash/grep/find` for the corresponding host operations. Fresh missions use `dossier_delegate` or `whetstone_delegate` for that plugin's named agents, with unqualified `agent` and artifact-only `task`. The tool uses the current model unless the operator supplies an exact `provider/model`. Builders use `agent: general-purpose, write: true`; named reviewers cannot use edit/write. Bash read-only is prompt-only, not a sandbox. A return is final: a follow-up mission is a fresh call, not a message to a retained agent. Parallel independent missions may use concurrent calls.

Web tools and advisor tools are optional. Use installed web tools when present, or read-only `curl`/`gh api` through bash; identify any inaccessible source. The Pi extension supplies mutation guards and model-facing advisories. The task ledger is authoritative; `/dossier-tasks` is a read-only view, not a second task store.

# Third-party notices

These files are copied or adapted from [mattpocock/skills](https://github.com/mattpocock/skills) at commit `49dd158d1076134a641b33efb035946536778336` (2026-10-09):

| here | upstream |
| ---- | -------- |
| `skills/grill/SKILL.md` | `skills/productivity/grilling/SKILL.md` |
| `skills/grill/reference/questionnaire.md` | `skills/productivity/to-questionnaire/SKILL.md` |
| `skills/diagnose/` | `skills/engineering/diagnosing-bugs/` |
| `skills/prototype/` | `skills/engineering/prototype/` |
| `skills/wizard/` | `skills/engineering/wizard/` |
| `skills/domain-modeling/` | `skills/engineering/domain-modeling/` |
| `skills/codebase-design/` | `skills/engineering/codebase-design/` |
| `skills/codebase-design/reference/architecture-review.md` | `skills/engineering/improve-codebase-architecture/SKILL.md` |
| `skills/skill-smith/reference/writing-for-agents.md`, `skill-mechanics.md` | `skills/productivity/writing-for-agents/` |
| `skills/tdd-cycle/reference/mocking.md`, `examples.md` | `skills/engineering/tdd/mocking.md`, `tests.md` |

The upstream licence applies to those files:

```text
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
