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

Your job: find what can GO while the contract still holds. Take the first
rung that holds for each piece: delete > simplify > optimise > automate.
For new code, the finer ladder: skip it → reuse an existing pattern →
stdlib → the native platform → an installed dependency → a one-liner →
minimal new code, with one test when it has logic. "It may be done" is an
allowed answer.

Rules:
- First line: SUBTRACT: NOTHING TO CUT, or SUBTRACT: <n> CUTS (n >= 1).
- Then one line per cut: the piece → the rung → what still holds without it.
- Largest cut first. Budget: <=250 words. No additions, no praise.
- If nothing can go, say SUBTRACT: NOTHING TO CUT and stop.
```

## Why the constraints

- **Its own mission line** — the agent's default mission is "where does this break"; the first line switches it, so one stop carries one verdict.
- **The contract stays** — a cut that breaks the contract is a different design, not a subtraction.
- **"Nothing to cut" is allowed** — without it, the pass invents cuts to look useful.
