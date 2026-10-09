# claim-check

| field       | value                                                                      |
| ----------- | -------------------------------------------------------------------------- |
| consumer    | anyone shipping docs alongside hooks or scripts, in this repo or their own |
| reached-via | `whetstone/bin/claim-check` on PATH while whetstone is enabled, plus CI    |
| budget      | 10 commits                                                                 |

## done-when

| id  | command                                                           | expect    |
| --- | ----------------------------------------------------------------- | --------- |
| 1   | `python3 plugins/whetstone/tests/test_claim_check.py`             | exit 0    |
| 2   | `bash plugins/whetstone/bin/claim-check plugins/whetstone/tests/fixtures/claims-false.md`    | exit 1    |
| 3   | `bash plugins/whetstone/bin/claim-check plugins/whetstone/tests/fixtures/claims-true.md`     | exit 0    |
| 4   | `bash plugins/whetstone/bin/claim-check plugins/whetstone/tests/fixtures/claims-labelled.md` | exit 0    |
| 5   | `bash plugins/whetstone/bin/claim-check $(git ls-files '*.md' \| grep -v tests/fixtures/)`                              | exit 0    |
| 6   | `test -x plugins/whetstone/bin/claim-check`                       | exit 0    |
| 7   | `grep -c claim-check .github/workflows/ci.yml`                    | stdout: 1 |
| 8   | `ruff check plugins`                                              | exit 0    |
| 9   | `shellcheck plugins/whetstone/bin/claim-check`                    | exit 0    |
| 10  | `claude plugin validate plugins/whetstone`                        | exit 0    |

## what it checks

A sentence in a shipped doc using `blocks`, `enforces`, `gates`, `denies` or `prevents` about our own tooling is a claim about runtime. It passes only if the same sentence names something checkable — a hook wired in a `hooks.json`, a script that exists, or an exit code — or if it is explicitly labelled as advisory, model-judgment, opt-in or a nag.

Criterion 5 is the one that matters. Running it over every tracked markdown file must exit 0, which means every such claim in this repo is either backed or labelled. F19 catalogued six false ones; F25 found three more in a single wave and named the escalation this wave answers.

## out-of-scope

- judging whether a claim is _true_, only whether it names something checkable. A lint decides shape, never fact.
- prose outside the five verbs — "right behaviour, wrong stated reason" in general is not lintable and stays reviewer work (F25)
- the positive-form rewrite of the rails (O35), which is its own wave and will churn the same files

## notes

Expect criterion 5 to fail for most of the wave. The lint is the cheap half; making the repo's own docs pass it is the work, and every fix is a claim we were shipping unbacked.
