---
name: build
description: Build the rows of a checked dossier plan, one row at a time. Invoke when the user says "ds:build", "build the dossier", "build next", or "--auto".
argument-hint: '[--auto]'
---

# ds:build

The build runs in the main session. Read `loop.md`, which sits beside this skill file (the skill's base directory), and follow it. With `--auto`, keep going while `ds handoff` prints `next: /dossier:build`.

Before you end each turn, read `${CLAUDE_PLUGIN_ROOT}/TURN.md`. It says how a dossier turn ends.
