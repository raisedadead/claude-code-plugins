# harness-alignment

| field       | value                                                                      |
| ----------- | -------------------------------------------------------------------------- |
| consumer    | a session running `ds:build` in any project with dossier installed         |
| reached-via | plugin cache → `hooks/hooks.json` (active on install) + `skills/` + `bin/` |
| budget      | 10 commits                                                                 |

## done-when

| id  | command                                                                              | expect            |
| --- | ------------------------------------------------------------------------------------ | ----------------- |
| 1   | `bash plugins/dossier/hooks/lib-converge.sh plugins/dossier/tests/fixtures/met.md`   | exit 0            |
| 2   | `bash plugins/dossier/hooks/lib-converge.sh plugins/dossier/tests/fixtures/unmet.md` | exit 1            |
| 3   | `python3 plugins/dossier/tests/test_converge.py`                                     | exit 0            |
| 4   | `python3 plugins/dossier/tests/test_convergence_state.py`                            | exit 0            |
| 5   | `printf '{"cwd":"/tmp"}' \| python3 plugins/dossier/hooks/convergence_state.py`      | stdout: (nothing) |
| 6   | `git ls-files plugins/whetstone/bin/tiger-check`                                     | stdout: bin       |
| 7   | `test -x plugins/whetstone/bin/tiger-check`                                          | exit 0            |
| 8   | `ruff check plugins`                                                                 | exit 0            |
| 9   | `shellcheck plugins/dossier/hooks/lib-converge.sh plugins/whetstone/bin/tiger-check` | exit 0            |
| 10  | `claude plugin validate plugins/dossier`                                             | exit 0            |
| 11  | `claude plugin validate plugins/whetstone`                                           | exit 0            |
| 12  | `python3 plugins/dossier/tests/test_convergence_state.py -k contractless`            | exit 0            |

## out-of-scope

- `Stop`-hook gating — no documented loop guard, and auto-active blocking is the failure mode being removed (F27)
- positive-form rewrite of the standing rails — real, tracked as O35, its own wave
- any change to `tiger-style` behaviour; only its unreachability is addressed here, via `bin/`
- retro-fitting contracts to closed waves

## scope change

2026-08-01, at 7 of 8 commits with the contract MET: a live wave carrying no contract got total silence from the hook, so the loop was inert exactly where it is most needed. Criterion 12 added and the budget raised 8 → 10 by explicit decision, rather than overrunning a ceiling quietly. A met contract grows by adding a criterion; it does not grow by ignoring the verdict.

## notes

A contract never names its own runner in `done-when` — that recurses. Criteria 1 and 2 exercise the runner against fixtures instead, one that must pass and one that must fail. The wave's own convergence is read by running the runner once, by hand, at T5.
