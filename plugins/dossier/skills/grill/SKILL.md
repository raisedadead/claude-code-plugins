---
name: grill
description: Define-phase interrogation before ds:new, from a goal sentence. Facts get looked up and cited; operator decisions get asked, serial while an answer adds or removes groups, batched once none does; "discuss more" forks a decision into sub-decisions. Stops when the frontier is empty AND the operator confirms; output feeds §G + §C so ds:new never re-asks. Invoke when the user says "grill me" / "ds:grill", when ds:new gets a goal with an open decision, or for any design interview in a repo with `.scratchpad/dossier/`. Mid-build questions inside ds:build stay with ds:build.
argument-hint: "<goal sentence>" | --resume <slug>
---

# ds:grill — interrogate before you scaffold

A vague goal yields vague tasks. This formalises `ds:new` step 2's "clarify before freezing" into a bounded interrogation: facts get looked up, decisions get asked, and the output is an artifact `ds:new` consumes without re-asking.

## Inputs

- `"<goal sentence>"` — what the wave must achieve, in the operator's words. Derive a slug from it (kebab-case, ≤30 chars, `ds:new` rules) and put it on the first line of the first decision block; the operator's reply confirms or replaces it.
- `--resume <slug>` — reopen an incomplete artifact. `ds assert-grill` names the open decisions; ask those first.

A bare slug gives the opening scope nothing to stand on. Ask for the goal sentence in one line before the first block.

## Artifact

`.scratchpad/dossier/.grill/<YYYY-MM-DD>-<slug>.md` — dated at grill START. `ds:new` rediscovers it by SLUG (newest artifact wins), so a grill spanning days (`--resume`, pending-external waits) still gates the scaffold. On consume, `ds:new` stamps a `CONSUMED: <dossier-dir-key>` line into the artifact, so one grill feeds one dossier and a collision-bumped slug (`<slug>-2`) starts fresh.

```
FACT: <statement> cite=<file|command|url>
DECISION: <n>. <topic> recommended=<x>                                  (asked, not yet answered)
DECISION: <n>. <topic> recommended=<x> answer=<operator verbatim>[ → (<option>)]
DECISION: <n>. <topic> recommended=<x> answer=<operator verbatim> → forked <n>.1, <n>.2
DECISION: <n>.<k> <topic> recommended=<x> answer=...
DECISION: <n>. <topic> recommended=<x> answer=pending-external → <questionnaire path>
FRONTIER: empty | empty-except-external n=<k>
CONFIRMED: <ISO timestamp> operator="<verbatim confirmation>"
CONSUMED: <dossier-dir-key>          (stamped by ds:new, never by grill)
```

Write every entry through the CLI:

```bash
"${CLAUDE_PLUGIN_ROOT}"/cli/ds grill-add .scratchpad "<slug>" "<entry>"
```

`ds grill-add` creates the artifact on the first entry and writes each entry as its own paragraph, so a formatter cannot join two entries. A `DECISION` with an id already present replaces that line: record a decision when you ask it, and again when the operator answers. It exits 64 on a `FACT` with no `cite=`, a `DECISION` with no `recommended=`, or a `CONSUMED` line, and 4 on a consumed artifact.

`ds assert-grill` exits 2 while a decision has no answer, has `answer=pending`, or is forked with a missing or open child; a forked parent closes when all its children close. It also exits non-zero on a missing footer. No hook runs it — `ds:new` invoking the script and refusing on its exit is model-judgment, the same split as the tiger route: the verdict is computed, arriving at it is not.

## Steps

### 1. Build the tree

Read the goal sentence, what the operator has said so far, and the repo state (existing dossiers, git log, configs). Tag every open node:

- `FACT` — answerable by lookup. Look it up and record `cite=`. Never ask the operator for a fact the repo answers.
- `DECISION` — genuinely the operator's call. Ask it.

A fact that needs a sweep (many files, an external doc, a census) goes to a background `dossier-scout` with a self-contained mission. Ask the decisions that do not depend on it meanwhile, record the `FACT` when the scout reports, and hold back only the decisions that need it.

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

### 3.5. Fork a decision

The operator replies "discuss more", "dig into 2", or asks a question back about decision `n`. Split `n` into the sub-decisions it hides:

1. Record `n` with the reply verbatim and `→ forked n.1, n.2, …`.
1. Ask `n.1`…`n.k` as one decision block. Each carries its own facts, recommendation and costs. A sub-decision can fork again (`n.1.1`).
1. Record each child as it is answered. `n` closes when every child closes; `ds assert-grill` computes that.

The other decisions in the same reply keep their answers.

### 4. Stakeholder fork

A decision the operator cannot answer (it needs someone outside the room) keeps its own slot rather than a guess: write `.scratchpad/dossier/.grill/<date>-<slug>-questionnaire.md` (purpose / from-to / context / how-to-answer / question sections / answer stubs) and mark the node `answer=pending-external`. The frontier may close around it as `empty-except-external n=<k>` — every pending node MUST surface as a §C bullet in the draft, so the gap stays auditable.

### 5. Stop gate

Two-part, both required:

1. Frontier empty (or empty-except-external with every pending node §C-surfaced).
1. Explicit operator confirmation — verbatim, recorded in the `CONFIRMED:` footer. Acceptance is something the operator typed; silence and an unanswered recommendation are neither.

### 6. Synthesize

Append the footer lines, then draft §G (one-line outcome + IN/NOT-IN scope bullets) and §C (locked-decision bullets) in FORMAT.md shape, inside the artifact under a `## Draft` heading.

### 7. Hand off

Report the artifact path and the confirmed slug. `ds:new <slug>` consumes the draft §G/§C and skips its own re-asking; its step 1.5 gate verifies the footers via `ds assert-grill`.

## Honesty labels

| claim                                         | enforced by                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| footer lines present before ds:new proceeds   | code — `ds assert-grill` footer match + exit code                         |
| no decision left unanswered or half-forked    | code — `ds assert-grill` exit 2 names the open ids                        |
| entry shape, one entry per paragraph          | code — `ds grill-add` exit 64 on a bad entry; it writes the paragraphs    |
| a fork happens when the operator asks for one | model — no script reads the operator's reply                              |
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
- cli/ds grill-add (writer), cli/ds assert-grill (gate), skills/new/SKILL.md step 1.5 (consumer)
