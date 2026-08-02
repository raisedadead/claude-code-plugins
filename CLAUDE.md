# CLAUDE.md

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) before changing anything under `plugins/`. It carries the priorities, the tenets, the enforcement map and the testing standard. This file is only the handful of rails that are cheapest to violate.

## Before proposing a change

Check [`RESEARCH.md`](./RESEARCH.md) §D first. Several obvious-looking improvements here were already made, deliberately, in the other direction. A gap you spot may be a decision you cannot see the reason for.

The standing example: there is no `version` key in either `plugin.json`, and that is intentional — the commit SHA is the version. Do not add one. See D1.

Then read §O. Work worth doing here is already listed there, with the reason it has not been done yet — starting from §O beats inventing a task, and re-filing something already tracked is the most common way a session wastes its first hour. Count what is live with `grep -cE '^\| O[0-9]+ .*\| *(open|partial)' RESEARCH.md` rather than trusting a number written in prose; O-rows flip state as work lands.

## Priorities

Honesty > Recoverability > Leverage, in that order. Use it to settle conflicts rather than arguing them case by case.

Never claim enforcement that does not exist. An opt-in gate, a default-off gate and an advisory nag are not gates — describe them as what they are. A verdict parsed from a model is model-judgment, not computation.

`blocks`, `enforces` and `gates` are claims about runtime, and a doc cannot prove one. Run the thing and read the exit code before writing the verb. This rule was already on this page and the class still recurred three times in a single wave — a hook that nudges at exit 0 described as blocking, a correct `--cached` read justified by a false claim about what `git diff HEAD` does, and a regression test named for a case its own fixture ruled out. All three shipped. Each was found by a reviewer; none by a test.

The middle one is the shape to watch: **right behaviour, wrong stated reason.** Nothing it predicted ever failed, so no test could catch it, and it survived three reviews reading as authoritative. When you write down *why* a thing is done, that sentence needs a probe too. See F25.

## Evidence

`.scratchpad/` is gitignored. Never cite a path inside it as evidence in a tracked file — it is invisible to every other reader. Use a commit SHA, a tracked path, or a URL.

## Tests

Tests guard invariants that would silently break. They do not assert that documentation contains a phrase. Every gate wants two tests: one proving it fires, one proving it does not false-positive.

## Docs

`ARCHITECTURE.md` is what we believe now. `RESEARCH.md` is why: decisions with their rejected alternatives, facts with a recheck trigger, open strides. A decision row without a rejected alternative is a description — find the alternative or drop the row.

Neither is a history. When a position changes, rewrite the row; when a row stops changing what someone would do, delete it. Both files are read by sessions with no memory of the one that wrote them, and every line that no longer earns its place makes the lines that do harder to find. Git holds the route.
