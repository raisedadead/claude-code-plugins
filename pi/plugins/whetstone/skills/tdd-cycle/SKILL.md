---
name: whetstone-tdd-cycle
description: Drive one vertical slice of behaviour red-green-refactor, seam agreed before the first test. Use when the user asks to add a feature, fix a bug, write code test-first, says "TDD this", "red green refactor", or "write a failing test first". Inside a live dossier:build covenant, invoke dossier:build instead — it composes this skill's run_slice.sh as its RED/GREEN proof.
---
## Pi runtime

Resolve bundled paths against this file, not the project working directory. The plugin root is `../..` from this file's directory. Before each shell call that uses `$WHETSTONE_PLUGIN_ROOT`, set that variable to the shell-quoted absolute plugin root in that same shell. Pi does not supply it. Keep the shell working directory in the consuming project.

Load another installed skill with `read` on its advertised SKILL.md path; user commands use `/skill:<name>`. Check the available skills and tools before an optional sibling route. An absent sibling means skip, never install or scan caches. Pi does not add plugin bin directories to PATH: resolve bundled tools by absolute path. For dossier-to-whetstone script routes, check `../whetstone/bin/<tool>` relative to dossier's plugin root; if absent, use the documented absent-skip result.

Use `read/edit/write/bash/grep/find` for the corresponding host operations. Fresh missions use `dossier_delegate` or `whetstone_delegate` for that plugin's named agents, with unqualified `agent` and artifact-only `task`. The tool uses the current model unless the operator supplies an exact `provider/model`. Builders use `agent: general-purpose, write: true`; named reviewers cannot use edit/write. Bash read-only is prompt-only, not a sandbox. A return is final: a follow-up mission is a fresh call, not a message to a retained agent. Parallel independent missions may use concurrent calls.

Web tools and advisor tools are optional. Use installed web tools when present, or read-only `curl`/`gh api` through bash; identify any inaccessible source. The Pi extension supplies mutation guards and model-facing advisories. The task ledger is authoritative; `/dossier-tasks` is a read-only view, not a second task store.


# tdd-cycle — one slice, red before green

Test-first for ad-hoc work that no ledger is driving. Agree the seam, watch the test fail, make it pass, keep the suite green. Refactoring is a separate pass.

## When to use

- Adding a feature or fixing a bug where the test should define "done".
- Any behaviour-bearing edit outside a `/skill:dossier-build` covenant. Under a covenant, `/skill:dossier-build` drives WHEN and WHAT and composes this skill's `run_slice.sh` as its RED/GREEN proof (dossier ADAPTERS §whetstone); the §T row already fixes the seam, so the interview is skipped. One ledger drives one edit.

## The seam (agree it first)

Before the first assertion, name the **seam**: the public boundary you test through — a function signature, an HTTP route, a CLI. Get the user's agreement on it. Assert behaviour through that boundary, so the test survives a refactor and fails when the behaviour is wrong. A wrong seam buys tests that pass over broken behaviour, or break on every rename. Highest-value moment in the loop; spend it.

## The loop (one slice at a time)

1. **RED — write one failing test.** Then prove it fails for the right reason:

   ```bash
   "$WHETSTONE_PLUGIN_ROOT"/skills/tdd-cycle/scripts/run_slice.sh red <test-command>
   ```

   `run_slice red` exits non-zero when the test *passed* — a test that never failed characterises nothing. Check the test against `reference/anti-patterns.md` and `reference/examples.md` before running it; mock only where `reference/mocking.md` allows.

1. **GREEN — minimum code to pass:**

   ```bash
   run_slice.sh green <test-command>
   ```

   Just enough for this one test.

1. **Full-suite gate:**

   ```bash
   run_slice.sh full <suite-command>
   ```

   The slice leaves everything else green.

1. **Next slice** — one seam, one test, one implementation per cycle. Repeat from RED.

## Refactor is a separate pass

Once GREEN and the suite passes, the slice is done. Cleanup and design improvement go to a review/simplify step, so a failure during red-green means exactly one thing.

## Verification

Each slice: `run_slice red` exited 0 (the test genuinely failed first), then `run_slice green` and `run_slice full` exited 0. Three exit codes gate the slice.

## Dossier breadcrumb

In a repo with a live dossier ledger, record the verdict as one §S line through the dossier plugin's append tooling (the host session reminds when applicable; the first live row is the current dossier). No dossier → skip: this skill ships no hooks and no dossier dependency.
