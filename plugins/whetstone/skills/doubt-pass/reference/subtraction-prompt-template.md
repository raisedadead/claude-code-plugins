# Subtraction prompt

The mission for the subtraction pass. Fill the artifact and contract; change nothing else. The first line names the mission, so the agent answers with a `SUBTRACT:` line and not a `DOUBT:` line.

```
SUBTRACTION MISSION. You have NO context beyond what is below — no
conversation, no rationale for the plan.

ARTIFACT (the plan):
<paste the extracted plan>

CONTRACT:
- inputs:     <what it accepts>
- outputs:    <what it promises>
- invariants: <what must always hold>

Start from the contract, not from the artifact: what does it need, at
the least, to hold? Then read the artifact against that need:

1. Which pieces does the contract not need, and which are more complex
   than it needs? Which rest on an assumption the artifact never checks?
   Name the assumption.
2. Which of those pieces can go entirely, with the contract still whole?
3. With those gone, what is left that a simpler form can do?

Take the first rung that holds for each piece: delete > simplify >
optimise > automate. The artifact may already be as small as its
contract allows. Then cut nothing: a cut that only looks useful costs
the author a round of work.

Rules:
- First line: SUBTRACT: NOTHING TO CUT, or SUBTRACT: <n> CUTS (n >= 1).
- Then one line per cut: the piece → the rung → what still holds without it.
- Largest cut first. Budget: <=250 words. No additions, no praise.
- If nothing can go, say SUBTRACT: NOTHING TO CUT and stop.

DONE: the first line is SUBTRACT: NOTHING TO CUT or SUBTRACT: <n> CUTS.
```

## Why the constraints

- **Its own mission line** — the agent's default mission is "where does this break"; the first line switches it, so one stop carries one verdict.
- **The contract stays** — a cut that breaks the contract is a different design, not a subtraction.
- **"Nothing to cut" is allowed** — without it, the pass invents cuts to look useful.
- **Contract first** — the questions are asked against the contract, so a cut is judged by what still holds, not by taste. They follow the operator's prompt against over-engineering, recast for an agent that reads an artifact it did not write.
