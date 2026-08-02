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

Reads the **staged** diff (`git diff --cached`), never `HEAD`. `--cached` compares HEAD against the index, which is exactly what the commit will contain. `HEAD` would compare against the working tree instead: it would flag unstaged edits the commit does not carry, and it fails outright in a repository with no commits yet — a failure the checker would read as "nothing was added".

Only lines the change **adds** are measured. Existing long lines are somebody else's commit.

| exit | signal                                    | meaning                                                                                                   |
| ---- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 0    | `TIGER: CLEAN <n> file(s)[, <m> skipped]` | no added line is over its limit, across the `<n>` files examined; `<m>` more were staged but not measured |
| 1    | `TIGER: BLOCK <n>`                        | `<n>` added lines exceed a limit **the repo declared**                                                    |
| 2    | `TIGER: NAG <n>`                          | `<n>` added lines exceed the built-in 100-column fallback                                                 |
| 64   | —                                         | the path is not a git work tree                                                                           |

Each offence prints as `path:line: <width> cols (limit <n>)` before the verdict line.

`CLEAN 0 files` and `CLEAN 3 files` are both exit 0, and the difference matters: the first means nothing was measured. A caller that reads only the exit code cannot tell "checked, fine" from "checked nothing" — which is how a mis-typed `git add` reads as a pass.

`CLEAN 0 files, 2 skipped` is a commit whose every file was prose, data, or declared `off` — a docs-only or lockfile-bump commit reaches it correctly, and it is not a mistake. A bare `CLEAN 0 files` means no added, copied, modified, renamed or type-changed path was staged at all, which has two causes: an empty index, or a commit that stages only deletions. Deletions have no added lines to measure, so they reach neither counter. Check your `git add` over the bare form when the commit was meant to change a file.

One run can turn up both kinds at once — a declared-limit offence in one file and a fallback offence in another. Every offence is printed either way, but `<n>` in the verdict counts only the kind the verdict names. A fallback offence is never counted into a `BLOCK` and never blocks a commit, whatever else the run found.

### Which limit applies

Resolved per file, first match wins:

1. `WHETSTONE_TIGER_COLS` — a **positive** integer. Declared, so it **blocks**. `0`, a negative, or a non-number is not a limit: the value is ignored, the fallback applies, and the reason is named on stderr. Silence there would be the worse bug — an operator who set `WHETSTONE_TIGER_COLS=0` would believe commits were being blocked while getting an advisory nag that blocks nothing.
1. `.editorconfig` `max_line_length` for the nearest section matching the file. Declared, so it **blocks**. A value of `off` is spec-legal and skips the file entirely.

"Nearest" is directory distance: the walk starts beside the file and stops at a `root = true`. It is not specificity. Where two sections in the **same** file both match, EditorConfig's own rule applies and the later one wins — `[*.py]` followed by `[*]` loses to the `[*]`, which is the opposite of what CSS-shaped intuition predicts.

A later section only wins if its value parses. `max_line_length = 0` in the more specific section leaves the broader section's limit standing, which is the same silent-ignore trap as the env var and gets the same treatment: the value is named on stderr rather than dropped.

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
- **Full `.editorconfig` glob syntax.** Brace expansion, `*`, `**`, `?`, `[seq]` and `[!seq]` work. Escapes and numeric ranges (`{1..9}`) do not. Brace expansion is capped at 256 alternatives — past that the pattern is left unexpanded and matches nothing, so the file falls back to the advisory limit instead of hanging the commit.
- **Configurable tab width.** A tab advances to the next multiple of 8. `.editorconfig`'s `tab_width` and `indent_size` are not read.
- **Per-language parsing.** Width is display columns — a tab advances to its stop, a CJK or otherwise wide character counts two, a combining mark counts zero. What is missing is an AST, so nothing here can measure a function's length or find a magic number, which is exactly why those rules sit in the manual pass above rather than in the table.

## Verification

Done = `tiger_check.py` exits 0 or 2 **and** you have read the diff against the manual pass. Exit 1 is not done: a declared limit was exceeded.

Separately, and only when you suspect the tool itself rather than the diff, `plugins/whetstone/tests/test_tiger_check.py` exercises the checker against fixture repositories. That proves the checker works; it says nothing about your change.

## Dossier breadcrumb

In a repo with a live dossier ledger, record a non-clean verdict as one `§S` line through the dossier plugin's append tooling — `tiger=block@<n>` or `tiger=nag@<n>`. A clean run writes nothing; a log that records every uneventful pass buries the events that matter. No dossier → skip, no-op: this skill ships no hooks and needs no dossier to run.
