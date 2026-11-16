# dossier

One plan file per piece of work, and a `ds` command for every step that gives the same result each time. A model does only the judgement: the questions, the plan text, the code, the review and the conflicts.

- Skills: `/dossier:plan`, `/dossier:build`, `/dossier:ship`, `/dossier:close`, plus `/dossier:backprop` and `/dossier:verify`.
- Hook: at session start, after `/clear` and on resume, `ds triage --start` shows deferred rows that are now due, rows out of shape, and dossiers whose plan changed after its check. It shows nothing when there are none. It does not run after compaction.
- Commands: `ds help`. File shapes: [`FORMAT.md`](FORMAT.md).

The plugin is built for one operator's rig. It names the rig's agent roles (`plan-checker`, `reviewer`, `gatherer`) and keeps its ID counter under `~/.local/state/ds/`. See [`ADAPTERS.md`](ADAPTERS.md).
