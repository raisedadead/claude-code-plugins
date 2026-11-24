---
name: ship
description: Review the dossier branch once, fold the fixup commits into the planned commits, land the branch with no further ask, then watch CI. Invoke when the user says "ds:ship", "ship the dossier", or when ds next exits 4.
---

# ds:ship

Run each `ds` command below in the dossier worktree, as `cd <worktree path> && ds ...`.

1. `ds check` must print `CHECK: OK`.
2. `ds pack review` writes the review pack. Spawn one `whetstone:reviewer` agent with its path. It writes the findings file that the pack names, which ends `VERDICT: PASS` or `VERDICT: CHANGES`. When the kernel orders a second review agent for the change, run `ds pack review --agent <its type>` for that agent: the pack then starts from the last record of that type.
3. `ds record review <findings>`. It logs the verdict in the worklog. On PASS it sets `state: ship`. The rig's hook writes the review record when the reviewer ends.
   - On CHANGES: add one row per accepted finding with `ds add`, plan its commit, build it with `/dossier:build`, and come back to step 1. When a review record exists, the next pack holds only the change since that review.
4. Run `ds shape`. It folds each `fixup!` commit into its planned commit. It refuses if the files would change.
5. Land the branch the way the kernel names for this repo. `ds ship-args` prints the worktree path, the branch, the base and the PR title.
   - A repo that gets a pull request: pass the four values to the ship tool with no further ask. The prompt of the tool is the operator's part. The tool can rename a `cc-` branch; `ds` follows the new name.
   - Any other repo: a fast-forward merge of the branch into the base in the main checkout, then the push of the base that the kernel allows.
6. After the push, run `ds ci` in the background. It waits for the CI runs of the branch tip, pushed on the branch or on the base. For a branch on a fork, it reads the runs in the parent repository too.
   - Exit 0 (`CI: OK` or `CI: NONE`): next is `/dossier:close`.
   - Exit 1: add one row per failed run with `ds add`, plan its commit, and build it with `/dossier:build`. The fix is a new planned commit.
   - Exit 2: report its error line.
   - Exit 3, a run that waits for approval: the operator approves it at its URL, on a Do card.
   - Exit 3, a run that has not ended: run `ds ci` again in the background.

At the end of each turn, run `ds handoff` and print none of its lines. Start each step it names that is yours, unless its helper or its background command still runs. Put its `operator:` rows on one card, last: a Run card for a command, else a Do card.

Fixes after the first push become new planned commits. `ds shape` does not rewrite a pushed commit.
