---
name: close
description: Close a dossier wave through `ds close` — plan, show, run. Invoke when the user says "ds:close" or "close the dossier", or when every §T row is `x` and the next step is the close.
argument-hint: --complete | --successor <slug> | --abandon "<reason>" [--carry T<n>,...]
---

# ds:close — plan, show, run

`ds close` is the close. It runs the checks, the contract converge, the §Z write, the header flip, the archive move, the contract retire commit, the INDEX regen and the lock, and it writes a §S checkpoint after each step. This page picks the mode, shows the plan to the operator and runs it.

## Modes

| flag                   | use when                                                        |
| ---------------------- | --------------------------------------------------------------- |
| `--complete`           | every row is `x`, or each open row is carried                   |
| `--successor <slug>`   | the work continues in wave `<slug>`; carried rows go to its §T  |
| `--abandon "<reason>"` | the wave stops unfinished; open rows and bugs stay as they are  |
| `--carry T<n>,...`     | a `who=H` row or a row with a `T<n>+<k>d` need runs after close |

`--carry` writes the rows to the §Z `after:` line (FORMAT.md §12). With `--successor` it also copies them into the successor §T, each with a `(from <slug> T<n>)` note. Without `--successor` it adds them to the carried-work list, `.scratchpad/dossier/LATER.md`, once each, with a due date for a `+<k>d` need. Session start shows the list's count and each due row until `ds later done <key>` removes it.

## Steps

### 1. Plan

```bash
"${CLAUDE_PLUGIN_ROOT}"/cli/ds close <wave> <mode> [--carry T<n>,...] --plan
```

`--plan` writes nothing. Exit 0 prints `ready`; exit 1 prints `refused`. One finding per line:

| mark | meaning                                                               |
| ---- | --------------------------------------------------------------------- |
| `✗`  | blocks the run — an open row, an uncited `x` row, an open bug, a lock, a done-when table edited beside other files or left uncommitted |
| `✓`  | the contract converged                                                |
| `⚠`  | advisory — an unpushed repo, an accepted unmet criterion, no passing baseline, CHANGELOG, lessons |
| `·`  | a check that did not run, or a done-when edit made in its own commit  |
| `↷`  | a row this close carries                                              |

The last line before the verdict names the steps still to run.

### 2. Show

Put the plan in front of the operator, with a one-line `--summary` proposal. Resolve each `✗` before the run:

- An open agent row: `ds:build` it, or carry it when it is `who=H` or waits on a `+<k>d` need.
- An open bug: `ds:backprop B<n>`.
- An unmet or unparsed contract: fix it, or add `--accept-unmet` on the operator's explicit say-so. The flag records the unmet ids in §S.
- A done-when table that changed after the contract commit, beside other files or not committed: put the table edit in a commit of its own, so the change is visible to the operator. The check compares the parsed table at each commit; it shows the edit and does not judge it.
- Work that will not finish: `--abandon "<reason>"` on the operator's say-so.

Then print each `paused` row in `<root>/.scratchpad/INDEX.md` (`<root>` is the path `ds root` prints) with its route: resume it through `ds:status`, or close it with `--abandon`. The CHANGELOG check covers the ledger repo, the repo of a tracked contract, and each §X repo written as an absolute path, and stays silent when none of them tracks a `CHANGELOG.md`. A `⚠` CHANGELOG line means no `CHANGELOG.md` in those repos changed since the contract commit (write the entry, or close without one), or that the check did not run because the contract is untracked.

A `⚠ no passing converge baseline` line means §S has no `ds:converge — baseline OK` line, or its latest baseline line is a FAIL: the contract's rows were never seen to fail. Advisory.

A `⚠ lessons` line lists the wave's grill decisions. It prints only where the repo root has a `RESEARCH.md` and a grill artifact names this wave on its `CONSUMED:` line. Ask the operator which decisions become a §D row, and write those rows before the run. Advisory: the close runs whatever the answer.

### 3. Run

The same command without `--plan`, plus `--summary "<one line>"` and, when the default list of `x`-row cites is wrong, `--cites "<list>"`.

| exit | meaning                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| 0    | closed; the report names §Z, the archive path and any `after:` rows           |
| 1    | refused or stopped; stderr names the cause. Fix it and rerun the same command |
| 64   | usage                                                                         |

A rerun resumes from the last §S checkpoint (`START`, `§Z=written`, `archived`, `contract=<sha>`, `DONE`). It refuses a mode that differs from the open `START`. After §Z is written, `--summary` is no longer needed.

### 4. Report

Print the `ds close` report. Name the next action: `ds:new <successor>`, the carried rows and their due dates, or nothing.

## Honesty labels

| claim                                                          | enforced by                                      |
| -------------------------------------------------------------- | ------------------------------------------------ |
| open rows, uncited rows, open bugs and a held lock block a run | code — `ds close` exit 1                         |
| an unmet or unparsed contract blocks a run                     | code — `ds close` exit 1 unless `--accept-unmet` |
| only a `who=H` or `+<k>d` row carries                          | code — `ds close` exit 1                         |
| the contract retire commit holds only the two contract paths   | code — `git commit -- <old> <new>`               |
| `--accept-unmet` and `--abandon` follow the operator's say-so  | model — no script reads the operator's reply     |
| the plan is shown before the run                               | model — no hook fires between the two calls      |

## Cite

- `cli/close.ts` (the verb), `tests/test_close.ts` (one test per refusal and per step)
- FORMAT.md §2.5 (contract), §12 (§Z and `after:`), §13 (INDEX), §14 (locks), §16 (resume)
