---
name: dossier-grill
description: Define-phase interrogation before ds:new, from a goal sentence. Facts get looked up and cited; operator decisions get asked, serial while an answer adds or removes groups, batched once none does; "discuss more" forks a decision into sub-decisions. Stops when the frontier is empty, the decision set survives an audit (when whetstone is installed) AND the operator confirms; output feeds §G + §C so ds:new never re-asks. Invoke when the user says "grill me" / "ds:grill", when ds:new gets a goal with an open decision, or for any design interview in a repo with `.scratchpad/dossier/`. Mid-build questions inside ds:build stay with ds:build.
argument-hint: '"<goal sentence>" | --resume <slug>'
---
## Pi runtime

Resolve bundled paths against this file, not the project working directory. The plugin root is `../..` from this file's directory. Before each shell call that uses `$DOSSIER_PLUGIN_ROOT`, set that variable to the shell-quoted absolute plugin root in that same shell. Pi does not supply it. Keep the shell working directory in the consuming project.

Load another installed skill with `read` on its advertised SKILL.md path; user commands use `/skill:<name>`. Check the available skills and tools before an optional sibling route. An absent sibling means skip, never install or scan caches. Pi does not add plugin bin directories to PATH: resolve bundled tools by absolute path. For dossier-to-whetstone script routes, check `../whetstone/bin/<tool>` relative to dossier's plugin root; if absent, use the documented absent-skip result.

Use `read/edit/write/bash/grep/find` for the corresponding host operations. Fresh missions use `dossier_delegate` or `whetstone_delegate` for that plugin's named agents, with unqualified `agent` and artifact-only `task`. The tool uses the current model unless the operator supplies an exact `provider/model`. Builders use `agent: general-purpose, write: true`; named reviewers cannot use edit/write. Bash read-only is prompt-only, not a sandbox. A return is final: a follow-up mission is a fresh call, not a message to a retained agent. Parallel independent missions may use concurrent calls.

Web tools and advisor tools are optional. Use installed web tools when present, or read-only `curl`/`gh api` through bash; identify any inaccessible source. The Pi extension supplies mutation guards and model-facing advisories. The task ledger is authoritative; `/dossier-tasks` is a read-only view, not a second task store.


# ds:grill — interrogate before you scaffold

A vague goal yields vague tasks. This formalises `/skill:dossier-new` step 2's "clarify before freezing" into a bounded interrogation: facts get looked up, decisions get asked, and the output is an artifact `/skill:dossier-new` consumes without re-asking.

## Inputs

- `"<goal sentence>"` — what the wave must achieve, in the operator's words. Derive a slug from it (kebab-case, ≤30 chars, `/skill:dossier-new` rules) and put it on the first line of the first decision block; the operator's reply confirms or replaces it.
- `--resume <slug>` — reopen an incomplete artifact. `ds assert-grill` names the open decisions; ask those first.

A bare slug gives the opening scope nothing to stand on. Ask for the goal sentence in one line before the first block.

## Artifact

`.scratchpad/dossier/.grill/<YYYY-MM-DD>-<slug>.md` — dated at grill START. `/skill:dossier-new` rediscovers it by SLUG (newest artifact wins), so a grill spanning days (`--resume`, pending-external waits) still gates the scaffold. On consume, `/skill:dossier-new` stamps a `CONSUMED: <dossier-dir-key>` line into the artifact, so one grill feeds one dossier and a collision-bumped slug (`<slug>-2`) starts fresh.

```
FACT: <statement> cite=<file|command|url>
DECISION: <n>. <topic> recommended=<x> probe=<p>                        (asked, not yet answered)
DECISION: <n>. <topic> recommended=<x> probe=<p> answer=<operator verbatim>[ → (<option>)]
DECISION: <n>. <topic> recommended=<x> probe=<p> answer=<operator verbatim> → forked <n>.1, <n>.2
DECISION: <n>.<k> <topic> recommended=<x> probe=<p> answer=...
DECISION: <n>. <topic> recommended=<x> probe=<p> answer=pending-external → <questionnaire path>
FRONTIER: empty | empty-except-external n=<k>
CONFIRMED: <ISO timestamp> operator="<verbatim confirmation>"
CONSUMED: <dossier-dir-key>          (stamped by ds:new, never by grill)
```

Write every entry through the CLI:

```bash
"$DOSSIER_PLUGIN_ROOT"/cli/ds grill-add .scratchpad "<slug>" "<entry>"
```

`ds grill-add` creates the artifact on the first entry and writes each entry as its own paragraph, so a formatter cannot join two entries. A `DECISION` with an id already present replaces that line: record a decision when you ask it, and again when the operator answers. It exits 64 on a `FACT` with no `cite=`, a `DECISION` with no `recommended=` or no `probe=`, or a `CONSUMED` line, and 4 on a consumed artifact.

`ds assert-grill` exits 2 while a decision has no answer, has `answer=pending`, or is forked with a missing or open child; a forked parent closes when all its children close. It also exits non-zero on a missing footer. No hook runs it — `/skill:dossier-new` invoking the script and refusing on its exit is model-judgment, the same split as the tiger route: the verdict is computed, arriving at it is not.

## Steps

### 1. Build the tree

Read the goal sentence, what the operator has said so far, and the repo state (existing dossiers, git log, configs). Tag every open node:

- `FACT` — answerable by lookup. Look it up and record `cite=`. The statement says what the cite shows, not only where to look. Never ask the operator for a fact the repo answers.
- `DECISION` — genuinely the operator's call. Ask it. An agent recommendation that the operator accepted only in passing stays a `DECISION` until a decision block asks it. The tree has a node for what the end user sees. Its `probe=` names the file:line, command or URL you read this session that backs the recommendation, in backticks when it has spaces; `probe=—` declares a pure taste call with nothing to read. A recommendation that moves, renames or removes a thing probes every reference to that thing first.

A fact that needs a sweep (many files, an external doc, a census) goes to a background `dossier-scout` with a self-contained mission. Ask the decisions that do not depend on it meanwhile, record the `FACT` when the scout reports, and hold back only the decisions that need it.

### 2. Serial phase

While an answer adds or removes whole groups of questions: ask ONE decision at a time, as a decision block with one group, and wait for confirm or override. Chained questions asked as a batch bewilder.

With whetstone installed, three kinds of decision hand off for their probe: a module seam or an interface → `/skill:whetstone-codebase-design`; a term two people use differently → `/skill:whetstone-domain-modeling`; a design question a throwaway build answers faster than a debate → `/skill:whetstone-prototype`. The skill's finding becomes the decision's `probe=`.

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
- Put the recommended option first, labelled `Recommended:`. Every option states what it changes or costs. The recommended option names what backs it — the file, command or source behind its `probe=`.
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

A decision the operator cannot answer (it needs someone outside the room) keeps its own slot rather than a guess: write `<root>/.scratchpad/dossier/.grill/<date>-<slug>-questionnaire.md`, where `<root>` is the path `ds root` prints (purpose / from-to / context / how-to-answer / question sections / answer stubs) and mark the node `answer=pending-external`. The frontier may close around it as `empty-except-external n=<k>` — every pending node MUST surface as a §C bullet in the draft, so the gap stays auditable.

### 4.5. Premise change

The operator states a fact that voids a reason. Find every `DECISION` whose recommendation used that reason, answered or not, re-derive it from a fresh probe, and record the new line. An answered decision whose recommendation changed is asked again.

### 5. Stop gate

Two parts always, a third when whetstone is installed:

1. Frontier empty (or empty-except-external with every pending node §C-surfaced).
1. Set audit, when whetstone is installed. Send the `DECISION` lines and the constraints the operator stated to `whetstone-doubter` (`agent: whetstone-doubter`) as one artifact, with the constraints as its contract. In the same message, spawn the subtraction pass on the same artifact (whetstone `doubt-pass`, "Subtraction pass": its template, its model rule). Record each verdict as a `FACT:` line through `ds grill-add`, with `cite=` the agent type. Fold actionable findings and cuts back through step 4.5, then ask the operator in one block; a decision that both touch is the operator's call. One audit cycle and one subtraction cycle per grill; a second round is the operator's call. Without whetstone, skip both and say so in the hand-off.
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
| every DECISION names its probe                | code-checkable shape (`probe=`); whether the probe ran = model            |
| decisions re-derived after a premise change   | model — no script links a FACT to the decisions that used it              |
| the decision set survives the set audit       | model-judgment, parsed — `DOUBT:` line from `whetstone-doubter`           |
| the subtraction pass found what can go        | model-judgment, parsed — `SUBTRACT:` line; model opt-in via `advisorModel` |
| every DECISION carries a real operator answer | model — no script distinguishes a typed answer from an assumed one        |
| "frontier is empty"                           | model — no fixed decision-tree schema exists to verify against            |
| serial-vs-batch phase choice                  | model — governed by the group add/remove rule, not mechanically checkable |
| pending-external nodes surfaced as §C bullets | model — step 4 asserts it; no script walks the draft to verify            |

Artifact SHAPE is code-enforced; SUBSTANCE is model-judgment. "ds:grill ran" never reads as "every decision is sound."

## Anti-patterns

- Ending on "asked enough" instead of the stop gate.
- Asking the operator anything the repo already answers.
- Authoring §T rows — grill stops at §G/§C; tasks belong to `/skill:dossier-new`/`/skill:dossier-build`.
- Treating an unanswered `recommended=` as an operator decision.
- Skipping the questionnaire fork and guessing an external stakeholder's answer.

## Cite

- FORMAT.md §4 (§G), §5 (§C), §15 (helpers)
- cli/ds grill-add (writer), cli/ds assert-grill (gate), skills/new/SKILL.md step 1.5 (consumer)
