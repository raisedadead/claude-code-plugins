# SKILL.md anatomy

The shape a well-formed skill converges on. `lint_skill.py` fails the frontmatter contract and the 500-line body budget at exit 1; reference depth is a `WARN` that exits 0, and the section order below is read by no check at all. Everything on this page is the structure to diff a new skill against by hand.

## Frontmatter

```yaml
---
name: kebab-case-name        # matches the parent directory exactly
description: <what it does> + Use when <trigger phrases>.
---
```

- `name` — lowercase letters, digits, single hyphens. Matches the dir.
- `description` — the router reads this and nothing else to decide whether to fire the skill. Lead with what it does, then a `Use when …` clause listing the concrete trigger phrases. Third person. Keep distinct from every other skill's phrases — a shared phrase routes ambiguously.

## Body section order

A reliable default, adapted from Anthropic's skill-anatomy guidance:

1. **Overview** — one or two sentences: what this does and why.
1. **When to use** — the situations that should trigger it, in prose.
1. **Core process** — the numbered steps, the load-bearing section.
1. **Techniques** — deeper method notes, optional.
1. **Common rationalizations** — a table pairing each skip-temptation with its one-line rebuttal (the anti-rationalization pattern).
1. **Red flags** — signs the process is going wrong.
1. **Verification** — the checkable exit criterion. Never "looks right"; a command, an exit code, a count, a screenshot.

Not every skill needs all seven. Every skill needs an Overview, a Core process, and a Verification. No script reads this order — a `SKILL.md` with the sections reversed and no Core process at all lints clean at exit 0, so the whole section is yours to hold.

## Progressive disclosure

Keep `SKILL.md` under ~500 lines. Push detail one level deep into siblings — `reference/<topic>.md` for prose, `scripts/<name>` for executables — reached only when that branch fires. One level, never two: `reference/foo.md`, not `reference/foo/bar.md`. A deeper file prints `WARN … reference nested too deep` and the run still exits 0, so this rule is an author's, not the script's.

## Leading words

Recruit a pretrained concept once and reuse it as shorthand ("red", "seam", "tracer bullet", "doubt theater") instead of re-explaining the idea each time it recurs. Front-load the skill's leading word in the description.
