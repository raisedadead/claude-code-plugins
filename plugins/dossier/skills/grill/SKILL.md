---
name: grill
description: Define-phase interrogation before ds:new. Separates environment-lookup facts (model looks up, cites, never asks) from operator decisions (asked, never assumed) — serial one-question-at-a-time while decisions chain, frontier-batched rounds once independent. Stops only when the frontier is empty AND the operator confirms; output feeds §G Goal + §C Constraints so ds:new never re-asks. Invoke when the user says "grill me", "ds:grill", "interrogate before we scaffold", "define this dossier", or before ds:new on anything beyond a one-line goal. Do NOT use for mid-build clarifying questions inside ds:build — Define-phase only.
argument-hint: <slug> | --resume
disable-model-invocation: true
---

# ds:grill — interrogate before you scaffold

A vague goal yields vague tasks. `ds:grill` formalizes `ds:new` step 2's "clarify before freezing" lever into a bounded interrogation protocol: facts get looked up, decisions get asked, and the output is an artifact `ds:new` consumes without re-asking.

## Inputs

- `<slug>` — dossier slug this grill feeds (kebab-case, same rules as `ds:new`).
- `--resume` — reopen an incomplete artifact (open frontier nodes resurface).

## Artifact

`.scratchpad/dossier/.grill/<YYYY-MM-DD>-<slug>.md` — dated at grill START; `ds:new` rediscovers it by SLUG (newest artifact wins), so a grill spanning days (`--resume`, pending-external waits) still gates the scaffold. On consume, `ds:new` stamps a `CONSUMED: <dossier-dir-key>` line into the artifact — a consumed grill never feeds a second dossier, and a collision-bumped slug (`<slug>-2`) never inherits the base slug's artifact.

```
FACT: <statement> cite=<file|command|url>
DECISION: <question> recommended=<x> answer=<operator verbatim>
DECISION: <question> recommended=<x> answer=pending-external → <questionnaire path>
FRONTIER: empty | empty-except-external n=<k>
CONFIRMED: <ISO timestamp> operator="<verbatim confirmation>"
CONSUMED: <dossier-dir-key>          (stamped by ds:new, never by grill)
```

Footer lines are the machine-checked half: `hooks/lib-assert-grill.sh` exits non-zero on a half-grilled slug. No hook runs it — `ds:new` invoking the script and refusing on its exit is model-judgment, the same split as the tiger route: the verdict is computed, arriving at it is not.

**One entry per paragraph — blank line between every FACT/DECISION/footer line.** Markdown formatters join adjacent bare lines into one paragraph, which un-anchors the `^FRONTIER:`/`^CONFIRMED:` greps and turns a complete artifact into a false "incomplete" (same failure class FORMAT.md §11 solves for §S).

## Steps

### 0. Detect host env

Per ADAPTERS.md. Never error if an adapter is absent.

### 1. Build the tree

Read what the operator has said so far plus the repo state (existing dossiers, git log, configs). Tag every open node:

- `FACT` — answerable by lookup. Look it up NOW, record with `cite=`. Never ask the operator for a fact the repo answers.
- `DECISION` — genuinely the operator's call. Never assume.

### 2. Serial phase

While decisions are dependency-chained (an answer changes which questions exist): ask ONE at a time, always with a recommended answer. Wait for confirm/override. Batching chained questions bewilders — don't.

### 3. Batch phase

Once remaining decisions are mutually independent: ask the whole frontier as one numbered block (recommended answer each), recompute the frontier from the answers, repeat until empty.

### 4. Stakeholder fork

A decision the operator cannot answer (needs someone outside the room) does NOT block and is NOT guessed: write `.scratchpad/dossier/.grill/<date>-<slug>-questionnaire.md` (purpose / from-to / context / how-to-answer / question sections / answer stubs), mark the node `answer=pending-external`. The frontier may close around it as `empty-except-external n=<k>` — every pending node MUST surface as a §C bullet in the draft so the gap stays auditable.

### 5. Stop gate

Two-part, both required:

1. Frontier empty (or empty-except-external with every pending node §C-surfaced).
1. Explicit operator confirmation — verbatim, recorded in the `CONFIRMED:` footer. Silence or an unanswered recommendation is NOT acceptance.

### 6. Synthesize

Append the footer lines, then draft §G (one-line outcome + IN/NOT-IN scope bullets) and §C (locked-decision bullets) in FORMAT.md shape, inside the artifact under a `## Draft` heading.

### 7. Hand off

Report the artifact path. `ds:new <slug>` consumes the draft §G/§C and skips its own re-asking; its step 1.5 gate verifies the footers via `lib-assert-grill.sh`.

## Honesty labels

| claim                                         | enforced by                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| footer lines present before ds:new proceeds   | code — `lib-assert-grill.sh` grep + exit code                             |
| every FACT cites a source                     | code-checkable shape (`cite=`); whether the lookup actually ran = model   |
| every DECISION carries a real operator answer | model — no script distinguishes a typed answer from an assumed one        |
| "frontier is empty"                           | model — no fixed decision-tree schema exists to verify against            |
| serial-vs-batch phase choice                  | model — governed by the dependency-chain rule, not mechanically checkable |
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
- hooks/lib-assert-grill.sh (gate), skills/new/SKILL.md step 1.5 (consumer)
