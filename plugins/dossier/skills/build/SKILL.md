---
name: build
description: Build the rows of a checked dossier plan, one row at a time. Invoke when the user says "ds:build", "build the dossier", "build next", or "--auto".
argument-hint: '[--auto]'
---

# ds:build

The build runs in the main session. Read `loop.md`, which sits beside this skill file (the skill's base directory), and follow it. With `--auto`, keep going until a row waits on the operator.

When no row is left, next is `/dossier:ship`.

End each turn with the row, the dossier path and the lines `ds handoff` prints. Put the `operator:` lines on one card that says what the operator does.
