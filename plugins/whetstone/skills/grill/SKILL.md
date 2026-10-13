---
name: grill
description: Interview the user about a plan, a design or a decision until every branch is settled, with a recommended answer for each question. Use when the user asks to be grilled, wants to stress-test an idea, or a request has several readings that change what gets built.
---

# grill — settle every decision before the work starts

In a repository with `.scratchpad/dossier/`, use `dossier:grill` instead: it writes the same interview to a ledger that `ds:new` reads.

Map the request as a **design tree**: each decision branches into the decisions that depend on it. The **frontier** is every decision whose prerequisites are settled — the questions you can ask now without a guess at an answer you have not heard.

## Steps

1. **Find the facts yourself.** A question the repository, the tools or the web can answer is a fact, not a decision. Look it up, or send a subagent for a long search, and ask the other questions while it runs. Only the questions that depend on that fact wait. Done when each open node is a fact with its source or a decision for the user.
1. **Ask the frontier in one round.** Number the questions across rounds. Give each a recommended answer that names what backs it: the `path:line`, the command or the URL you probed. A taste call says so. Word each question so that "yes" accepts the recommendation. Use the format below, then wait for the answers.
1. **Recompute the frontier.** Each answer settles nodes and unblocks others. A question that depends on another question still open goes to a later round. When an answer changes a premise, re-derive each earlier recommendation that rested on it and ask again the ones that change.
1. **Audit the set.** Before the last round closes, read the decisions together against the constraints the user stated. Two decisions that conflict, or a decision that breaks a constraint, go back to the user as a new question.
1. **Stop on an empty frontier and a confirmation.** Every branch is visited and nothing is silently assumed. Summarise the decisions, one line each, and act only after the user confirms the summary.

```
❓ **Q<n>** - **<question title>**: <the question, with the options when there are several>

➡️ <recommended answer> — <what backs it>
```

## A decision the user cannot answer

When a decision needs someone outside the conversation, write a questionnaire for that person with [questionnaire.md](reference/questionnaire.md). Mark the decision as waiting on it, and go on with the branches that do not depend on it.

## Honesty labels

| claim                                       | enforced by                                              |
| ------------------------------------------- | -------------------------------------------------------- |
| a fact is looked up, not asked              | model-judgment — no script tells a fact from a decision  |
| a recommendation names what backs it        | model-judgment — `ds grill-add` exits 64 on a missing `probe=`; this skill has no such check |
| the frontier is empty                       | model-judgment — no fixed tree exists to check against   |
| the user confirmed                          | model-judgment — the confirmation is the user's own text |
