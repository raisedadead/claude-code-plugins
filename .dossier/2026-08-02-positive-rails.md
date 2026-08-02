# positive-rails

| field       | value                                                                   |
| ----------- | ----------------------------------------------------------------------- |
| consumer    | every session that reads a dossier skill body or the reviewer's mission |
| reached-via | shipped `SKILL.md` / agent bodies — read on every invocation, no opt-in |
| budget      | 8 commits                                                               |

## done-when

| id  | command                                                                                                                                                                                                                                                                                                        | expect    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | `test "$(grep -oiE '\bnever\b\|\bdo not\b\|\bdon.t\b\|\bmust not\b' plugins/dossier/skills/build/SKILL.md \| wc -l)" -le 12`                                                                                                                                                                                   | exit 0    |
| 2   | `test "$(grep -oiE '\bnever\b\|\bdo not\b\|\bdon.t\b\|\bmust not\b' plugins/dossier/agents/dossier-reviewer.md \| wc -l)" -le 9`                                                                                                                                                                               | exit 0    |
| 3   | `test "$(grep -oiE '\bnever\b\|\bdo not\b\|\bdon.t\b\|\bmust not\b' CLAUDE.md \| wc -l)" -le 1`                                                                                                                                                                                                                | exit 0    |
| 4   | `test "$(sed -n '/^## survivors/,/^## what changes/p' .dossier/2026-08-02-positive-rails.md \| grep -c -e '\| fact' -e '\| guarded')" -eq "$(grep -oiE '\bnever\b\|\bdo not\b\|\bdon.t\b\|\bmust not\b' plugins/dossier/skills/build/SKILL.md plugins/dossier/agents/dossier-reviewer.md CLAUDE.md \| wc -l)"` | exit 0    |
| 5   | `bash plugins/whetstone/bin/claim-check $(git ls-files '*.md' \| grep -v tests/fixtures/)`                                                                                                                                                                                                                     | exit 0    |
| 6   | `python3 plugins/whetstone/skills/skill-smith/scripts/lint_skill.py plugins/dossier/skills`                                                                                                                                                                                                                    | exit 0    |
| 7   | `python3 plugins/dossier/hooks/test_python.py`                                                                                                                                                                                                                                                                 | exit 0    |
| 8   | `claude plugin validate plugins/dossier`                                                                                                                                                                                                                                                                       | exit 0    |
| 9   | `grep -c 'positive-rails ceiling' .github/workflows/ci.yml`                                                                                                                                                                                                                                                    | stdout: 1 |
| 10  | `actionlint .github/workflows/ci.yml`                                                                                                                                                                                                                                                                          | exit 0    |

## survivors

Every prohibition left in the three files, with the reason it stays. Criterion 4 holds this table and the files to the same count, so a prohibition that is added back without a row here fails the wave.

Two reasons qualify. **fact** — the sentence describes what the system does, and the negative is the accurate description; rewriting it positively would destroy information. **guarded** — the action is irreversible or a hook returns a non-zero exit on it, so F28's carve-out for hard guardrails applies, and the row is paired with a positive in the same sentence.

| file     | phrase                                                   | why     |
| -------- | -------------------------------------------------------- | ------- |
| build    | `--doubt` alone never activates the gate                 | fact    |
| build    | `Warn:` / `Nit:` never block the commit                  | fact    |
| build    | measure after `git add`, never before                    | guarded |
| build    | a check that never ran                                   | fact    |
| build    | `lib-x-refresh.sh` never touches the notes cell          | fact    |
| build    | §X was never refreshed                                   | fact    |
| build    | a gate the operator never turns on (D7's failure mode)   | fact    |
| build    | a `~` row never enters the ds:ship pipeline              | fact    |
| build    | `push` PAUSE — never auto-push                           | guarded |
| build    | exit 2 is advisory and never pauses                      | fact    |
| build    | rails: push stays the operator's, never automatic        | guarded |
| build    | under `--auto` this never self-triggers                  | fact    |
| reviewer | never the parent reasoning transcript                    | fact    |
| reviewer | an artifact, never a conversation                        | fact    |
| reviewer | `Nit:` — optional polish. Never blocks.                  | fact    |
| reviewer | its patterns never match a bare `// Phase N`             | fact    |
| reviewer | smells are never a hard block                            | fact    |
| reviewer | the states that must never occur                         | fact    |
| reviewer | code-shape findings never block on their own             | fact    |
| reviewer | never computed                                           | fact    |
| claude   | tests do not assert that documentation contains a phrase | fact    |

## what changes

F28: prohibition makes the forbidden behaviour more available, because the negation is a weak modifier the strongly-activated concept can overrun. The fix upstream names is to prompt the positive and reserve prohibition for hard guardrails, always paired with a positive.

Baseline occurrences of `never` / `do not` / `don't` / `must not`: build 36, reviewer 14, `CLAUDE.md` 4 — 54 across the three files with the most execution pressure in the suite. The wave rewrites the directed ones as the action to take, and keeps only the rows in the survivors table.

## out-of-scope

- **descriptions of system behaviour.** A sentence saying a hook exits 0 on a phase marker is a fact, and the negative is what makes it accurate. The rewrite target is instructions addressed to an agent.
- **the other 19 skill bodies** — ~106 further occurrences. Follow-up row, not this wave; three files is what fits 8 commits without churn.
- **`~/.claude/CLAUDE.md`** — the operator's, chezmoi-managed, and outside this repo.
- **whether the rewrite works.** O35's measure is whether the F19/F25 class recurs afterwards, which is a later observation. No criterion here claims it.

## notes

Criterion 4 is the exhaustiveness half. A count alone can be met by deleting a sentence that carried a real constraint; pairing the count with a table that must list every survivor means each one was looked at and argued for.

Criteria 9 and 10 were added after the first `MET 8/8`. The wave's own D14 write-up said the ceiling was "enforced", and at that moment nothing ran it except a hand invocation of `ds:converge` — the F25 class, caught inside the wave that exists to reduce it. The choice was to weaken the word or build the thing; the ceiling is four greps, so it became a CI step and the word stayed.
