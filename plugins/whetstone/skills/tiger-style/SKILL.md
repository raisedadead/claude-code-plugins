---
name: tiger-style
description: Check the column budget of the lines a change adds, and read that change against the TIGER_STYLE shape rules a script cannot judge. Use when the user asks about line length or column limits, to check code shape, what the column check flagged, or why a commit was blocked on a column budget.
---

# tiger-style — one shape rule computed, the rest read by hand

TIGER_STYLE is a code-shape discipline. Exactly one of its rules is cheap to compute from a diff; the rest need a reader. This skill keeps those two halves apart and labelled, because a checklist that pretends to be a gate is worse than no gate.

## When to use

- Before committing a change that adds source lines.
- When a build reports `TIGER: BLOCK` or `TIGER: NAG` and you need to know which limit applied.
- When reviewing someone else's diff for shape rather than correctness.

## Run the check

```bash
python3 "${CLAUDE_PLUGIN_ROOT}"/skills/tiger-style/scripts/tiger_check.py [repo-path]
```

Reads the **staged** diff (`git diff --cached`), never `HEAD` — a diff against `HEAD` is empty when a change consists only of staged-new files, which would leave the check silently disarmed on exactly the commits that add the most code.

Only lines the change **adds** are measured. Existing long lines are somebody else's commit.

| exit | signal             | meaning                                                   |
| ---- | ------------------ | --------------------------------------------------------- |
| 0    | `TIGER: CLEAN`     | no added line is over its limit                           |
| 1    | `TIGER: BLOCK <n>` | `<n>` added lines exceed a limit **the repo declared**    |
| 2    | `TIGER: NAG <n>`   | `<n>` added lines exceed the built-in 100-column fallback |
| 64   | —                  | the path is not a git work tree                           |

Each offence prints as `path:line: <width> cols (limit <n>)` before the verdict line.

One run can turn up both kinds at once — a declared-limit offence in one file and a fallback offence in another. Every offence is printed either way, but `<n>` in the verdict counts only the kind the verdict names. A fallback offence is never counted into a `BLOCK` and never blocks a commit, whatever else the run found.

### Which limit applies

Resolved per file, first match wins:

1. `WHETSTONE_TIGER_COLS` — an integer. Declared, so it **blocks**.
1. `.editorconfig` `max_line_length` for the nearest section matching the file. Declared, so it **blocks**. A value of `off` is spec-legal and skips the file entirely.
1. Nothing declared → 100 columns, and exceeding it only **nags**.

The distinction is the point: a repo that has stated its limit gets it enforced, and a repo that has not gets told, never stopped. The env var carries whetstone's own prefix rather than a `DOSSIER_` one — this is whetstone's behaviour, and it must be configurable by someone who has never installed the dossier plugin.

Prose and data formats are skipped outright (`.md`, `.markdown`, `.rst`, `.txt`, `.json`, `.jsonl`, `.csv`, `.tsv`, `.svg`, `.lock`, `.snap`, and the common lockfile names). A column limit describes a statement, not a record.

## The manual pass — what the script cannot judge

These are the TIGER_STYLE rules that need a reader. **Nothing enforces them.** They produce no exit code, and no tool will stop a commit that violates them. Read the diff against them yourself:

- **Function length.** A function that does not fit on a screen is doing more than one thing. Split at the seam, not at the line count.
- **Assert adequacy.** A non-trivial function asserts its preconditions. Assert the negative space too — the states that must never occur, not only the ones you expect.
- **Loop bounds.** Every loop states an upper bound. An unbounded loop is a hang waiting for the input that triggers it.
- **Limits as numbers.** Every limit is a named constant with a stated unit, never an inline literal. A magic number is a decision nobody can find later.

Treat this list the way `skill-smith` treats its reference checklists: the exit code is the gate, the checklist is the judgement, and the two are never described as the same thing.

Inside a dossier build run with `--review`, the `dossier-reviewer` agent reads the diff against this same list. That does not make it a gate: its findings on these four rules are capped at `Warn:`, which cannot block a commit, and `--review` is opt-in — it auto-fires only for destructive-class tasks, a category that has nothing to do with code shape. A second reader is worth having. It is not enforcement.

## What is deliberately not here

Four TIGER_STYLE rules are absent on purpose, so their absence does not read as an oversight:

- **Assert the negative space, as a testing rule** — already carried by the repo's testing standard: `run_slice.sh` fails a slice whose test passed on its first run, and every gate is required to ship a positive and a negative test. That is the same rule enforced one level up, at the test rather than at the function.
- **Zero technical debt** — a caught bug becomes a recorded, testable invariant through the dossier plugin's backprop verb. `ds:check` runs those checks when asked, and only a high-recurrence class is promoted to a write-time guard; nothing runs them on every commit by itself. Denying `TODO` / `FIXME` markers at write time is a personal coding standard and belongs in an operator's own harness, not shipped to everyone who installs a plugin.
- **Say why in comments** — same reason. Comment policy is one person's taste; a plugin that ships it imposes it.
- **Static allocation, no recursion** — TIGER_STYLE was written for a database in Zig. These rules do not translate to Python, bash and markdown, and pretending otherwise would be cargo cult.

## Not built yet

Named so nobody assumes they work:

- **Formatter configs as a limit source.** Prettier's `printWidth`, black's `line-length` and rustfmt's `max_width` are not read. Only `WHETSTONE_TIGER_COLS` and `.editorconfig` are.
- **Full `.editorconfig` glob syntax.** Brace expansion, `*`, `**`, `?` and `[seq]` work. Escapes and numeric ranges (`{1..9}`) do not.
- **Per-language parsing.** Width is counted in characters. There is no AST, so nothing here can measure a function's length or find a magic number — which is exactly why those rules sit in the manual pass above rather than in the table.

## Verification

Done = `tiger_check.py` exits 0 or 2 **and** you have read the diff against the manual pass. Exit 1 is not done: a declared limit was exceeded.

Separately, and only when you suspect the tool itself rather than the diff, `plugins/whetstone/tests/test_tiger_check.py` exercises the checker against fixture repositories. That proves the checker works; it says nothing about your change.

## Dossier breadcrumb

In a repo with a live dossier ledger, record a non-clean verdict as one `§S` line through the dossier plugin's append tooling — `tiger=block@<n>` or `tiger=nag@<n>`. A clean run writes nothing; a log that records every uneventful pass buries the events that matter. No dossier → skip, no-op: this skill ships no hooks and needs no dossier to run.
