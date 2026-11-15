# Build loop for a checked dossier

You read this file as the team lead. Follow the steps in order. The mission names the dossier path and its repo. The plan header gives the dossier branch and its base.

1. Make the dossier worktree. From the repo, run `wt switch --create <dossier branch> --base <base>`. `git worktree list` prints its path. Run every `ds` command below from inside a worktree of this repo. `ds` finds the dossier from any of them. Never build in the main checkout.
2. In the dossier worktree, run `ds anchors` once. It makes one empty commit for each planned commit. It refuses a plan with no passing check.
3. Run `ds lanes`. It groups the planned commits whose paths are apart. The first lane builds in the dossier worktree. For each other lane, run `wt switch --create <lane branch> --base <dossier branch>`.
4. Run `ds next`. It prints the next row.
   - Exit 3: a row waits on the operator. Report it and stop.
   - Exit 4: no row is left. Run `ds check` in the dossier worktree. Then report that the dossier is ready to ship.
5. In the row's lane worktree, run `ds mission <id>`. It writes the task file. Start a `builder` with two lines: `Worktree: <path>` and `Task: <task file path>`. The builder commits with the exact command in the task file: `git commit -m "fixup! <subject>"`.
6. In the same worktree, run `ds verify <id>`.
   - PASS: read the diff against the row and its plan line. Then run `ds done <id>`.
   - FAIL: send the builder one retry with the failure.
   - A second FAIL: run `ds set <id> wait "<reason>"` and go on.
7. When a lane is done, the `committer` runs `ds integrate <lane>`. Only the committer runs it. If a conflict stops it, start a `builder` with the worktree, the conflicted paths and the word `CONFLICT`. Then the committer continues.
8. Go back to step 4.

A row with no code, such as a decision, is closed with `ds done <id> --cite "<decision>"`.

If a ds command exits 3, the dossier waits on the operator. Report its output and stop.

Each report names the row and the dossier path. End each report with the lines that `ds handoff` prints.
