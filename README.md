# claude-code-plugins

> Personal Claude Code plugins by @raisedadead — a two-plugin engineering toolbox.

Marketplace: `raisedadead-plugins`. Two plugins, designed as a pair, each fully standalone.

| Plugin                          | What it does                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [dossier](plugins/dossier/)     | Phase-scoped engineering workflow: one resumable `DOSSIER.md` ledger drives a wave of work — tasks, bugs, invariants, cross-repo state, evidence log — with in-session quality gates. |
| [whetstone](plugins/whetstone/) | Per-task engineering craft with deterministic self-verify: red-green TDD proof, flaky-test audit, adversarial doubt review, merge-resolve, skill lint.                                |

dossier is the ledger that drives the wave; whetstone is the craft it composes at each gate (doubt at design, real red/green proof at build, merge-resolve on conflicts, skill-smith on skill authoring). Either works alone — every composition route detects and skips silently when the sibling is absent.

## What you get

**dossier**

- **Resumable phase workflow** — one `DOSSIER.md` per wave under `.scratchpad/dossier/<date>-<slug>/`; survives crashes, compaction, and session handoff. A decision-first dashboard is injected on session start.
- **TDD covenant** — `/dossier:build` drives a task red → green with real exit-code proof, commits, and flips the ledger row with the commit hash.
- **Drift detection** — `/dossier:check` diffs the ledger against code, git state, and meta-invariants.
- **Bug → invariant protocol** — `/dossier:backprop` root-causes a bug and can mint a regression invariant enforced at write time.
- **Cross-repo state** — one ledger tracks every repo a wave touches (ahead-count, tag, push state).
- **In-session quality gates** — slop, fake-implementation backstop, dossier-marker discipline, freshness verify (see [Quality gates](#quality-gates)).
- **Light path + recovery** — `/dossier:status` gives a git + health sit-rep even with no dossier in the repo; `--recover` rebuilds context after a crash or compaction.

**whetstone**

- **Red-green TDD** (`tdd-cycle`) — one vertical slice, seam agreed before the first test.
- **Adversarial doubt** (`doubt-pass`) — stress-test a plan before any code exists.
- **Flaky-test audit** (`flaky-test-audit`) — per-test flakiness rate, quarantine the nondeterministic ones.
- **Merge-resolve** (`merge-resolve`) — hunk-by-hunk conflict resolution with a mandatory post-verify.
- **Skill lint** (`skill-smith`) — structure-check a `SKILL.md` (frontmatter, budget, triggers).

## Commands you'll actually type

Invoke by slash command, or just say the shorthand (e.g. "ds" / "what's next").

**dossier — the handful that matter:**

| Command                                                                  | What it does                                                                                                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `/dossier:status` (say "ds" / "what's next")                             | Session-open driver. Decision-first sit-rep + TaskList hydrate. `--full` for tables; `--recover` to rebuild context after a crash. |
| `/dossier:new <slug>`                                                    | Start a wave. Prompts goal / scope / repos, pins current lib versions.                                                             |
| `/dossier:build <T-id>` · `--next` · `--auto`                            | The TDD engine: run a task red → green, commit, flip the row. `--auto` loops hands-off, pausing only on a real decision.           |
| `/dossier:backprop <B-id>` · `"<bug>"`                                   | Bug → root cause → optional regression invariant → fix.                                                                            |
| `/dossier:check`                                                         | Read-only drift audit across every repo the wave touches.                                                                          |
| `/dossier:ship`                                                          | Derive a `CHANGELOG` section (+ advisory version bump) from the ledger before closing.                                             |
| `/dossier:close --complete` · `--successor <slug>` · `--abandon "<why>"` | Validate, write the closeout, archive the wave. Atomic.                                                                            |
| `/dossier:roll {dump\|restore\|list}`                                    | Persist the TaskList across sessions (auto-dumps on compact and exit; `restore` in a fresh session).                               |

**whetstone — per-task craft (invoke directly, or let dossier compose them):**

| Command                       | What it does                                                |
| ----------------------------- | ----------------------------------------------------------- |
| `/whetstone:tdd-cycle`        | One red-green-refactor slice, seam agreed first.            |
| `/whetstone:doubt-pass`       | Adversarial review of a plan before any code.               |
| `/whetstone:flaky-test-audit` | Per-test flakiness rate + quarantine.                       |
| `/whetstone:merge-resolve`    | Resolve merge / rebase conflicts hunk-by-hunk, then verify. |
| `/whetstone:skill-smith`      | Lint a `SKILL.md`.                                          |

## Quality gates

Deterministic, in-session dossier hooks. They fire whenever the plugin is enabled — no ceremony required — so they cover ad-hoc work, not just active waves.

| Gate                                  | Default | Toggle                                   | What it catches                                                                                                |
| ------------------------------------- | ------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **slop** (PreToolUse)                 | **on**  | `DOSSIER_SLOP_GATE=0` disables           | Denies new `TODO`/`FIXME`/`XXX`/`HACK` markers and hardcoded weak-secret literals in edits (markdown skipped). |
| **fake-impl backstop** (Stop)         | off     | set `DOSSIER_FAKEIMPL_CMD='<fast test>'` | On Stop with a dirty tree, runs your test command; a non-zero exit blocks finishing.                           |
| **dossier-marker guard** (PreToolUse) | on      | `DOSSIER_MARKER_GUARD=off`               | Keeps `§`-cite / audit-id markers out of source; enforces the ledger state-machine.                            |
| **freshness verify** (PreToolUse)     | on      | `# verify-skip: <rule>` on a line        | Advisory check on version / EOL / SHA claims in new content, cross-checked against primary sources.            |

## Install

In Claude Code:

```
/plugin marketplace add raisedadead/claude-code-plugins
/plugin install dossier@raisedadead-plugins
/plugin install whetstone@raisedadead-plugins
```

Both recommended (the pair composes); each is fully standalone. Requires `python3` ≥ 3.10 on `PATH` for the dossier python hooks — without it those hooks no-op gracefully (bash helpers and the dashboard still work).

## Configuration

Environment variables (set in your shell or Claude Code `settings.json` `env`):

| Var                        | Default | Effect                                                             |
| -------------------------- | ------- | ------------------------------------------------------------------ |
| `DOSSIER_SLOP_GATE`        | on      | `0` / `false` / `off` disables the slop gate                       |
| `DOSSIER_FAKEIMPL_CMD`     | unset   | test/smoke cmd run at Stop on a dirty tree; a non-zero exit blocks |
| `DOSSIER_FAKEIMPL_TIMEOUT` | `120`   | seconds before the fake-impl cmd is killed (then blocks)           |
| `DS_HEALTH_CMD`            | unset   | health cmd folded into the `/dossier:status` light-path sit-rep    |
| `DS_LIGHT_LOG`             | `5`     | commits shown in the light-path sit-rep                            |
| `DS_RECOVER_DAYS`          | `3`     | lookback window for `/dossier:status --recover`                    |
| `DOSSIER_MARKER_GUARD`     | on      | `off` disables the marker guard's advisory nudge                   |
| `DOSSIER_INVARIANT_GUARD`  | on      | `off` disables project-registered invariant enforcement            |

## Docs

- **dossier** — [README](plugins/dossier/) · [FORMAT.md](plugins/dossier/FORMAT.md) (ledger format) · [ADAPTERS.md](plugins/dossier/ADAPTERS.md) (composition routes)
- **whetstone** — [README](plugins/whetstone/)

## License

ISC — see [LICENSE](./LICENSE).
