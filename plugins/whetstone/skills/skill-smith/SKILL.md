---
name: skill-smith
description: Lint and structure-check a SKILL.md — frontmatter, line budget, trigger clause, reference depth. Use when the user asks to write a new skill, review this skill, lint a SKILL.md, check skill frontmatter, or after editing any file under a skills/*/SKILL.md path.
---

# skill-smith — lint a SKILL.md

A skill lives or dies on its routing and its shape. The script judges the deterministic half — frontmatter, line budget, reference depth — and hands you a checklist for the half it cannot.

## When to use

- Authoring a new skill — run it before calling the skill done.
- Reviewing or editing an existing `SKILL.md`.
- After any edit under a `skills/*/SKILL.md` path.

## Run the lint

```bash
python3 "${CLAUDE_PLUGIN_ROOT}"/skills/skill-smith/scripts/lint_skill.py <path-to-SKILL.md>
```

Pass a single `SKILL.md`, or a `skills/` directory to lint every skill under it. Exit 1 when any `FAIL` is present; `WARN` alone exits 0.

What it checks, deterministically:

- **name** — present, matches the parent directory, and uses the kebab charset (lowercase / digits / single hyphens, no leading, trailing, or doubled hyphen).
- **description** — present, ≤ 1024 chars, carries a `Use when` / `Invoke when` trigger clause, and reads third-person (a first-person `I …` is flagged).
- **body** — under the 500-line budget (a warning fires past 400).
- **reference depth** — every bundled file (`reference/…`, `scripts/…`) stays one level deep; a file nested deeper is a `WARN`, so the run still exits 0 and the rule is yours to hold.

## The loop

Fix the reported `FAIL`s, re-run, repeat — cap at **3 rounds**. Findings still standing after the third round go to the operator as a residual list. The exit criterion is `lint_skill.py` exiting 0, judged by the script.

`WARN`s exit 0 and are still worth reading — a first-person description or a body creeping toward the budget is cheapest to fix while you are here.

## Manual pass (what the script cannot judge)

Two things stay judgement calls. After the lint is clean, read the change against them:

- `reference/anatomy.md` — the canonical section order and the frontmatter contract. Diff a new skill's shape against it.
- `reference/failure-modes.md` — the six ways a skill rots (premature completion, duplication, sediment, sprawl, no-op, negation). Use it as a read-through checklist.

## Verification

Done = `lint_skill.py <path>` exits 0 **and** you have read the change against both reference checklists. The exit code is the gate; the checklists are the judgement.

## Dossier breadcrumb

In a repo with a live dossier ledger, record the verdict as one §S line through the dossier plugin's append tooling (the host session reminds when applicable; the first live row is the current dossier). No dossier → skip: this skill ships no hooks and no dossier dependency.

## Claim check

`claim-check --stdin | <path>...` (also `skills/skill-smith/scripts/claim_check.py`) reads shipped prose for a narrower defect than structure: a sentence asserting that something of ours **blocks**, **enforces**, **gates**, **denies**, **prevents** or **refuses**, while naming nothing a reader could check.

`--stdin` lints text that is not a file yet — a turn's own output, a commit message, a draft. It takes no paths: one input surface per invocation, so a clean file can never vouch for dirty stdin. Empty input is clean.

| exit | line                        | meaning                                                              |
| ---- | --------------------------- | -------------------------------------------------------------------- |
| 0    | `CLAIMS: CLEAN <n> file(s)` | every claim names an exit code, a citation, or a label               |
| 0    | `CLAIMS: CLEAN stdin`       | same verdict, reading stdin                                          |
| 1    | `CLAIMS: FLAGGED <n>`       | `<n>` claims name none of those                                      |
| 64   | —                           | no paths given, a path that does not exist, or `--stdin` with a path |

A claim passes by naming an exit code, carrying a citation, or labelling itself advisory / model-judgment / opt-in / a nag. It decides **shape, never fact**: whether the exit code named is the real one stays a reader's question. That is the mechanical half of a defect class this repo keeps shipping: `RESEARCH.md` F19 counts six false documented claims, F25 six instances across one wave.

Deliberately narrow. The subject is a backticked name or a definite machinery noun (`the runner`, `this hook`, `the script`, `the gate`, `the check`/`checker`, `the guard`, `the linter`) followed by a finite verb; a verb trailed by a past participle reads as a noun and is left alone. Matching the bare verbs instead flagged 113 lines here, nearly all nouns and adjectives — "doubt gate", "env-gated backstops", "the three write-time gates". The narrowing trades misses for false positives on purpose: a lint that flags honest prose gets deleted, and then it catches nothing.
