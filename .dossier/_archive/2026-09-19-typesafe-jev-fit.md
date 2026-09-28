# typesafe-jev-fit

| field       | value                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| consumer    | the operator, who runs the probe by hand before they change a skill description; and any dossier installer who holds a TypeSafe API key |
| reached-via | `python3 plugins/dossier/evals/separability_probe.py`, run by hand. Never CI, never a hook, never a gate.                               |
| budget      | 8 commits                                                                                                                               |

## done-when

| id  | command                                                                                                                                                                                                                                                                                                      | expect |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1   | `python3 plugins/dossier/evals/test_separability_probe.py`                                                                                                                                                                                                                                                   | exit 0 |
| 2   | `env -u TYPESAFE_API_KEY python3 plugins/dossier/evals/separability_probe.py --skills plugins/dossier/skills`                                                                                                                                                                                                | exit 0 |
| 3   | `python3 plugins/dossier/evals/separability_probe.py --dry-run --skills plugins/dossier/skills \| python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["model"]; assert any(q["type"]=="choice" for q in d["questions"].values()); assert any(q["type"]=="noul" for q in d["questions"].values())'` | exit 0 |
| 4   | `test "$(grep -c separability_probe .github/workflows/ci.yml)" -ge 1`                                                                                                                                                                                                                                        | exit 0 |
| 5   | `test "$(grep -cE '^. D28 ' RESEARCH.md)" -eq 1`                                                                                                                                                                                                                                                             | exit 0 |
| 6   | `bash plugins/whetstone/bin/claim-check $(git ls-files '*.md' \| grep -v tests/fixtures/)`                                                                                                                                                                                                                   | exit 0 |
| 7   | `ruff check plugins`                                                                                                                                                                                                                                                                                         | exit 0 |

Criterion 2 is the one that decides adoption. The probe must exit 0 and name the skip when no key is exported, because every consumer of this plugin is in that state.

Criterion 5 forces the wave to end in a decision with its rejected alternative, not in a script nobody chose to use.

Criteria 4 and 5 wrap their count in `test ... -eq`, and criterion 5 matches the leading pipe with `.`. Both shapes are deliberate. `converge.py` unescapes a markdown `\|` to a real pipe before the shell sees it, so a `\|` inside a regex changes what the regex means. `_met` also compares a `stdout:` expectation by substring, so `stdout: 1` matches an output of `114`. An exit code dodges both. Probed 2026-09-19 against the first draft of this table, which reported MET on a count of 114.

## what it measures

Whether two skill descriptions are semantically distinct enough for a router to separate them. One `Choice` over the catalog per test prompt says which skill wins. One `Noul` says whether any skill fits at all. The probe reports the probability spread. It sets no threshold and blocks nothing.

`plugins/dossier/hooks/eval_skill_routing.py` already collides on exact quoted-phrase equality. The collision this probe targets is semantic: four skills claim the test-first trigger in four different phrasings, and the string lint reports clean.

## out-of-scope

- The keep-versus-distil decision for the operator's third-party skills. That is T2 of `~/.dotfiles/.scratchpad/dossier/2026-09-16-skill-routing-distillation/DOSSIER.md`, and it stays there.
- The live-model routing eval, `claude plugin eval plugins/dossier --ablation none` (`plugins/dossier/evals/README.md`). That measures Claude Code's own router. This probe measures Jev. Jev confident does not mean Claude confident.
- O32, cross-file trigger-phrase disjointness in `lint_skill.py`. That stays deterministic.
- Any replacement of a `code` gate with a Jev call. A calibrated probability is still `model-judgment`.

## notes

A criterion that reads "the operator understands the model" was dropped. It cannot be written as a command. The research artifact at `.scratchpad/research/2026-09-19-typesafe-ai.md` carries that content and is cited by §C instead.
