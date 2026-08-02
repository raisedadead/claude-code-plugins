---
name: doubt-pass
description: Adversarial doubt cycle on a plan or design before any code exists — distinct from post-hoc code review. Use when the user asks to doubt this, stress-test a design before building it, poke holes in a plan, find the flaw in an approach, or before committing to a non-trivial architecture or design decision.
---

# doubt-pass — break the plan before you build it

The cheapest bug is the one caught before the code exists. A fresh-context reviewer gets the plan and one job: find where it breaks, not whether it is nice. Bounded at three cycles, every finding classified, with a name for the case where doubt spins and lands nothing.

## When to use

- Before a non-trivial architecture or design decision.
- The user asks for a plan to be stress-tested, holes poked, a second opinion — while it is still a plan, no diff yet.

Neighbours: `/code-review` needs a diff that already exists; `grill-me` interviews _you_ for requirements. This one sends a fresh agent at an artifact.

## Protocol

Five steps, detailed in `reference/doubt-protocol.md`:

1. **CLAIM** — state the decision in one paragraph.
1. **EXTRACT** — strip it to an artifact plus a contract (inputs, outputs, invariants). Send those two; the reasoning trail stays behind, so the reviewer judges the design rather than your defence of it.
1. **DOUBT** — spawn `whetstone-doubter` (`Agent`, `subagent_type: whetstone:whetstone-doubter`) with the extracted artifact and contract as its whole input. The agent already carries the adversarial method — "find where this breaks" — and its word budget; `reference/adversarial-prompt-template.md` is the mission text to fill and send. It returns `DOUBT: FAILURES` or `NO FAILURE FOUND`.
1. **RECONCILE** — tag every returned finding `actionable` or `not-actionable`, each on its own merits.
1. **STOP** — at the 3-cycle cap, or at the first cycle that returns nothing new. Fold actionable findings into the plan between cycles.

## Doubt theater

Zero cumulative actionable findings across every cycle is its own result. Report it as one:

```
doubt theater — N findings raised, 0 actionable across M cycles. Escalate to a human or ship as-is.
```

Cycling a reviewer that lands nothing is motion. Naming it keeps it from reading as confidence.

## Verification

Done = the loop stopped at ≤ 3 cycles, every finding carries an `actionable` / `not-actionable` tag, and the outcome is one of: plan amended with the actionable findings, or an explicit `doubt theater` note. The cap and the classification are the gate; "let me think about it more" is a different activity.

## Dossier breadcrumb

In a repo with a live dossier ledger, record the verdict as one §S line through the dossier plugin's append tooling (the host session reminds when applicable; the first live row is the current dossier). No dossier → skip: this skill ships no hooks and no dossier dependency.
