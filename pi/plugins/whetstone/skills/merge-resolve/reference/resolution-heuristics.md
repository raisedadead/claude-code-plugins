# Resolution heuristics

How to pick, by the kind of file in conflict. The rule underneath all of them: understand what each side was *trying to do* before you keep either.

## Generated files and lockfiles

`package-lock.json`, `pnpm-lock.yaml`, `Cargo.lock`, `go.sum`, `poetry.lock`, built assets, snapshots — **regenerate rather than hand-merge**. Take either side (or `--theirs`), then rebuild from source:

| File              | Regenerate with |
| ----------------- | --------------- |
| package-lock.json | `npm install`   |
| pnpm-lock.yaml    | `pnpm install`  |
| Cargo.lock        | `cargo build`   |
| go.sum            | `go mod tidy`   |
| poetry.lock       | `poetry lock`   |

A hand-merged lockfile that resolves textually but is internally inconsistent is worse than an obvious conflict — it fails later, far from here.

## Prose and docs

Markdown, comments, changelogs — read **both** intents and keep both where they are additive (two people documented two different things). A dropped sentence in docs is a silent regression, so each side gets read before either is kept.

## Source logic

The dangerous case. Before choosing:

1. Read `ours` and `theirs` as two diffs against the merge base — what did each change and *why*.
1. If both changed the same behaviour, the correct result is often **neither side verbatim** but a combination that honours both intents.
1. Re-read the surrounding function after resolving — a hunk that merges cleanly in isolation can still break an invariant three lines away.

Read a source hunk before `--ours` / `--theirs` decides it. "It compiles" is not "it's correct" — the pass-count baseline in `verify_clean.sh` is what guards that.

## Rebase note

In a rebase, `ours` and `theirs` are **swapped** relative to a merge (you're replaying your commits onto their base), so `--ours` is the upstream side. Read the labels.
