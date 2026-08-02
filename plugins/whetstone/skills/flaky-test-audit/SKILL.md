---
name: flaky-test-audit
description: Run a test suite repeatedly, compute a per-test flakiness rate, quarantine the nondeterministic ones. Use when the user asks whether a test is flaky, to audit test health, why a test sometimes fails, to find flaky tests, or as a scheduled nightly or weekly test-health routine.
---

# flaky-test-audit — measure flakiness, don't guess it

A test is flaky when it passes and fails on the same code. That is a number: run it N times, count the failures, and any test with a rate strictly between 0 and 1 is flaky by definition. The flag itself is computation, not judgement.

## When to use

- A test "sometimes fails" and you want it confirmed and quantified.
- Periodic test-health sweep (nightly / weekly) that escalates only when a new test turns flaky.

## Process

1. **Detect the framework** and pick a per-test invocation — see `reference/framework-adapters.md`. The unit of work is a `results.json` mapping `test -> {"runs", "fails"}`.

1. **Run repeatedly.** For a single suspect test, or a loop over test ids:

   ```bash
   FLAKE_TEST_NAME="<test-id>" \
     "${CLAUDE_PLUGIN_ROOT}"/skills/flaky-test-audit/scripts/flake_runner.sh 10 results.json <test-command>
   ```

   Or produce `results.json` directly from a framework's JSON reporter aggregated across N runs (adapters doc).

1. **Compute the rate:**

   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}"/skills/flaky-test-audit/scripts/compute_flakiness.py \
     results.json prev-quarantine.json quarantine.json
   ```

   It prints a sorted `FLAKY fails/runs rate test` table, writes `quarantine.json` for every `0 < rate < 1` test, and **exits with the count of tests newly flaky since `prev-quarantine.json`**. Nonzero exit = a scheduled routine escalates; zero = no new flake, stay quiet.

1. **Quarantine + track.** For each newly-flagged test: add the framework's skip/quarantine marker with a tracking issue reference, so the suite goes green while the flake is investigated separately.

## Model routing (for a scheduled routine)

The detection is a script — route the N reruns and the rate computation to a cheap/fast model or run them as pure shell. Reserve the capable model for the judgement the number cannot make: **why** a newly-flagged test is nondeterministic (ordering, shared state, time, network).

## Verification

Done = `compute_flakiness.py` wrote `quarantine.json` and its exit code is the count of newly-flaky tests. The rate is the gate; the quarantine file is the artifact. Quarantine holds exactly the `0 < rate < 1` tests — a deterministic pass or a deterministic fail is a different problem.

## Dossier breadcrumb

In a repo with a live dossier ledger, record the verdict as one §S line through the dossier plugin's append tooling (the host session reminds when applicable; the first live row is the current dossier). No dossier → skip: this skill ships no hooks and no dossier dependency.
