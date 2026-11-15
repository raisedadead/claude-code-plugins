---
name: build
description: Build the rows of a checked dossier plan, one scoped builder per row. Invoke when the user says "ds:build", "build the dossier", "build next", or "--auto".
argument-hint: '[--auto]'
---

# ds:build

The build runs in a `team-lead` agent, not in the main session. With `--auto`, it keeps going until a row waits on the operator.

Start the `team-lead` agent once per session. Its prompt gives the dossier path and the full path of `loop.md`, which sits beside this skill file (the skill's base directory). The prompt tells it to read that file and follow it. Send later builds to the same team lead with SendMessage.

When no row is left, the team lead reports it, and you hand back for `/dossier:ship`.

Each hand-back names the row and the dossier path, since the main session may have been cleared, and ends with the lines `ds handoff` prints.
