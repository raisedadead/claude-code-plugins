---
name: plan
description: Open a dossier and write its plan with the operator, then get it checked by a fresh agent before any build. Invoke when the user says "ds:plan", "start a dossier", "plan this", "grill me" in a repo with `.scratchpad/dossier/`, or when work needs more than one commit.
argument-hint: <slug> [goal sentence]
---

# ds:plan

You are the Chief of Staff. You ask the questions and write the plan text. The `ds` commands do every step that gives the same result each time. Do not copy lines, count, rename or move rows by hand.

## Discovery

Discovery is the long part of the work, and it comes before the plan text. A surprise that the plan check or a review finds later is a gap in this step.

- Read each file the plan changes, and each file or command that consumes it.
- Each fact in the plan carries its probe: the command and its result, or a `path:line`. A fact with no probe stays out of the plan.
- Run each command the plan hands out, a check or a step of a row, before it goes in: with `--help`, as a dry run, or on a sample.
- The row list is the build order. Put each row after the rows it needs, and name them in its tail as `after O<N>`: `ds next` hands out only a ready agent row (FORMAT.md, Rows). Put each operator row as late as the first row that needs it allows.

## Steps

1. `ds new <slug> --branch <branch>` prints the plan file. The branch is the name the kernel's worktree rule gives this session and topic; the build makes its worktree under that name. Fill the file in this order. `${CLAUDE_PLUGIN_ROOT}/FORMAT.md` has the exact shape.
   - **Goal**: the operator's words, quoted.
   - **Scope**: one `- in:` line and one `- out:` line.
   - **Decisions**: grill the operator with the `whetstone:grill` method: the goal first, then one section at a time, each a Decide card in the grill format. Ask only what the session cannot settle, and ask a settled decision again only when an answer changes its premise. Look up each fact with a `whetstone:gatherer` agent. Write one numbered line per decision, `<question> — <answer> · <date>`.
     - "Discuss more" on a decision: answer it `split into <n>, <m>` and ask the parts as new numbered decisions.
     - A decision only someone outside the room can answer: write the `whetstone:grill` questionnaire to `questionnaire-<n>.md` in the dossier folder (`ds path`), answer the decision `waits on <who>: <questionnaire path>`, and add a row for it with `ds add "<title>" --who H --state wait`.
     - Then add `confirmed: "<the operator's words>"`.
   - **Rows**: add each with `ds add "<title>"`, never by hand, before any section names it. Put row detail under `## Notes` as `### O<N>`.
   - **Checks**: each check is a command that fails today and passes when the work is done. A guard check passes today and must stay green. For a check that reads files of the tree, write its sample: the files as the finished work leaves them, under `samples/<check name>/` in the dossier folder (`ds path`). For a guard, the sample holds the fault it must catch. `ds check --baseline` runs each check on its sample.
   - **Edge cases**: `- <case> → <row or check>`.
   - **Commits**: the planned commits, with subject, rows and paths. Plan few commits, and keep each one whole.
2. Run `ds lint` until it prints `LINT: OK`.
3. Run `ds check --baseline` until it prints `BASELINE: OK`.
4. Run `ds pack plan`. In one message, spawn one `whetstone:plan-checker` agent with the pack path, and, on the first check only, the subtraction pass: `whetstone:whetstone-doubter` with the subtraction mission of `whetstone:doubt-pass`, the pack as the artifact, Goal and Scope as the contract, and no `model`. The pack names the findings file. The plan checker writes it, and it ends `VERDICT: PASS` or `VERDICT: CHANGES`.
5. Run `ds record plan <findings>`.
   - Exit 0: the plan check passed.
   - Exit 1: the checker asked for changes. The checker's job is to doubt. Your job is to rule on each finding, not to take it on its word. Write one line per finding in a rulings file in the dossier folder:
     - `block <n>: fixed: <the change, and the run or path:line that shows it works>`, or `block <n>: refused: <the run or path:line that shows the plan is right>`. Run the proof first.
     - `note <n>: taken: <the wrong result or the failed step>` only when, without the change, the build delivers a wrong result or a step that cannot be undone fails. Else `note <n>: row O<id>` for a follow-up row from `ds add`, or `note <n>: dropped: <reason>`.
     - Then run `ds lint`, `ds check --baseline` and `ds amend <rulings file>`. `ds amend` exits 1 until each finding has a ruling, the lint is clean and the baseline of this text is green.
   - A plan gets one plan check. Offer or recommend no other; the operator can order one. A changed Goal or Scope is a new plan: `ds amend` exits 1 on it, and steps 4 and 5 run again.
6. The subtraction pass: show its cuts in one Decide card, one numbered question per cut, with your pick, take or keep, as (a). Take only the cuts the operator picks. Then `ds log "subtract: <its first line>; took <cut numbers or none>"`; without Whetstone, `ds log "subtract: skipped, no Whetstone"`. Until that line is in the worklog, `ds handoff` asks for the cuts. A taken cut changes the plan: run `ds lint`, `ds check --baseline` and `ds amend <notes file>`, where the notes file names the cuts taken.

Before you end each turn, read `${CLAUDE_PLUGIN_ROOT}/TURN.md`. It says how a dossier turn ends. Each grill turn ends on its Decide card. When `ds handoff` asks for the subtraction cuts, the step 6 Decide card ends the turn.
