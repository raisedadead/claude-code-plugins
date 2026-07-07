# Doubt protocol

The five steps, in full. Adapted from Addy Osmani's doubt-driven-development.

## 1. CLAIM

State the decision in one paragraph, present tense: "We will do X, because it achieves Y under constraint Z." If you can't state it in a paragraph, it isn't ready to doubt — sharpen it first.

## 2. EXTRACT

Reduce the claim to an **artifact + contract** the reviewer can attack on its own terms:

- **Artifact** — the plan itself (the design, the interface, the data model).
- **Contract** — inputs it accepts, outputs it promises, invariants it must hold.
- **Strip your reasoning.** The reviewer must not see why you think it's right — that primes agreement. Hand over what the plan *is*, not the case for it.

Security note: when the artifact goes to an external tool or CLI, pipe it via stdin, never interpolate it into shell arguments.

## 3. DOUBT

Spawn a **fresh-context** reviewer (`Agent`, `subagent_type: general-purpose`) with only the extracted artifact and the adversarial prompt (see `adversarial-prompt-template.md`). Fresh context is the point — an agent carrying the plan's own justification will rationalize it. Give a tight word budget so the reviewer prioritizes the sharpest failure, not a laundry list.

## 4. RECONCILE

For every returned finding, tag it:

- **actionable** — a real failure mode; fold the fix into the plan.
- **not-actionable** — out of scope, already handled, or wrong. Say *why* in one line; do not silently drop it.

Rubber-stamping ("all valid, will consider") and blanket dismissal ("reviewer didn't get it") are both failures of this step.

## 5. STOP

End when **either**:

- the third cycle completes (hard cap — do not run a fourth), or
- a cycle returns zero *new* findings.

Between cycles, amend the plan with the actionable findings, then re-extract and doubt the amended version. If cumulative actionable findings across all cycles is zero, declare **doubt theater** rather than "sound."
