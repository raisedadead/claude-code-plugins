---
name: skill-smith
description: Lint and structure-check a SKILL.md — frontmatter, line budget, trigger clause, reference depth. Use when the user asks to write a new skill, review this skill, lint a SKILL.md, check skill frontmatter, or after editing any file under a skills/*/SKILL.md path.
---

# skill-smith — lint a SKILL.md

A skill is only as good as its routing and its shape. This lints both the deterministic parts (frontmatter, line budget, reference depth) and hands you a checklist for the parts a script cannot judge.

## When to use

- Authoring a new skill — run it before you consider the skill done.
- Reviewing or editing an existing `SKILL.md`.
- After any edit under a `skills/*/SKILL.md` path.

## Run the lint

```bash
python3 "${CLAUDE_PLUGIN_ROOT}"/skills/skill-smith/scripts/lint_skill.py <path-to-SKILL.md>
```

Pass a single `SKILL.md`, or a `skills/` directory to lint every skill under it. Exit 1 if any `FAIL` is present; `WARN` alone exits 0.

What it checks, deterministically:

- **name** — present, matches the parent directory, and uses the kebab charset (lowercase / digits / single hyphens, no leading, trailing, or doubled hyphen).
- **description** — present, ≤ 1024 chars, carries a `Use when` / `Invoke when` trigger clause, and reads third-person (a first-person `I …` is flagged).
- **body** — under the 500-line budget (a warning fires past 400).
- **reference depth** — every bundled file (`reference/…`, `scripts/…`) stays one level deep; a file nested deeper is flagged.

## The loop

Fix the reported `FAIL`s, re-run, repeat — cap at **3 rounds**. If findings remain after the third round, stop and hand the operator the residual list rather than churning. This is a goal-shaped loop: the exit criterion is `lint_skill.py` exiting 0, judged by the script, not by eye.

`WARN`s do not block, but read them — a first-person description or a body creeping toward the budget is usually worth fixing while you are here.

## Manual pass (what the script cannot judge)

Two things stay judgement calls. After the lint is clean, read the change against them:

- `reference/anatomy.md` — the canonical section order and the frontmatter contract. Diff a new skill's shape against it.
- `reference/failure-modes.md` — the six ways a skill rots (premature completion, duplication, sediment, sprawl, no-op, negation). Use it as a read-through checklist.

## Verification

Done = `lint_skill.py <path>` exits 0 **and** you have read the change against both reference checklists. The exit code is the gate; the checklists are the judgement.

## Dossier breadcrumb

In a repo with a live dossier ledger, finish by recording the verdict as one §S line through the dossier plugin's append tooling (the host session reminds when applicable; the first live row is the current dossier). No dossier → skip, no-op: this skill ships no hooks and no dossier dependency.

## Claim check

`claim-check <path>...` (also `skills/skill-smith/scripts/claim_check.py`) reads shipped prose for a narrower defect than structure: a sentence asserting that something of ours **blocks**, **enforces**, **gates**, **denies** or **prevents**, while naming nothing a reader could check.

| exit | line                     | meaning                                            |
| ---- | ------------------------ | -------------------------------------------------- |
| 0    | `CLAIMS: CLEAN <n> file(s)` | every claim names an exit code, a citation, or a label |
| 1    | `CLAIMS: FLAGGED <n>`    | `<n>` claims name none of those                    |
| 64   | —                        | no paths given, or a path that does not exist      |

A claim passes by naming an exit code, carrying a citation, or labelling itself advisory / model-judgment / opt-in / a nag. It decides **shape, never fact**: whether the exit code named is the real one is a reader's question. That is the mechanical half of a defect class this repo has shipped nine times (`RESEARCH.md` F19, F25).

Deliberately narrow. Matching the bare verbs flagged 113 lines here, nearly all nouns and adjectives — "doubt gate", "env-gated backstops", "the three write-time gates". A claim is now a backticked name followed by a finite verb, and a verb trailed by a past participle is read as a noun. That trades misses for false positives on purpose: a lint that flags honest prose gets deleted, and then it catches nothing.
