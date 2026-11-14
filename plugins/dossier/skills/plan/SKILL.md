---
name: plan
description: Open a dossier and write its plan with the operator, then get it checked by a fresh agent before any build. Invoke when the user says "ds:plan", "start a dossier", "plan this", or when work needs more than one commit.
argument-hint: <slug> [goal sentence]
---

# ds:plan

You are the Chief of Staff. You ask the questions and write the plan text. The `ds` commands do every step that gives the same result each time. Do not copy lines, count, rename or move rows by hand.

## Steps

1. `ds new <slug>` prints the plan file. Fill it in this order. `FORMAT.md` in this plugin has the exact shape.
   - **Goal**: the operator's words, quoted.
   - **Scope**: one `- in:` line and one `- out:` line.
   - **Decisions**: one numbered line per question, `<question> — <answer> · <date>`. Ask the operator each one that is theirs. Look up each fact with a `gatherer` agent. Then add `confirmed: "<the operator's words>"`.
   - **Rows**: add each with `ds add "<title>"`, never by hand, before any section names it. Put row detail under `## Notes` as `### O<N>`.
   - **Checks**: each check is a command that fails today and passes when the work is done. A guard check passes today and must stay green.
   - **Edge cases**: `- <case> → <row or check>`.
   - **Commits**: the planned commits, with subject, rows and paths. Plan few commits, and keep each one whole.
2. Run `ds lint` until it prints `LINT: OK`.
3. Run `ds check --baseline` until it prints `BASELINE: OK`.
4. Run `ds pack plan`. Spawn one `plan-checker` agent with the pack path. It writes a findings file that ends `VERDICT: PASS` or `VERDICT: CHANGES`.
5. Run `ds record plan <findings>`.
   - Exit 0: the plan is ready. Next is `/dossier:build`.
   - Exit 1: change the plan for each finding, then repeat steps 2 to 5.
   - Exit 3: this was the second CHANGES. Show the findings to the operator and stop.

Discovery is the long part of the work. Leave no guess in the plan: a surprise that a review finds later is a gap in this step.
