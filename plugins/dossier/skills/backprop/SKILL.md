---
name: backprop
description: Turn a bug into a row and a check, so it cannot come back. Invoke when the user says "ds:backprop", "bug:", or reports a defect found after a dossier shipped.
argument-hint: <bug description>
---

# ds:backprop

A bug is a row plus a check.

1. Find the root cause with a `gatherer` agent. Ask for exact lines and `file:line`.
2. Write a check that fails today because of the bug. Add it to `## Checks`. If it must hold for good, mark it a guard.
3. `ds add "Fix <bug>"`. Plan its commit in `## Commits`, and tie the check to the row.
4. If the plan was already checked, run the plan steps again from `ds lint` (see `/dossier:plan`).
5. Build it with `/dossier:build`.

With no live dossier, add the row to the register with `ds add "<title>" --register` and start a dossier for it with `/dossier:plan`.
