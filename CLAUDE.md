# CLAUDE.md

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) before changing anything under `plugins/`. It carries the priorities, the tenets, the enforcement map and the testing standard. This file is only the handful of rails that are cheapest to violate.

## Before proposing a change

Check [`RESEARCH.md`](./RESEARCH.md) §D first. Several obvious-looking improvements here were already made, deliberately, in the other direction. A gap you spot may be a decision you cannot see the reason for.

The standing example: the commit SHA is the version, so both `plugin.json` files ship without a `version` key and stay that way. See D1.

Then read §O. Work worth doing here is already listed there, with the reason it has not been done yet — starting from §O beats inventing a task, and re-filing something already tracked is the most common way a session wastes its first hour. Count what is live with `grep -cE '^\| O[0-9]+ .*\| *(open|partial)' RESEARCH.md` rather than trusting a number written in prose; O-rows flip state as work lands.

## Priorities

Honesty > Recoverability > Leverage, in that order. Use it to settle conflicts rather than arguing them case by case.

Describe every gate as the thing it actually is. An opt-in gate, a default-off gate and an advisory nag each get named as such; a verdict parsed from a model is model-judgment, and computation is what a script returns. `claim-check` exits 1 on a sentence that claims enforcement while naming neither an exit code nor one of those labels.

`blocks`, `enforces` and `gates` are claims about runtime, and a doc cannot prove one. Run the thing and read the exit code before writing the verb. This rule was already on this page when the class recurred three times in one wave; all three shipped, each found by a reviewer and none by a test.

The shape to watch is **right behaviour, wrong stated reason** — a correct `--cached` read justified by a false claim about what `git diff HEAD` does. Nothing the claim predicted ever failed, so no test could catch it, and it read as authoritative through three reviews. When you write down *why* a thing is done, that sentence needs a probe too. See F25.

## Evidence

`.scratchpad/` is gitignored and invisible to every other reader, so evidence in a tracked file cites a commit SHA, a tracked path, or a URL.

Probe the invocation the code makes, not the one the sentence resembles. A docstring here quoted `fatal: bad revision 'HEAD'`; a review called it invented, checked by running a bare `git diff HEAD`, got `fatal: ambiguous argument` and substituted that. Both strings are real — git says the first when a pathspec follows `--`, which is what the code does, and the second otherwise. The correction shipped the wrong one, and two later reviews confirmed it by re-running that same bare command. Independent confirmations are only independent if they probe independently; three checks agreeing after making the same substitution is one check. When a claim names a command, run that command with its arguments.

## Tests

Tests guard invariants that would silently break. They do not assert that documentation contains a phrase. Every gate wants two tests: one proving it fires, one proving it does not false-positive.

## Docs

`ARCHITECTURE.md` is what we believe now. `RESEARCH.md` is why: decisions with their rejected alternatives, facts with a recheck trigger, open strides. A decision row without a rejected alternative is a description — find the alternative or drop the row. `INSPIRATIONS.md` is who we borrowed from, what we refused from each of them, and the date we last looked; every release re-stamps it.

Neither is a history. When a position changes, rewrite the row; when a row stops changing what someone would do, delete it. Both files are read by sessions with no memory of the one that wrote them, and every line that no longer earns its place makes the lines that do harder to find. Git holds the route.
