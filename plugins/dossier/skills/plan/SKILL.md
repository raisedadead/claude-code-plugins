---
name: plan
description: Open a dossier and write its plan with the operator, then get it checked by a fresh agent before any build. Invoke when the user says "ds:plan", "start a dossier", "plan this", "grill me" in a repo with `.scratchpad/dossier/`, or when work needs more than one commit.
argument-hint: <slug> [goal sentence]
---

# ds:plan

You are the Chief of Staff. You ask the questions and write the plan text. The `ds` commands do every step that gives the same result each time. Do not copy lines, count, rename or move rows by hand.

## Steps

1. `ds new <slug>` prints the plan file. Fill it in this order. `FORMAT.md` in this plugin has the exact shape.
   - **Goal**: the operator's words, quoted.
   - **Scope**: one `- in:` line and one `- out:` line.
   - **Decisions**: grill the operator with the `whetstone:grill` method: decision blocks, the recommendation first, a later round for an answer that adds or removes questions, and a fresh ask when an answer changes a premise. Look up each fact with a `whetstone:gatherer` agent. Write one numbered line per decision, `<question> — <answer> · <date>`.
     - "Discuss more" on a decision: answer it `split into <n>, <m>` and ask the parts as new numbered decisions.
     - A decision only someone outside the room can answer: write the `whetstone:grill` questionnaire to `questionnaire-<n>.md` in the dossier folder (`ds path`), answer the decision `waits on <who>: <questionnaire path>`, and add a row for it with `ds add "<title>" --who H --state wait`.
     - Then add `confirmed: "<the operator's words>"`.
   - **Rows**: add each with `ds add "<title>"`, never by hand, before any section names it. Put row detail under `## Notes` as `### O<N>`.
   - **Checks**: each check is a command that fails today and passes when the work is done. A guard check passes today and must stay green. For a check that reads files of the tree, write its sample: the files as the finished work leaves them, under `samples/<check name>/` in the dossier folder (`ds path`). For a guard, the sample holds the fault it must catch. `ds check --baseline` runs each check on its sample.
   - **Edge cases**: `- <case> → <row or check>`.
   - **Commits**: the planned commits, with subject, rows and paths. Plan few commits, and keep each one whole.
2. Run `ds lint` until it prints `LINT: OK`.
3. Run `ds check --baseline` until it prints `BASELINE: OK`.
4. Run `ds pack plan`. In one message, spawn one `whetstone:plan-checker` agent with the pack path, and, on the first check only, the subtraction pass: `whetstone:whetstone-doubter` with the subtraction mission of `whetstone:doubt-pass`, the pack as the artifact, Goal and Scope as the contract, and `model` set to this session's model family. The plan checker writes a findings file that ends `VERDICT: PASS` or `VERDICT: CHANGES`.
5. Run `ds record plan <findings>`.
   - Exit 0: the plan check passed.
   - Exit 1: change the plan for each finding, then repeat steps 2 to 5.
   - Exit 3: this was the second CHANGES. Show the findings to the operator and stop.
6. The subtraction pass: show its cuts to the operator in one decision block, and take only the cuts the operator picks. Then `ds log "subtract: <its first line>; took <cut numbers or none>"`; without Whetstone, `ds log "subtract: skipped, no Whetstone"`. Until that line is in the worklog, `ds handoff` asks for the cuts. A taken cut changes the plan, so repeat steps 2 to 5 without the subtraction pass.

End the turn with the lines `ds handoff` prints.

Discovery is the long part of the work. Leave no guess in the plan: a surprise that a review finds later is a gap in this step.
