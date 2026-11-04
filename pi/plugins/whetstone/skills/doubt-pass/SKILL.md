---
name: whetstone-doubt-pass
description: Adversarial doubt cycle on a plan or design before any code exists — distinct from post-hoc code review. Use when the user asks to doubt this, stress-test a design before building it, poke holes in a plan, find the flaw in an approach, or before committing to a non-trivial architecture or design decision.
---
## Pi runtime

Resolve bundled paths against this file, not the project working directory. The plugin root is `../..` from this file's directory. Before each shell call that uses `$WHETSTONE_PLUGIN_ROOT`, set that variable to the shell-quoted absolute plugin root in that same shell. Pi does not supply it. Keep the shell working directory in the consuming project.

Load another installed skill with `read` on its advertised SKILL.md path; user commands use `/skill:<name>`. Check the available skills and tools before an optional sibling route. An absent sibling means skip, never install or scan caches. Pi does not add plugin bin directories to PATH: resolve bundled tools by absolute path. For dossier-to-whetstone script routes, check `../whetstone/bin/<tool>` relative to dossier's plugin root; if absent, use the documented absent-skip result.

Use `read/edit/write/bash/grep/find` for the corresponding host operations. Fresh missions use `dossier_delegate` or `whetstone_delegate` for that plugin's named agents, with unqualified `agent` and artifact-only `task`. The tool uses the current model unless the operator supplies an exact `provider/model`. Builders use `agent: general-purpose, write: true`; named reviewers cannot use edit/write. Bash read-only is prompt-only, not a sandbox. A return is final: a follow-up mission is a fresh call, not a message to a retained agent. Parallel independent missions may use concurrent calls.

Web tools and advisor tools are optional. Use installed web tools when present, or read-only `curl`/`gh api` through bash; identify any inaccessible source. The Pi extension supplies mutation guards and model-facing advisories. The task ledger is authoritative; `/dossier-tasks` is a read-only view, not a second task store.


# doubt-pass — break the plan before you build it

The cheapest bug is the one caught before the code exists. A fresh-context reviewer gets the plan and one job: find where it breaks, not whether it is nice. Bounded at three cycles, every finding classified, with a name for the case where doubt spins and lands nothing.

## When to use

- Before a non-trivial architecture or design decision.
- The user asks for a plan to be stress-tested, holes poked, a second opinion — while it is still a plan, no diff yet.

Neighbours: `/code-review` needs a diff that already exists; `/skill:whetstone-grill` interviews _you_ for requirements. This one sends a fresh agent at an artifact.

## Protocol

Five steps, detailed in `reference/doubt-protocol.md`:

1. **CLAIM** — state the decision in one paragraph.
1. **EXTRACT** — strip it to an artifact plus a contract (inputs, outputs, invariants). Send those two; the reasoning trail stays behind, so the reviewer judges the design rather than your defence of it.
1. **DOUBT** — spawn `whetstone-doubter` (`whetstone_delegate`, `agent: whetstone-doubter`) with the extracted artifact and contract as its whole input. The agent already carries the adversarial method — "find where this breaks" — and its word budget; `reference/adversarial-prompt-template.md` is the mission text to fill and send. It returns `DOUBT: FAILURES` or `NO FAILURE FOUND`.
1. **RECONCILE** — tag every returned finding `actionable` or `not-actionable`, each on its own merits.
1. **STOP** — at the 3-cycle cap, or at the first cycle that returns nothing new. Fold actionable findings into the plan between cycles.

## Subtraction pass

A second mission for the same agent asks what can go, where the doubt asks where the plan breaks. One cycle, no loop. Fill `reference/subtraction-prompt-template.md` and spawn `whetstone-doubter` with it. Run it beside the doubt cycle, in the same message, when both apply.

- **Ladder** — delete > simplify > optimise > automate. New code runs the finer ladder: skip it, reuse an existing pattern, stdlib, the native platform, an installed dependency, a one-liner, then minimal new code with one test when it has logic. "It may be done" is an allowed answer.
- **Verdict** — `SUBTRACT: NOTHING TO CUT` or `SUBTRACT: <n> CUTS` (n ≥ 1) as the first line, then one line per cut: the piece, the rung, and what still holds without it.
- **Model** — use the current Pi model. Only an explicit operator-supplied `provider/model` overrides it. Do not read another host's settings or guess a model family alias.
- **Reconcile** — tag each cut `actionable` or `not-actionable`, as in step 4. The operator decides a cut that removes something they asked for.

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
