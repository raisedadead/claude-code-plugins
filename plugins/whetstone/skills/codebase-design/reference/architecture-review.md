# Architecture review — find deepening opportunities

Surface architectural friction and propose **deepening opportunities**: refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability. Use the vocabulary of [the codebase-design skill](../SKILL.md) exactly; the domain language in `GLOSSARY.md` names good seams, and ADRs in `docs/adr/` record decisions this review does not re-litigate.

## Process

### 1. Explore

**Scope before you scan: YAGNI.** Deepening a module pays off by making future changes to it easier, so put extra weight on the parts of the codebase that have recently changed. Decide *where* to look before you look:

- If the user named a direction (a module, a subsystem, a pain point), take it, and skip the inference below.
- Otherwise, walk back a good stretch of the commit history (`git log --oneline`) to find the codebase's hot spots, the files and areas that keep coming up, and let those paths pull your attention first. If the changes are scattered with no clear hot spot, widen the net.

Read the project's domain glossary (`GLOSSARY.md`) and any ADRs in the area you're touching first.

Then spawn a sub-agent to walk the codebase. Don't follow rigid heuristics; explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow**, with an interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow: would deleting it concentrate complexity, or just move it? A "yes, concentrates" is the signal you want.

### 2. Present candidates as a report

Write `architecture-review.md` in the system temp directory (`$TMPDIR`, else `/tmp`), so nothing lands in the repository. Use this shape, which `whetstone:html-report` lays out:

- `# Architecture review: <area>`, then one line with the date and the scope.
- `## Summary`: the top recommendation first — which candidate to tackle first and why — then one bullet per other candidate.
- One `## <n>. <candidate>` section per candidate, with **Files**, **Problem**, **Solution** (plain English), **Benefits** (in terms of locality and leverage, and how the tests improve) and **Recommendation strength** (`Strong`, `Worth exploring` or `Speculative`).
- A before and an after Mermaid diagram per candidate, each with `accTitle:` and `accDescr:`. Use a graph when the relationships are graph-shaped: call graphs, dependencies, sequences.
- `## Sources`: the commits and files the survey read.

Render it with the `whetstone:html-report` skill to `architecture-review.html` in the same directory, read every figure it lists, then give the user the absolute path.

**Use GLOSSARY.md vocabulary for the domain, and this skill's vocabulary for the architecture.** If `GLOSSARY.md` defines "Order," talk about "the Order intake module," not "the FooBarHandler," and not "the Order service."

**ADR conflicts**: if a candidate contradicts an existing ADR, only surface it when the friction is real enough to warrant revisiting the ADR. Mark it clearly in the candidate (_"contradicts ADR-0007, but worth reopening because…"_). Don't list every theoretical refactor an ADR forbids.

Do NOT propose interfaces yet. After the report is rendered, ask the user: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, run the `whetstone:grill` skill to walk the decision tree with them: constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive.

Side effects happen inline as decisions crystallize; run the `whetstone:domain-modeling` skill to keep the domain model current as you go:

- **Naming a deepened module after a concept not in `GLOSSARY.md`?** Add the term to `GLOSSARY.md`. Create the file lazily if it doesn't exist.
- **Sharpening a fuzzy term during the conversation?** Update `GLOSSARY.md` right there.
- **User rejects the candidate with a load-bearing reason?** Offer an ADR, framed as: _"Want me to record this as an ADR so future architecture reviews don't re-suggest it?"_ Only offer when the reason would actually be needed by a future explorer to avoid re-suggesting the same thing; skip ephemeral reasons ("not worth it right now") and self-evident ones.
- **Want to explore alternative interfaces for the deepened module?** Use the design-it-twice pattern in [DESIGN-IT-TWICE.md](../DESIGN-IT-TWICE.md).
