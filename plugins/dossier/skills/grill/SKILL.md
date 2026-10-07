---
name: grill
description: Define-phase interrogation before ds:new. Separates environment-lookup facts (model looks up, cites, never asks) from operator decisions (asked, never assumed) — serial while an answer adds or removes groups of questions, batched in decision blocks once none does. Stops only when the frontier is empty AND the operator confirms; output feeds §G Goal + §C Constraints so ds:new never re-asks. Invoke when the user says "grill me", "ds:grill", "interrogate before we scaffold", "define this dossier", or before ds:new on anything beyond a one-line goal. Do NOT use for mid-build clarifying questions inside ds:build — Define-phase only.
argument-hint: <slug> | --resume
disable-model-invocation: true
---

# ds:grill — interrogate before you scaffold

A vague goal yields vague tasks. This formalises `ds:new` step 2's "clarify before freezing" into a bounded interrogation: facts get looked up, decisions get asked, and the output is an artifact `ds:new` consumes without re-asking.

## Inputs

- `<slug>` — dossier slug this grill feeds (kebab-case, same rules as `ds:new`).
- `--resume` — reopen an incomplete artifact; open frontier nodes resurface.

## Artifact

`.scratchpad/dossier/.grill/<YYYY-MM-DD>-<slug>.md` — dated at grill START. `ds:new` rediscovers it by SLUG (newest artifact wins), so a grill spanning days (`--resume`, pending-external waits) still gates the scaffold. On consume, `ds:new` stamps a `CONSUMED: <dossier-dir-key>` line into the artifact, so one grill feeds one dossier and a collision-bumped slug (`<slug>-2`) starts fresh.

```
FACT: <statement> cite=<file|command|url>
DECISION: <question> recommended=<x> answer=<operator verbatim>[ → (<option>)]
DECISION: <question> recommended=<x> answer=pending-external → <questionnaire path>
FRONTIER: empty | empty-except-external n=<k>
CONFIRMED: <ISO timestamp> operator="<verbatim confirmation>"
CONSUMED: <dossier-dir-key>          (stamped by ds:new, never by grill)
```

Footer lines are the machine-checked half: `cli/ds assert-grill` exits non-zero on a half-grilled slug. No hook runs it — `ds:new` invoking the script and refusing on its exit is model-judgment, the same split as the tiger route: the verdict is computed, arriving at it is not.

**One entry per paragraph — blank line between every FACT/DECISION/footer line.** Markdown formatters join adjacent bare lines into one paragraph, which un-anchors the `^FRONTIER:`/`^CONFIRMED:` greps and turns a complete artifact into a false "incomplete" (the failure class ${CLAUDE_PLUGIN_ROOT}/FORMAT.md §11 solves for §S).

## Steps

### 1. Build the tree

Read what the operator has said so far plus the repo state (existing dossiers, git log, configs). Tag every open node:

- `FACT` — answerable by lookup. Look it up now and record `cite=`. Never ask the operator for a fact the repo answers.
- `DECISION` — genuinely the operator's call. Ask it.

### 2. Serial phase

While an answer adds or removes whole groups of questions: ask ONE decision at a time, as a decision block with one group, and wait for confirm or override. Chained questions asked as a batch bewilder.

### 3. Batch phase

Once no answer adds or removes a group: ask the whole frontier as one decision block, recompute the frontier from the answers, repeat until empty. A lighter dependency rides in the batch as a note on the dependent decision ("Skip if 1(b).").

Decision block:

```
<the fact that is dangerous now, with its cite; omit when none>

Below are the decisions, in plain English. Each has my recommendation first.

A. <group topic>

<facts the group's decisions share, one bullet each, with cite; omit when none>

1. <question, one sentence>
   - (a) Recommended: <option>. <what it changes or costs>
   - (b) <option>. <what it changes or costs>
2. <question> Skip if 1(b).
   - ...

B. <group topic>

3. Which of these stay? <items>
   - (a) Recommended: keep <subset>. <what dropping the rest changes>
   - (b) Keep all. <what it costs>

Answer decisions 1–3. You can reply "all recommended" and list only the ones you want differently.
```

- Number decisions across groups, so a reply reads "2b, 3c".
- Write each fact once, in plain English, above the group that uses it.
- Put the recommended option first, labelled `Recommended:`. Every option states what it changes or costs.
- Put a decision outside the grill's scope in its own last group. Its answer goes to the draft as a §G NOT-IN bullet.
- End the block on the answer line. The host's output style owns the closing format.
- "all recommended" is an operator answer. Record one `DECISION:` line per decision, with the reply verbatim plus the option it selects: `answer="all recommended" → (a)`, `answer="all recommended, 2b" → (b)`. A decision that a "Skip if" note removes gets `answer=skipped by 1(b)`.

### 4. Stakeholder fork

A decision the operator cannot answer (it needs someone outside the room) keeps its own slot rather than a guess: write `.scratchpad/dossier/.grill/<date>-<slug>-questionnaire.md` (purpose / from-to / context / how-to-answer / question sections / answer stubs) and mark the node `answer=pending-external`. The frontier may close around it as `empty-except-external n=<k>` — every pending node MUST surface as a §C bullet in the draft, so the gap stays auditable.

### 5. Stop gate

Two-part, both required:

1. Frontier empty (or empty-except-external with every pending node §C-surfaced).
1. Explicit operator confirmation — verbatim, recorded in the `CONFIRMED:` footer. Acceptance is something the operator typed; silence and an unanswered recommendation are neither.

### 6. Synthesize

Append the footer lines, then draft §G (one-line outcome + IN/NOT-IN scope bullets) and §C (locked-decision bullets) in FORMAT.md shape, inside the artifact under a `## Draft` heading.

### 7. Hand off

Report the artifact path. `ds:new <slug>` consumes the draft §G/§C and skips its own re-asking; its step 1.5 gate verifies the footers via `ds assert-grill`.

## Honesty labels

| claim                                         | enforced by                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| footer lines present before ds:new proceeds   | code — `ds assert-grill` footer match + exit code                         |
| every FACT cites a source                     | code-checkable shape (`cite=`); whether the lookup actually ran = model   |
| every DECISION carries a real operator answer | model — no script distinguishes a typed answer from an assumed one        |
| "frontier is empty"                           | model — no fixed decision-tree schema exists to verify against            |
| serial-vs-batch phase choice                  | model — governed by the group add/remove rule, not mechanically checkable |
| pending-external nodes surfaced as §C bullets | model — step 4 asserts it; no script walks the draft to verify            |

Artifact SHAPE is code-enforced; SUBSTANCE is model-judgment. "ds:grill ran" never reads as "every decision is sound."

## Anti-patterns

- Ending on "asked enough" instead of the two-part stop gate.
- Asking the operator anything the repo already answers.
- Authoring §T rows — grill stops at §G/§C; tasks belong to `ds:new`/`ds:build`.
- Treating an unanswered `recommended=` as an operator decision.
- Skipping the questionnaire fork and guessing an external stakeholder's answer.

## Cite

- FORMAT.md §4 (§G), §5 (§C), §15 (helpers)
- cli/ds assert-grill (gate), skills/new/SKILL.md step 1.5 (consumer)
