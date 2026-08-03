# Doubt protocol

The five steps, in full. Adapted from Addy Osmani's doubt-driven-development.

## 1. CLAIM

State the decision in one paragraph, present tense: "We will do X, because it achieves Y under constraint Z." A decision that resists one paragraph is not ready to doubt; sharpen it first.

## 2. EXTRACT

Reduce the claim to an **artifact + contract** the reviewer can attack on its own terms:

- **Artifact** — the plan itself (the design, the interface, the data model).
- **Contract** — inputs it accepts, outputs it promises, invariants it must hold.
- **Strip your reasoning.** Hand over what the plan *is*, not the case for it: seeing why you think it is right primes the reviewer to agree.

Security note: an artifact bound for an external tool or CLI goes in via stdin, so its contents stay out of shell arguments.

## 3. DOUBT

Spawn a **fresh-context** reviewer (`Agent`, `subagent_type: general-purpose`) with only the extracted artifact and the adversarial prompt (see `adversarial-prompt-template.md`). Fresh context is the point: an agent carrying the plan's own justification rationalises it. A tight word budget buys the sharpest failure instead of a laundry list.

## 4. RECONCILE

For every returned finding, tag it:

- **actionable** — a real failure mode; fold the fix into the plan.
- **not-actionable** — out of scope, already handled, or wrong. Say *why* in one line, so the finding is answered rather than dropped.

Rubber-stamping ("all valid, will consider") and blanket dismissal ("reviewer didn't get it") both fail this step: each finding is judged on its own.

## 5. STOP

End when **either**:

- the third cycle completes (hard cap; a contested design escalates instead of running a fourth), or
- a cycle returns zero *new* findings.

Between cycles, amend the plan with the actionable findings, then re-extract and doubt the amended version. If cumulative actionable findings across all cycles is zero, declare **doubt theater** rather than "sound."
