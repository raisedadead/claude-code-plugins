# dossier

One plan file per piece of work, and a `ds` command for every step that gives the same result each time. A model does only the judgement: the questions, the plan text, the code, the review and the conflicts.

- Skills: `/dossier:plan`, `/dossier:build`, `/dossier:ship`, `/dossier:close`, plus `/dossier:backprop` and `/dossier:verify`.
- Hook: at session start, after `/clear` and on resume, `ds triage --start` shows deferred rows that are now due, rows out of shape, and dossiers whose plan changed after its check. It shows nothing when there are none. It does not run after compaction.
- Status line: at session start and after each turn, the line under the prompt shows what `ds status` prints: the state, the done rows, the next agent row and the rows that wait on you. For several live dossiers it shows a short form of each, such as `demo plan 0/3 · you 1`. It shows nothing when no dossier is live.
- Commands: `ds help`. File shapes: [`FORMAT.md`](FORMAT.md).

The plugin is built for one operator's rig. It names the whetstone agents (`whetstone:plan-checker`, `whetstone:reviewer`, `whetstone:gatherer`) and keeps its ID counter under `~/.local/state/ds/`. See [`ADAPTERS.md`](ADAPTERS.md).
