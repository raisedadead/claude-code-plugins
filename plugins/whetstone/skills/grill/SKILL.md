---
name: grill
description: Interview the user about a plan, a design or a decision until every branch is settled, with a recommended answer for each question. Use when the user asks to be grilled, wants to stress-test an idea, or a request has several readings that change what gets built.
---

# grill — settle every decision before the work starts

In a repository with `.scratchpad/dossier/`, use `/dossier:plan`: it runs this interview and writes the answers into the plan.

Map the request as a **design tree**: the goal is the root, and each decision branches into the decisions that depend on it. The **frontier** is every decision whose prerequisites are settled — the questions you can ask now without a guess at an answer you have not heard.

## Steps

1. **Start from the goal.** Write the goal in the user's words, and what a good result is. When either is unknown, ask for it first, alone and with no recommendation: a recommendation serves a goal, and there is none yet.
1. **Find the facts yourself.** A question the repository, the tools or the web can answer is a fact, not a decision. Look it up, or send a subagent for a long search. Ask only what the session cannot settle. Done when each open node is a fact with its source or a decision for the user.
1. **Ask one section at a time.** A section is the decisions of the frontier that share their facts. Take the section that the most open decisions depend on. Ask it as one decision block, in the format below, then wait for the answers. Number the decisions across sections, so a reply reads "2b, 3c". Put the recommended option first, labelled `Recommended:`. It names what backs it: the `path:line`, the command or the URL you probed. A taste call says so. Every option states what it changes or costs.
1. **Recompute the frontier.** Each answer settles nodes and unblocks others. Keep the list of settled decisions, and ask none of them twice. When an answer changes a premise, re-derive each earlier recommendation that rested on it, and ask again only the ones that change, with the answer that changed them. A decision that depends on an open one in the same section rides in the block with a "Skip if" note. "Discuss more" on a decision splits it into the decisions it hides; ask them as new numbered decisions.
1. **Audit the set.** Before the last section closes, read the decisions together against the constraints the user stated. Two decisions that conflict, or a decision that breaks a constraint, go back to the user as a new question.
1. **Stop on an empty frontier and a confirmation.** Every branch is visited and nothing is silently assumed. Summarise the decisions, one line each, and act only after the user confirms the summary.

```
<the fact that is dangerous now, with its source; omit when none>

<section topic>: the decisions, in plain English. Each has my recommendation first.

<facts the section's decisions share, one bullet each, with source; omit when none>

1. <question, one sentence>
   - (a) Recommended: <option>. <what it changes or costs>, backed by <source>
   - (b) <option>. <what it changes or costs>
2. <question> Skip if 1(b).
   - ...

Answer decisions 1–2. You can reply "all recommended" and list only the ones you want differently.
```

- Write each fact once, above the decisions that use it.
- End the block on the answer line.

## A decision the user cannot answer

When a decision needs someone outside the conversation, write a questionnaire for that person with [questionnaire.md](reference/questionnaire.md). Mark the decision as waiting on it, and go on with the branches that do not depend on it.

## Honesty labels

| claim                                       | enforced by                                              |
| ------------------------------------------- | -------------------------------------------------------- |
| a fact is looked up, not asked              | model-judgment — no script tells a fact from a decision  |
| a recommendation names what backs it        | model-judgment — this skill has no check for it |
| no recommendation comes before the goal     | model-judgment — this skill has no check for it |
| a settled decision is not asked twice       | model-judgment — the list of settled decisions is the session's own |
| the frontier is empty                       | model-judgment — no fixed tree exists to check against   |
| the user confirmed                          | model-judgment — the confirmation is the user's own text |
