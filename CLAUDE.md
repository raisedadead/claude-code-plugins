# CLAUDE.md

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) before changing anything under `plugins/`. It carries the priorities, the tenets, the enforcement map and the testing standard. This file is only the handful of rails that are cheapest to violate.

## Before proposing a change

Check [`RESEARCH.md`](./RESEARCH.md) §D first. Several obvious-looking improvements here were already made, deliberately, in the other direction. A gap you spot may be a decision you cannot see the reason for.

The standing example: there is no `version` key in either `plugin.json`, and that is intentional — the commit SHA is the version. Do not add one. See D1.

## Priorities

Honesty > Recoverability > Leverage, in that order. Use it to settle conflicts rather than arguing them case by case.

Never claim enforcement that does not exist. An opt-in gate, a default-off gate and an advisory nag are not gates — describe them as what they are. A verdict parsed from a model is model-judgment, not computation.

## Evidence

`.scratchpad/` is gitignored. Never cite a path inside it as evidence in a tracked file — it is invisible to every other reader. Use a commit SHA, a tracked path, or a URL.

## Tests

Tests guard invariants that would silently break. They do not assert that documentation contains a phrase. Every gate wants two tests: one proving it fires, one proving it does not false-positive.

## Docs

`ARCHITECTURE.md` is what we believe now. `RESEARCH.md` is append-only: decisions with their rejected alternatives, facts with a recheck trigger, open strides. A decision row without a rejected alternative is a description — find the alternative or drop the row.
