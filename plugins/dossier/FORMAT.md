# FORMAT.md: the dossier files

Every shape here is read by a `ds` command. `ds lint` checks the plan file, and `ds triage` checks the rows.

## Files

```
.scratchpad/
├── OPEN-WORK.md                 the register of all work: one line for each dossier and each loose row
├── LATER.md                     a view of the later rows, written by ds triage
└── dossier/
    ├── <YYYY-MM-DD>-<slug>/
    │   ├── DOSSIER.md           the plan
    │   ├── worklog.md           one line per ds command; notes through ds log
    │   ├── .sessions            one Claude Code session id per line, of each session whose ds command used the dossier
    │   ├── missions/O<N>.md     task files, from ds mission
    │   ├── pack-plan.md         from ds pack plan
    │   ├── plan-check-<N>.md    the findings of plan check N, at the path that pack-plan.md names
    │   ├── checked-plan.md      the plan text the plan checker read, from ds record plan
    │   ├── rulings.md           the rulings on the plan check, from ds amend
    │   ├── pack-review.md       from ds pack review
    │   ├── <agent>-<sha>.md     the findings of a review, at the path that pack-review.md names
    │   ├── baseline.txt         from ds check --baseline
    │   ├── check.txt            from ds check
    │   └── samples/<check>/     the other input of a check, read by ds check --baseline
    └── _archive/                closed dossiers
```

The ledger lives in the main checkout. A `ds` command run in a linked worktree reads and writes the main checkout's `.scratchpad/`. The review record is `$(git rev-parse --git-common-dir)/reviews.jsonl`, which every worktree of the repo shares. The rig's hook writes it when a reviewer ends. `ds` only reads it.

## Rows

```
- O193 next A Remove the review gate at turn end
- O194 wait H Approve the PR
- O195 later H Re-read the spend · until 2026-12-01
- O196 done A Drop the claim check · 3f2a9c1
- O197 drop A Port the pace view · replaced by a new row
```

- The fields are the ID, the state, who (`A` agent, `H` operator), the title, then a tail after ` · `.
- States: `now`, `next`, `wait` (waits on the operator), `later` (deferred), `done` (the tail is the commit or the decision), `drop` (the tail is the reason).
- A title is at most 80 characters, with no bold, no code marks, no ` · ` and no other IDs. Detail goes under `## Notes` as `### O<N>`.
- The order of the rows in a plan is the build order. `ds next` gives the first open agent row, and does not wait for an operator row above it. An agent row that needs an operator row is `wait`, and its tail names that row; `ds set <id> next` releases it when that row is done.
- A `later` tail is one of `until <YYYY-MM-DD>`, `after <dossier-slug>` or `after pr <owner>/<repo>#<n>`.
- `ds add` gives each row its number from `~/.local/state/ds/next-id`, under a lock, and never at or below the highest O number in the repo's ledger files.

## DOSSIER.md

```
# <slug>

state: plan
row: O<N>
branch: <branch>
base: main
pr: <PR title>
checked: <plan hash, or ->

## Goal
## Scope
## Decisions
## Checks
## Edge cases
## Commits
## Rows
## Notes
```

- **Header**: `row:` is required. It names the ID of the dossier's line in the register, as `O<N>`. `ds lint` reports `header: row` when it is missing or has a different shape. `ds` sets `state` (`plan`, `build`, `ship`, `done`) and `checked`. `ds close` adds `closed:`. When the ship tool renames the branch from `<type>/cc-<session>-<topic>` to `<type>/<topic>`, the next `ds` command writes the new name to `branch:` and logs it.
- **Goal**: the operator's words, quoted.
- **Scope**: `- in: <text>` and `- out: <text>`.
- **Decisions**: `1. <question> — <answer> · <YYYY-MM-DD>`, then `confirmed: "<the operator's words>"`. An answer of `?` is open. A decision split on "discuss more" is answered `split into <n>, <m>`, and its parts are new numbered decisions. A decision that waits on someone outside the room is answered `waits on <who>: <questionnaire path>`, with a `wait` row for it.
- **Checks**: a table `| name | command | expect | guard | rows |`. The command is in backticks, with `\|` for a pipe. `expect` is `exit <n>`. `guard` is `yes` or `no`. `rows` names the rows the check proves. `ds check --baseline` wants each check to fail, except a guard and a check whose rows are all `done`, which must pass.
- **Samples**: a folder `samples/<check name>/` holds the files that give a check its other result. `ds check --baseline` runs the check there too, with that folder as the working folder: a check that fails on the tree must exit with its expected code on the sample, and a guard must not. A check with no folder prints `no sample`. A check that reads a live host or an absolute path has no sample.
- **Edge cases**: `- <case> → <row IDs or check names>`.
- **Commits**: a table `| subject | rows | paths |`. Paths are globs (`*`, `**`, or a folder ending in `/`). A subject is a Conventional Commits subject of at most 50 characters, and no subject is the start of another.
- **Rows**: the row list.
- **Notes**: free text, one `### O<N>` block per row that needs detail.

The plan hash covers Goal, Scope, Decisions, Checks, Edge cases and Commits. A change to those sections after the plan check shows in `ds triage` until `ds amend` passes. A new row needs no new check.

A plan gets one plan check. `ds record plan` keeps the checked text in `checked-plan.md`. When that file is absent, `ds` reads the plan in `pack-plan.md` if its hash is the hash of the last `record plan` line. After a `CHANGES` verdict, the author writes a rulings file with one line per finding, numbered in the order of the findings file: `block <n>: fixed: <what shows it>` or `block <n>: refused: <what shows it>`, and `note <n>: taken: <why>`, `note <n>: row O<id>` or `note <n>: dropped: <reason>`. A finding is a line whose first label is `block:` or `note:`; `ds record plan` prints each one with its number and refuses a `CHANGES` file with none. `ds amend <rulings file>` exits 1 unless each finding has a ruling, the lint is clean, the baseline of the current text is green, and the Goal and Scope equal the checked text. It then sets `checked` and adds the rulings to `rulings.md`. After a `PASS`, `ds amend <notes file>` does the same for a later edit, with a note of what changed. A changed Goal or Scope needs a fresh plan check.

## Verdicts

A findings file from the plan checker or the reviewer ends with one line, `VERDICT: PASS` or `VERDICT: CHANGES`.
