---
name: dossier-converge
description: Run a wave contract's done-when criteria and report whether the wave is over. Use when the user says "ds:converge", "are we done", "is this wave finished", or asks whether more work on the current wave is warranted.
argument-hint: '[contract-path]'
---
## Pi runtime

Resolve bundled paths against this file, not the project working directory. The plugin root is `../..` from this file's directory. Before each shell call that uses `$DOSSIER_PLUGIN_ROOT`, set that variable to the shell-quoted absolute plugin root in that same shell. Pi does not supply it. Keep the shell working directory in the consuming project.

Load another installed skill with `read` on its advertised SKILL.md path; user commands use `/skill:<name>`. Check the available skills and tools before an optional sibling route. An absent sibling means skip, never install or scan caches. Pi does not add plugin bin directories to PATH: resolve bundled tools by absolute path. For dossier-to-whetstone script routes, check `../whetstone/bin/<tool>` relative to dossier's plugin root; if absent, use the documented absent-skip result.

Use `read/edit/write/bash/grep/find` for the corresponding host operations. Fresh missions use `dossier_delegate` or `whetstone_delegate` for that plugin's named agents, with unqualified `agent` and artifact-only `task`. The tool uses the current model unless the operator supplies an exact `provider/model`. Builders use `agent: general-purpose, write: true`; named reviewers cannot use edit/write. Bash read-only is prompt-only, not a sandbox. A return is final: a follow-up mission is a fresh call, not a message to a retained agent. Parallel independent missions may use concurrent calls.

Web tools and advisor tools are optional. Use installed web tools when present, or read-only `curl`/`gh api` through bash; identify any inaccessible source. The Pi extension supplies mutation guards and model-facing advisories. The task ledger is authoritative; `/dossier-tasks` is a read-only view, not a second task store.


# ds:converge — ask the contract whether the wave is over

A `§T` list says what to do and never what done means, so the objective drifts to whatever was asked most recently. This verb reads the contract and answers from commands.

## Run it

```bash
"$DOSSIER_PLUGIN_ROOT"/cli/ds converge [contract-path]
```

No argument → the runner resolves the live wave's contract: the tracked `.dossier/` home first, then the wave directory's own `CONTRACT.md`. No live wave is `PARSE` — a closed wave's contract runs by explicit path only. Two or more live waves that each resolve a contract is also `PARSE`, naming them: the runner will not pick one by date, so pass the path or pause/close the stale ones.

| exit | line                         | meaning                                   |
| ---- | ---------------------------- | ----------------------------------------- |
| 0    | `CONVERGE: MET <n>/<n>`      | every criterion met — the wave is over    |
| 1    | `CONVERGE: UNMET <n> of <m>` | the named criteria are the remaining work |
| 2    | `CONVERGE: PARSE — <why>`    | the contract could not be read            |
| 69   | none                         | `cli/ds` needs Node.js 22.18+             |
| 70   | none                         | `cli/ds` internal error                   |
| 141  | none                         | the reader closed the pipe; the run stopped at the next write |

**Read the `CONVERGE:` line before the exit code.** No `CONVERGE:` line means nothing ran.

Criteria are shell, and `/skill:dossier-close` resolves a contract with no argument, so the runner names the work first: a `contract: <path>` header — carrying `(wave-dir, untracked)` when that home won — then one `will run <id>. <command>` line per criterion, flushed before the first command starts. The flush is load-bearing: every caller here reads a pipe, and a buffered block arrives at exit, after the commands it was meant to preview. In a repo somebody else wrote, read that block — the untracked home is a file no diff ever showed a reviewer.

## What a contract looks like

`.dossier/<date>-<slug>.md` where the repo opted into tracking (the directory exists), else `<wave-dir>/CONTRACT.md` beside the ledger. The tracked home is the strong one: it can be cited as evidence and it outlives the wave's archive. `/skill:dossier-new` says as much when it writes the weaker one.

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

`expect` is `exit <n>`, `stdout: <substring>`, or `stdout: (nothing)`. Both `stdout:` forms also need exit 0, and `stdout: (nothing)` means output that is empty or only whitespace. A `grep -c` that finds no match prints `0` but exits 1, so `stdout: 0` is never met: write a zero count as `grep -q <pattern> <file>` with `exit 1`.

Four shapes are refused at parse time — each `CONVERGE: PARSE`, exit 2:

- **A numbered row that is not exactly `id | command | expect`.** A row whose `expect` cell was lost to a formatter used to be skipped while the prompt hook still counted it — `MET 1/1` for a contract of two criteria, one of which never ran. (An extra cell, which is how an unescaped pipe arrives, was already refused for not being backticked.)

- **A prose criterion.** Every criterion is a backticked command; `the tests should pass` would otherwise reach the shell, run `the`, and report whatever that did.

- **A missing or empty `consumer`.** The field that asks whether the work reaches anyone, and the one nobody writes unprompted. A wave once hardened a checker through three review rounds while no consumer could execute it.

- **An empty or unreadable `expect`.** A bare `stdout:` matches every output and would report MET on any command that exits 0, so it is refused along with the rest of the malformed forms.

Nesting is bounded rather than banned. A criterion may invoke the runner — this runner's own contract does — and the invocation count travels in `DS_CONVERGE_DEPTH`: one nested level runs, the next is refused (`CONVERGE: PARSE`, exit 2). Reading a command string cannot decide what will recurse; counting invocations can.

## When it says MET

Say so and stop. Report the table. Further work on this wave starts with a new criterion, which is a scope decision and belongs to the operator.

## When it says UNMET

The unmet rows are the remaining work, in order, and the only justified work on this wave.

## When asked for more work anyway

Report the state first: how many criteria the contract carries, budget spent, what the recent commits changed. The `UserPromptSubmit` hook already puts those beside the prompt, in the shape

```
wave <slug> · <n> criteria · run ds:converge for the verdict
  commits: <spent> of <budget>
```

**Which criteria are met is the one thing that line does not carry.** Running them on every prompt would put their whole cost there, so the prompt hook (`cli/ds convergence-state`) reports only what is cheap and leaves the verdict to this verb — the count is a pointer, not a result. When the answer turns on met/unmet, run the runner above and quote its `CONVERGE:` line. An instruction to keep going is cheap to satisfy and expensive to satisfy blindly — make the trade visible, then follow the operator's call.

## Dossier breadcrumb

Record a non-MET verdict as one `§S` line — `converge=unmet@<n>` or `converge=parse`. A MET verdict closes the wave, so `/skill:dossier-close` records that one. No dossier → skip; this reads a contract, not a ledger.
