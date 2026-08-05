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

Spawn the **fresh-context** doubter — `Agent`, `subagent_type: whetstone:whetstone-doubter` — with only the extracted artifact and contract as its mission; `adversarial-prompt-template.md` is the text to fill and send. Fresh context is the point: an agent carrying the plan's own justification rationalises it.

The shipped agent already carries the adversarial framing, a ≤ 250-word budget on findings, and a read-only `tools: Read, Grep, Glob` grant. It answers with `DOUBT: FAILURES` or `DOUBT: NO FAILURE FOUND` as its own first line, and callers read that line deterministically (`plugins/dossier/skills/build/SKILL.md`, step 5.6). Spawning a generic agent instead drops all four at once — method, budget, read-only grant, and the `DOUBT:` verdict token.

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
