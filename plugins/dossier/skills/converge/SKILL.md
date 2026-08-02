---
name: converge
description: Run a wave contract's done-when criteria and report whether the wave is over. Use when the user says "ds:converge", "are we done", "is this wave finished", or asks whether more work on the current wave is warranted.
argument-hint: '[contract-path]'
---

# ds:converge — ask the contract whether the wave is over

A `§T` task list says what to do. It never says what done means, so without a contract the objective drifts to whatever was asked most recently. This verb reads the contract instead and answers from commands.

## Run it

```bash
bash "${CLAUDE_PLUGIN_ROOT}"/hooks/lib-converge.sh [contract-path]
```

Default path is the newest `.dossier/*.md`.

| exit | line                         | meaning                                   |
| ---- | ---------------------------- | ----------------------------------------- |
| 0    | `CONVERGE: MET <n>/<n>`      | every criterion met — the wave is over    |
| 1    | `CONVERGE: UNMET <n> of <m>` | the named criteria are the remaining work |
| 2    | `CONVERGE: PARSE — <why>`    | the contract could not be read            |

**Read the `CONVERGE:` line before the exit code.** A missing runner makes the interpreter exit 1 or 2 by itself, which are this tool's own UNMET and PARSE codes, so a number alone cannot separate a verdict from a crash. No `CONVERGE:` line means nothing ran.

## What a contract looks like

`.dossier/<date>-<slug>.md`, tracked. A gitignored contract cannot be cited as evidence and dies with the wave.

```markdown
| field       | value                              |
| ----------- | ---------------------------------- |
| consumer    | who runs this                      |
| reached-via | the path by which it reaches them  |
| budget      | 8 commits                          |

## done-when

| id  | command             | expect            |
| --- | ------------------- | ----------------- |
| 1   | `pytest -q`         | exit 0            |
| 2   | `mytool --version`  | stdout: 1.        |
```

`expect` is `exit <n>`, `stdout: <substring>`, or `stdout: (nothing)`.

Three shapes the runner refuses at parse time — each one is `CONVERGE: PARSE`, exit 2:

- **A prose criterion.** Every criterion is a backticked command — `the tests should pass` would otherwise reach the shell, run `the`, and report whatever that did.
- **A missing or empty `consumer`.** It is the field that asks whether the work reaches anyone, and the one nobody writes unprompted. A wave once hardened a checker through three review rounds while no consumer could execute it.
- **An empty or unreadable `expect`.** A bare `stdout:` with no substring would match every output and report MET on any command that exits 0, so it is refused with the malformed rest.

Nesting is bounded, not banned. A criterion may invoke the runner — this runner's own contract does exactly that — and the invocation count travels in `DS_CONVERGE_DEPTH`: one nested level runs, the next refuses (`CONVERGE: PARSE`, exit 2). Reading the command string cannot decide what will recurse; counting invocations can.

## When it says MET

Say so and stop. Report the table. Further work on this wave needs a new criterion first — which is a decision about scope, and belongs to the operator.

## When it says UNMET

The unmet rows are the remaining work, in order. They are the only justified work on this wave.

## When asked for more work anyway

Report the state before acting: how many criteria are met, how much budget is spent, and what the recent commits actually changed. The `UserPromptSubmit` hook already puts that beside the prompt. An instruction to keep going is easy to satisfy and expensive to satisfy blindly, so make the trade visible and then follow the operator's call.

## Dossier breadcrumb

Record a non-MET verdict as one `§S` line — `converge=unmet@<n>` or `converge=parse`. A MET verdict closes the wave, so it is recorded by `ds:close` instead. No dossier → skip; this reads a contract, not a ledger.
