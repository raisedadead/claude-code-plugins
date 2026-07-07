---
name: doubt-pass
description: Adversarial doubt cycle on a plan or design before any code exists — distinct from post-hoc code review. Use when the user asks to doubt this, stress-test a design before building it, poke holes in a plan, find the flaw in an approach, or before committing to a non-trivial architecture or design decision.
---

# doubt-pass — break the plan before you build it

The cheapest bug to fix is the one caught before code exists. `doubt-pass` hands a plan to a fresh-context reviewer whose only job is to find where it breaks — not whether it's nice. It is bounded: at most three cycles, every finding classified, and a name for the failure mode where doubt spins without ever landing anything.

## When to use

- Before implementing a non-trivial architecture or design decision.
- The user wants a plan stress-tested, holes poked, a second opinion on an approach — while it's still a plan, no diff yet.

This is a different moment from `/code-review` (which needs a diff that already exists) and from `grill-me` (which interviews *you* for requirements). `doubt-pass` sends a fresh agent to attack an artifact.

## Protocol

Run the five steps in `reference/doubt-protocol.md`:

1. **CLAIM** — state the decision in one paragraph.
1. **EXTRACT** — strip it to an artifact + contract (inputs, outputs, invariants), no reasoning trail. The reviewer judges the plan, not your defense of it.
1. **DOUBT** — spawn the `whetstone-doubter` agent (`Agent`, `subagent_type: whetstone:whetstone-doubter`) with **only** the extracted artifact and contract. The agent already carries the adversarial method ("find where this breaks," not "is this good") and its word budget; `reference/adversarial-prompt-template.md` is the exact mission text to fill and send. It returns a `DOUBT: FAILURES | NO FAILURE FOUND` verdict.
1. **RECONCILE** — classify every returned finding `actionable` or `not-actionable`. Don't rubber-stamp; don't dismiss.
1. **STOP** — end when the cap (3 cycles) is hit, or a cycle returns zero new findings. Fold actionable findings back into the plan between cycles.

## Doubt theater

If all cycles complete with **zero cumulative actionable findings**, do not report "the plan is sound." Report it plainly:

```
doubt theater — N findings raised, 0 actionable across M cycles. Escalate to a human or ship as-is.
```

Cycling a reviewer that never lands anything actionable is motion without progress — name it rather than laundering it into false confidence.

## Verification

Done = the loop stopped at ≤ 3 cycles, **every** finding carries an `actionable` / `not-actionable` tag, and the outcome is one of: plan amended with the actionable findings, or an explicit `doubt theater` note. The cap and the classification are the gate — an unbounded "let me think about it more" is not a doubt-pass.
