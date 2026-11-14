# positive-rails

| field       | value                                                                   |
| ----------- | ----------------------------------------------------------------------- |
| consumer    | every session that reads a dossier skill body or the reviewer's mission |
| reached-via | shipped `SKILL.md` / agent bodies — read on every invocation, no opt-in |
| budget      | 8 commits                                                               |

## done-when

| id  | command                                                                                                                                                                                                                                                                                                        | expect    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | `test "$(grep -oiE '\bnever\b\|\bdo not\b\|\bdon.t\b\|\bmust not\b' plugins/dossier/skills/build/SKILL.md \| wc -l)" -le 13`                                                                                                                                                                                   | exit 0    |
| 2   | `test "$(grep -oiE '\bnever\b\|\bdo not\b\|\bdon.t\b\|\bmust not\b' plugins/dossier/agents/dossier-reviewer.md \| wc -l)" -le 9`                                                                                                                                                                               | exit 0    |
| 3   | `test "$(grep -oiE '\bnever\b\|\bdo not\b\|\bdon.t\b\|\bmust not\b' CLAUDE.md \| wc -l)" -le 1`                                                                                                                                                                                                                | exit 0    |
| 4   | `test "$(sed -n '/^## survivors/,/^## what changes/p' .dossier/2026-08-02-positive-rails.md \| grep -c -e '\| fact' -e '\| guarded' -e '\| hatch')" -eq "$(grep -oiE '\bnever\b\|\bdo not\b\|\bdon.t\b\|\bmust not\b' plugins/dossier/skills/build/SKILL.md plugins/dossier/agents/dossier-reviewer.md CLAUDE.md \| wc -l)"` | exit 0    |
| 5   | `bash plugins/whetstone/bin/claim-check $(git ls-files '*.md' \| grep -v tests/fixtures/)`                                                                                                                                                                                                                     | exit 0    |
| 6   | `plugins/whetstone/bin/lint-skill plugins/dossier/skills`                                                                                                                                                                                                                    | exit 0    |
| 7   | `node --test plugins/dossier/tests/test_verify.ts plugins/dossier/tests/test_skill_routing.ts plugins/dossier/tests/test_pause_class_parity.ts plugins/dossier/tests/test_manifest.ts` | exit 0    |
| 8   | `claude plugin validate plugins/dossier`                                                                                                                                                                                                                                                                       | exit 0    |
| 9   | `grep -c 'positive-rails ceiling' .github/workflows/ci.yml`                                                                                                                                                                                                                                                    | stdout: 1 |
| 10  | `actionlint .github/workflows/ci.yml`                                                                                                                                                                                                                                                                          | exit 0    |
| 11  | `for t in plugins/dossier/hooks/test_*.sh; do bash "$t" >/dev/null 2>&1 \|\| exit 1; done`                                                                                                                                                                                                                     | exit 0    |

## survivors

Every prohibition left in the two files, with the reason it stays. Criterion 4 holds this table and the files to the same count, so a prohibition that is added back without a row here fails the wave.

Three reasons qualify. **fact** — the sentence describes what the system does, and the negative is the accurate description; rewriting it positively would destroy information. **guarded** — the action is irreversible or a hook returns a non-zero exit on it, so F28's carve-out for hard guardrails applies, and the row is paired with a positive in the same sentence. **hatch** — a single named flag disarms a gate the surrounding step depends on, and the positive form has nothing to attach to: "retry the commit" does not tell a reader which one-word bypass to leave alone. The flag gets named and closed, after the positive.

| file     | phrase                                                   | why     |
| -------- | -------------------------------------------------------- | ------- |
| build    | the planned commits whose paths do not overlap           | fact    |
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

Criterion 11 was added after the first `MET 8/8` found the shell suites unrun. `test_pause_class_parity.sh` split `build/SKILL.md` on the literal string `MUST PAUSE (never auto-resolve):**`, which this wave rewrote, so the parity check went to a parse failure while every criterion still read MET. A contract that names one suite reports on one suite; the anchor is now the stable `MUST PAUSE` prefix and the criterion runs all of them.

Criteria 9 and 10 were added after the first `MET 8/8`. The wave's own D14 write-up said the ceiling was "enforced", and at that moment nothing ran it except a hand invocation of `ds:converge` — the F25 class, caught inside the wave that exists to reduce it. The choice was to weaken the word or build the thing; the ceiling is four greps, so it became a CI step and the word stayed.
