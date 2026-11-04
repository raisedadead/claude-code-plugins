---
name: whetstone-skill-smith
description: Lint and structure-check a SKILL.md — frontmatter, line budget, trigger clause, reference depth. Use when the user asks to write a new skill, review this skill, lint a SKILL.md, check skill frontmatter, or after editing any file under a skills/*/SKILL.md path.
---
## Pi runtime

Resolve bundled paths against this file, not the project working directory. The plugin root is `../..` from this file's directory. Before each shell call that uses `$WHETSTONE_PLUGIN_ROOT`, set that variable to the shell-quoted absolute plugin root in that same shell. Pi does not supply it. Keep the shell working directory in the consuming project.

Load another installed skill with `read` on its advertised SKILL.md path; user commands use `/skill:<name>`. Check the available skills and tools before an optional sibling route. An absent sibling means skip, never install or scan caches. Pi does not add plugin bin directories to PATH: resolve bundled tools by absolute path. For dossier-to-whetstone script routes, check `../whetstone/bin/<tool>` relative to dossier's plugin root; if absent, use the documented absent-skip result.

Use `read/edit/write/bash/grep/find` for the corresponding host operations. Fresh missions use `dossier_delegate` or `whetstone_delegate` for that plugin's named agents, with unqualified `agent` and artifact-only `task`. The tool uses the current model unless the operator supplies an exact `provider/model`. Builders use `agent: general-purpose, write: true`; named reviewers cannot use edit/write. Bash read-only is prompt-only, not a sandbox. A return is final: a follow-up mission is a fresh call, not a message to a retained agent. Parallel independent missions may use concurrent calls.

Web tools and advisor tools are optional. Use installed web tools when present, or read-only `curl`/`gh api` through bash; identify any inaccessible source. The Pi extension supplies mutation guards and model-facing advisories. The task ledger is authoritative; `/dossier-tasks` is a read-only view, not a second task store.


# skill-smith — lint a SKILL.md

A skill lives or dies on its routing and its shape. The script judges the deterministic half — frontmatter, line budget, reference depth — and hands you a checklist for the half it cannot.

## When to use

- Authoring a new skill — run it before calling the skill done.
- Reviewing or editing an existing `SKILL.md`.
- After any edit under a `skills/*/SKILL.md` path.

## Run the lint

```bash
"$WHETSTONE_PLUGIN_ROOT"/bin/lint-skill <path-to-SKILL.md>
```

Pass a single `SKILL.md`, or a `skills/` directory to lint every skill under it. Exit 1 when any `FAIL` is present; `WARN` alone exits 0.

What it checks, deterministically:

- **name** — present, matches the parent directory, and uses the kebab charset (lowercase / digits / single hyphens, no leading, trailing, or doubled hyphen).
- **description** — present, ≤ 1024 chars, carries a `Use when` / `Invoke when` trigger clause, and reads third-person (a first-person `I …` is flagged).
- **body** — under the 500-line budget (a warning fires past 400).
- **reference depth** — every bundled file (`reference/…`, `scripts/…`) stays one level deep; a file nested deeper is a `WARN`, so the run still exits 0 and the rule is yours to hold.

## The loop

Fix the reported `FAIL`s, re-run, repeat — cap at **3 rounds**. Findings still standing after the third round go to the operator as a residual list. The exit criterion is `lint-skill` exiting 0, judged by the script.

`WARN`s exit 0 and are still worth reading — a first-person description or a body creeping toward the budget is cheapest to fix while you are here.

## Manual pass (what the script cannot judge)

Three things stay judgement calls. Before you write, read `reference/writing-for-agents.md`; after the lint is clean, read the change against the other two:

- `reference/writing-for-agents.md` — the rubric for any document an agent reads: context pointers, the information hierarchy, completion criteria, leading words and pruning. A skill also reads `reference/skill-mechanics.md`.
- `reference/anatomy.md` — the canonical section order and the frontmatter contract. Diff a new skill's shape against it.
- `reference/failure-modes.md` — the six ways a skill rots (premature completion, duplication, sediment, sprawl, no-op, negation). Use it as a read-through checklist.

## Verification

Done = `lint-skill <path>` exits 0 **and** you have read the change against all three references. The exit code is the gate; the checklists are the judgement.

## Dossier breadcrumb

In a repo with a live dossier ledger, record the verdict as one §S line through the dossier plugin's append tooling (the host session reminds when applicable; the first live row is the current dossier). No dossier → skip: this skill ships no hooks and no dossier dependency.

## Claim check

`claim-check --stdin | <path>...` (also `node "$WHETSTONE_PLUGIN_ROOT"/hooks/claim-check-cli.ts`) reads shipped prose for a narrower defect than structure: a sentence asserting that something of ours **blocks**, **enforces**, **gates**, **denies**, **prevents** or **refuses**, while naming nothing a reader could check.

`--stdin` lints text that is not a file yet — a turn's own output, a commit message, a draft. It takes no paths: one input surface per invocation, so a clean file can never vouch for dirty stdin. Empty input is clean.

| exit | line                        | meaning                                                              |
| ---- | --------------------------- | -------------------------------------------------------------------- |
| 0    | `CLAIMS: CLEAN <n> file(s)` | every claim names an exit code, a citation, or a label               |
| 0    | `CLAIMS: CLEAN stdin`       | same verdict, reading stdin                                          |
| 1    | `CLAIMS: FLAGGED <n>`       | `<n>` claims name none of those                                      |
| 64   | —                           | no paths given, a path that does not exist, or `--stdin` with a path |

Read the `CLAIMS:` line before the exit code. A missing `node`, or a `node` older than 22.18, exits 1 with no `CLAIMS:` line, and 1 is also the flagged code.

A claim passes by naming an exit code, carrying a citation, or labelling itself advisory / model-judgment / opt-in / a nag. It decides **shape, never fact**: whether the exit code named is the real one stays a reader's question. That is the mechanical half of a defect class this repo keeps shipping (`RESEARCH.md` F25).

Deliberately narrow. The subject is a backticked name or a definite machinery noun (`the runner`, `this hook`, `the script`, `the gate`, `the check`/`checker`, `the guard`, `the linter`) followed by a finite verb; a verb trailed by a past participle reads as a noun and is left alone. Matching the bare verbs instead flagged 113 lines here, nearly all nouns and adjectives — "doubt gate", "env-gated backstops", "the three write-time gates". The narrowing trades misses for false positives on purpose: a lint that flags honest prose gets deleted, and then it catches nothing.
