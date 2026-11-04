---
name: whetstone-grill
description: Interview the user about a plan, a design or a decision until every branch is settled, with a recommended answer for each question. Use when the user asks to be grilled, wants to stress-test an idea, or a request has several readings that change what gets built.
---
## Pi runtime

Resolve bundled paths against this file, not the project working directory. The plugin root is `../..` from this file's directory. Before each shell call that uses `$WHETSTONE_PLUGIN_ROOT`, set that variable to the shell-quoted absolute plugin root in that same shell. Pi does not supply it. Keep the shell working directory in the consuming project.

Load another installed skill with `read` on its advertised SKILL.md path; user commands use `/skill:<name>`. Check the available skills and tools before an optional sibling route. An absent sibling means skip, never install or scan caches. Pi does not add plugin bin directories to PATH: resolve bundled tools by absolute path. For dossier-to-whetstone script routes, check `../whetstone/bin/<tool>` relative to dossier's plugin root; if absent, use the documented absent-skip result.

Use `read/edit/write/bash/grep/find` for the corresponding host operations. Fresh missions use `dossier_delegate` or `whetstone_delegate` for that plugin's named agents, with unqualified `agent` and artifact-only `task`. The tool uses the current model unless the operator supplies an exact `provider/model`. Builders use `agent: general-purpose, write: true`; named reviewers cannot use edit/write. Bash read-only is prompt-only, not a sandbox. A return is final: a follow-up mission is a fresh call, not a message to a retained agent. Parallel independent missions may use concurrent calls.

Web tools and advisor tools are optional. Use installed web tools when present, or read-only `curl`/`gh api` through bash; identify any inaccessible source. The Pi extension supplies mutation guards and model-facing advisories. The task ledger is authoritative; `/dossier-tasks` is a read-only view, not a second task store.


# grill — settle every decision before the work starts

When the installed skills include `dossier-grill` and the repo has `.scratchpad/dossier/`, use `/skill:dossier-grill` instead: it writes the same interview to a ledger that `/skill:dossier-new` reads.

Map the request as a **design tree**: each decision branches into the decisions that depend on it. The **frontier** is every decision whose prerequisites are settled — the questions you can ask now without a guess at an answer you have not heard.

## Steps

1. **Find the facts yourself.** A question the repository, the tools or the web can answer is a fact, not a decision. Look it up, or send a subagent for a long search, and ask the other questions while it runs. Only the questions that depend on that fact wait. Done when each open node is a fact with its source or a decision for the user.
1. **Ask the frontier in one round.** Ask it as one decision block, in the format below, then wait for the answers. Number the decisions across groups and rounds, so a reply reads "2b, 3c". Put the recommended option first, labelled `Recommended:`. It names what backs it: the `path:line`, the command or the URL you probed. A taste call says so. Every option states what it changes or costs.
1. **Recompute the frontier.** Each answer settles nodes and unblocks others. A decision that depends on an open one rides in the block with a "Skip if" note. When its answer adds or removes whole groups, it goes to a later round. When an answer changes a premise, re-derive each earlier recommendation that rested on it and ask again the ones that change.
1. **Audit the set.** Before the last round closes, read the decisions together against the constraints the user stated. Two decisions that conflict, or a decision that breaks a constraint, go back to the user as a new question.
1. **Stop on an empty frontier and a confirmation.** Every branch is visited and nothing is silently assumed. Summarise the decisions, one line each, and act only after the user confirms the summary.

```
<the fact that is dangerous now, with its source; omit when none>

Below are the decisions, in plain English. Each has my recommendation first.

A. <group topic>

<facts the group's decisions share, one bullet each, with source; omit when none>

1. <question, one sentence>
   - (a) Recommended: <option>. <what it changes or costs>, backed by <source>
   - (b) <option>. <what it changes or costs>
2. <question> Skip if 1(b).
   - ...

Answer decisions 1–2. You can reply "all recommended" and list only the ones you want differently.
```

- Write each fact once, above the group that uses it.
- End the block on the answer line.

## A decision the user cannot answer

When a decision needs someone outside the conversation, write a questionnaire for that person with [questionnaire.md](reference/questionnaire.md). Mark the decision as waiting on it, and go on with the branches that do not depend on it.

## Honesty labels

| claim                                       | enforced by                                              |
| ------------------------------------------- | -------------------------------------------------------- |
| a fact is looked up, not asked              | model-judgment — no script tells a fact from a decision  |
| a recommendation names what backs it        | model-judgment — `ds grill-add` exits 64 on a missing `probe=`; this skill has no such check |
| the frontier is empty                       | model-judgment — no fixed tree exists to check against   |
| the user confirmed                          | model-judgment — the confirmation is the user's own text |
