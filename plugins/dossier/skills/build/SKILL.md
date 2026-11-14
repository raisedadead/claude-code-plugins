---
name: build
description: Build the rows of a checked dossier plan, one scoped builder per row. Invoke when the user says "ds:build", "build the dossier", "build next", or "--auto".
argument-hint: '[--auto]'
---

# ds:build

The build runs in a `team-lead` agent, not in the main session. Spawn it once per session with the dossier path, and send it new work with SendMessage. Its agent file holds the loop below. With `--auto`, it keeps going until a row waits on the operator.

## The loop

1. `ds anchors`, once. It makes one empty commit per planned commit on the dossier branch. It refuses a plan with no passing check.
2. `ds lanes` groups the planned commits whose paths do not overlap. For each lane after the first, run `wt switch --create <lane branch>` from the dossier branch.
3. `ds next` prints the next row.
   - Exit 3: a row waits on the operator. Report it and stop.
   - Exit 4: no row is left. Run `ds check`, then hand back for `/dossier:ship`.
4. `ds mission <id>` writes the task file. Spawn a `builder` agent in the row's lane with only that path. The builder commits with the exact `fixup!` command in the file.
5. `ds verify <id>`. On PASS, read the diff against the row and its plan line, then `ds done <id>`. On FAIL, send one retry with the failure. A second FAIL: `ds set <id> wait "<reason>"`, and report it.
6. When a lane is done: `ds integrate <lane>`. On a conflict, the `committer` resolves it.
7. Go back to step 3.

A row with no code, such as a decision, is closed with `ds done <id> --cite "<decision>"`. Each hand-back names the row and the dossier path, since the main session may have been cleared, and ends with the lines `ds handoff` prints.
