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
