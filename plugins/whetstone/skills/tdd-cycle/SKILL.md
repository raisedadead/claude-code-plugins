---
name: tdd-cycle
description: Drive one vertical slice of behaviour red-green-refactor, seam agreed before the first test. Use when the user asks to add a feature, fix a bug, write code test-first, says "TDD this", "red green refactor", or "write a failing test first". Inside a live dossier:build covenant, invoke dossier:build instead — it composes this skill's run-slice command as its RED/GREEN proof.
---

# tdd-cycle — one slice, red before green

Test-first for ad-hoc work that no ledger is driving. Agree the seam, watch the test fail, make it pass, keep the suite green. Refactoring is a separate pass.

## When to use

- Adding a feature or fixing a bug where the test should define "done".
- Any behaviour-bearing edit outside a `dossier:build` covenant. Under a covenant, `dossier:build` drives WHEN and WHAT and composes this skill's `run-slice` as its RED/GREEN proof (dossier ADAPTERS §whetstone); the §T row already fixes the seam, so the interview is skipped. One ledger drives one edit.

## The seam (agree it first)

Before the first assertion, name the **seam**: the public boundary you test through — a function signature, an HTTP route, a CLI. Get the user's agreement on it. Assert behaviour through that boundary, so the test survives a refactor and fails when the behaviour is wrong. A wrong seam buys tests that pass over broken behaviour, or break on every rename. Highest-value moment in the loop; spend it.

## The loop (one slice at a time)

1. **RED — write one failing test.** Then prove it fails for the right reason:

   ```bash
   run-slice red <test-command>
   ```

   `run-slice red` exits non-zero when the test *passed* — a test that never failed characterises nothing. Check the test against `reference/anti-patterns.md` and `reference/examples.md` before running it; mock only where `reference/mocking.md` allows.

1. **GREEN — minimum code to pass:**

   ```bash
   run-slice green <test-command>
   ```

   Just enough for this one test.

1. **Full-suite gate:**

   ```bash
   run-slice full <suite-command>
   ```

   The slice leaves everything else green.

1. **Next slice** — one seam, one test, one implementation per cycle. Repeat from RED.

A test that fails, then passes on a rerun with no change, is a flake signal. Measure it before any fix:

```bash
FLAKE_TEST_NAME=<test-id> flake-runner 10 "$(mktemp -d)/results.json" <test-command>
```

It prints `FLAKY <fails>/<runs> <rate> <test-id>` when the rate is between 0 and 1. A flaky test gets the framework's skip marker and a tracking issue, not a code fix in this slice.

## Refactor is a separate pass

Once GREEN and the suite passes, the slice is done. Cleanup and design improvement go to a review/simplify step, so a failure during red-green means exactly one thing.

## Verification

Each slice: `run-slice red` exited 0 (the test genuinely failed first), then `run-slice green` and `run-slice full` exited 0. Three exit codes gate the slice.

## Dossier breadcrumb

In a repo with a live dossier ledger, record the verdict as one §S line through the dossier plugin's append tooling (the host session reminds when applicable; the first live row is the current dossier). No dossier → skip: this skill ships no hooks and no dossier dependency.
