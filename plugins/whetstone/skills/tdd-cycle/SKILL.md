---
name: tdd-cycle
description: Drive one vertical slice of behaviour red-green-refactor, seam agreed before the first test. Use when the user asks to add a feature, fix a bug, write code test-first, says "TDD this", "red green refactor", or "write a failing test first" — and no dossier or spec-driven task is already driving the work.
---

# tdd-cycle — one slice, red before green

Test-first for ad-hoc work that no ledger is driving. The discipline is small and non-negotiable: agree the seam, watch the test fail, make it pass, keep the suite green. Refactoring is deliberately **not** part of this loop.

## When to use

- Adding a feature or fixing a bug where you want the test to define "done."
- Any behaviour-bearing edit not already inside a `dossier:build` / `ck:build` covenant (those have their own TDD gate — don't double-drive).

## The seam (agree it first)

Before writing a single assertion, name the **seam**: the public boundary you'll test through — a function signature, an HTTP route, a CLI. Get the user's agreement on it. Assert behaviour through that boundary, never against internal state or private helpers. A wrong seam produces tests that pass while the behaviour is wrong, or that break on every refactor. This is the highest-value moment; spend it.

## The loop (one slice at a time)

1. **RED — write one failing test.** Then prove it fails for the right reason:

   ```bash
   "${CLAUDE_PLUGIN_ROOT}"/skills/tdd-cycle/scripts/run_slice.sh red <test-command>
   ```

   `run_slice red` exits non-zero if the test *passed* — a test that doesn't fail first is characterizing nothing. Before you run it, check the test against `reference/anti-patterns.md`.

1. **GREEN — minimum code to pass:**

   ```bash
   run_slice.sh green <test-command>
   ```

   Just enough to pass this one test. No speculative extra.

1. **Full-suite gate:**

   ```bash
   run_slice.sh full <suite-command>
   ```

   The slice must not redden anything else.

1. **Next slice** — one seam, one test, one implementation per cycle. Repeat from RED.

## Refactor is not in this loop

Once GREEN and the suite passes, the slice is done. Cleanup and design improvement are a **separate** pass (hand off to a review/simplify step), never blended into red-green — mixing them makes an uncontrolled change where you can't tell what a failure means.

## Verification

Each slice: `run_slice red` exited 0 (the test genuinely failed first), then `run_slice green` and `run_slice full` exited 0. Three exit codes, not a feeling, gate the slice.
