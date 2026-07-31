# claude-code-plugins

> Personal Claude Code plugins by @raisedadead — a two-plugin engineering toolbox.

An agent will happily report success it cannot demonstrate. These two plugins make "done" a checkable fact: a wave of work lives in one resumable ledger, and every gate along the way ends in an exit code, a computed number, or a verdict line that is honestly labelled as a judgment.

| Plugin        | What it does                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **dossier**   | Phase-scoped workflow. One resumable `DOSSIER.md` drives a wave — tasks, bugs, invariants, cross-repo state, evidence log — with in-session quality gates. |
| **whetstone** | Per-task craft with deterministic self-verify: red-green TDD proof, flaky-test audit, adversarial doubt review, merge-resolve, skill lint.                 |

dossier drives the wave; whetstone is the craft applied at each gate. They are designed to be used together and are independent by invariant — either works alone, and every composition route detects its sibling and skips silently when absent.

**Why it is built this way:** [ARCHITECTURE.md](./ARCHITECTURE.md). **What we decided and rejected:** [RESEARCH.md](./RESEARCH.md).

## Install

```
/plugin marketplace add raisedadead/claude-code-plugins
/plugin install dossier@raisedadead-plugins
/plugin install whetstone@raisedadead-plugins
```

Needs `python3` 3.10 or newer on `PATH` for the dossier python hooks; without it those hooks no-op gracefully and the rest still works.

**Updating.** These plugins carry no `version` field — the commit SHA is the version ([RESEARCH.md](./RESEARCH.md) D1). Nothing signals a new release to the plugin cache, so if an update does not appear to take effect, clear the plugin cache and reinstall.

## Commands

Invoke by slash command, or say the shorthand.

**dossier — the four you actually type:**

| Command                                    | What it does                                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `/dossier:status` (or "ds", "what's next") | Session-open driver. Decision-first sit-rep, TaskList hydrate. `--full` for tables, `--recover` after a crash. |
| `/dossier:new <slug>`                      | Start a wave. Prompts for goal, scope and repos; pins current library versions.                                |
| `/dossier:check`                           | Read-only drift audit across every repo the wave touches.                                                      |
| `/dossier:close`                           | `--complete`, `--successor <slug>` or `--abandon "<why>"`. Validate, write the closeout, archive. Atomic.      |

**Autonomy** — drive the ledger hands-off, steering by watching the TaskList:

```
/goal Keep running ds:build --auto until it prints DONE or PAUSE. Stop on PAUSE.
```

Pauses only on a real decision — blocked, ambiguous, destructive, push, retries, stale state, budget — with the reason logged. Never auto-pushes, never auto-closes.

**Auto or power-user, rarely typed directly:**

| Command                                       | When                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `/dossier:build <T-id>` · `--next` · `--auto` | The TDD engine. Run one task red to green, commit, flip the row.                        |
| `/dossier:backprop <B-id>` · `"<bug>"`        | Bug to root cause to optional regression invariant. Auto-fires from `build` on failure. |
| `/dossier:grill`                              | Define-phase interview that feeds the goal and constraints before tasks exist.          |
| `/dossier:ship`                               | Derive a changelog section and an advisory version bump from the ledger.                |
| `/dossier:verify [<topic>]`                   | Ad-hoc fact-check. Also fires as a hook on every write.                                 |
| `/dossier:roll {dump\|restore\|list}`         | TaskList persistence across sessions. Auto-dumps on compact and exit.                   |
| `/dossier:migrate`                            | One-time conversion from the legacy four-file layout.                                   |

**whetstone — invoke directly, or let dossier compose them:**

| Command                       | What it does                                     | Self-verify                                      |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| `/whetstone:tdd-cycle`        | One red-green-refactor slice, seam agreed first. | red must fail, green and full suite must pass    |
| `/whetstone:doubt-pass`       | Adversarial review of a plan before any code.    | 3-cycle cap; every finding classified            |
| `/whetstone:flaky-test-audit` | Per-test flakiness rate, then quarantine.        | computed rate, by the number                     |
| `/whetstone:merge-resolve`    | Resolve conflicts hunk-by-hunk, then verify.     | zero markers and pass-count at or above baseline |
| `/whetstone:skill-smith`      | Lint a `SKILL.md`.                               | frontmatter, line budget, reference depth        |

## Quickstart

```
/dossier:new auth-cache          # scaffold, pin versions, fill goal and scope
/dossier:build --next            # or drive it hands-off with /goal, above
/dossier:status                  # anytime: what is the next decision?
/dossier:check                   # audit
/dossier:close --successor auth-rollout
```

## Quality gates

Deterministic, in-session hooks. They fire whenever the plugin is enabled, so they cover ad-hoc work, not just active waves. Gate strength matches signal strength — see [ARCHITECTURE.md](./ARCHITECTURE.md).

| Gate                   | Default | Toggle                               | What it catches                                                                                               |
| ---------------------- | ------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **slop**               | on      | `DOSSIER_SLOP_GATE=0`                | Blocks new `TODO` / `FIXME` / `XXX` / `HACK` markers and hardcoded weak-secret literals. Markdown skipped.    |
| **marker guard**       | on      | `DOSSIER_MARKER_GUARD=off`           | Keeps phase and audit-id markers out of source; blocks a non-canonical state token in a ledger file.          |
| **invariant guard**    | on      | `DOSSIER_INVARIANT_GUARD=off`        | Blocks edits matching a project-registered forbidden pattern. Fail-open: does nothing until you register one. |
| **freshness verify**   | on      | `# verify-skip: <rule>` on the line  | Advisory only. Checks version, EOL and SHA claims against primary sources. Never blocks.                      |
| **fake-impl backstop** | off     | `DOSSIER_FAKEIMPL_CMD='<fast test>'` | On stop with a dirty tree, runs your test command; non-zero blocks finishing.                                 |

The invariant guard is where the ratchet lands: `ds:backprop` can promote a recurring bug class into a write-time block, so the class stops recurring instead of being re-flagged at the next audit. The registry is a JSON list at `.dossier/invariant-guards.json` — tracked, so the guard survives a fresh clone. The legacy `.scratchpad/dossier/.invariant-guards.json` path is still read:

```json
[{ "id": "no-raw-sql", "pattern": "execute\\(f?\"SELECT", "message": "parameterize", "paths": ["**/*.py"] }]
```

`paths` are fnmatch globs scoping the guard; omit it to cover every non-ledger source file. With no registry, a malformed one, or a bad regex, the hook exits 0 and the write proceeds — installing the plugin changes nothing until you register something.

## Freshness verify

Empirical defense against knowledge-cutoff hallucination. A hook scans written content against an authority registry and nags when a claim does not match the primary source. **Never blocks** — offline, 5xx and cache-poison all degrade to a silent skip. Adding a product is pure data: append a row to `hooks/verify_authorities.py`, no code change.

| Class                     | Authority                                | Caught                                                  |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------- |
| Language and OS EOL       | endoflife.date                           | `Node 18`, `Python 3.8`, `Ubuntu 18.04`, `Go 1.18`      |
| Docker image EOL          | endoflife.date via image alias           | `FROM node:18-alpine`, `image: postgres:11`             |
| Unpinned GitHub Action    | GitHub refs API                          | `uses: actions/checkout@v4` resolved to a SHA           |
| Deprecated k8s apiVersion | k8s deprecation guide                    | `apiVersion: extensions/v1beta1`                        |
| Outdated package          | npm, PyPI, crates.io, RubyGems, Go proxy | `"react": "16.0.0"`, `django==2.2.0`, `serde = "0.9.0"` |
| Deprecated AI model       | provider docs                            | `gpt-3.5-turbo-0613`, `claude-2.1`, `gemini-1.0-pro`    |

## Configuration

| Variable                   | Default | Effect                                                    |
| -------------------------- | ------- | --------------------------------------------------------- |
| `DOSSIER_SLOP_GATE`        | on      | `0`, `false` or `off` disables the slop gate              |
| `DOSSIER_MARKER_GUARD`     | on      | `off` disables the marker guard's advisory nudge          |
| `DOSSIER_INVARIANT_GUARD`  | on      | `off` disables registered-invariant enforcement           |
| `DOSSIER_FAKEIMPL_CMD`     | unset   | test command run at stop on a dirty tree; non-zero blocks |
| `DOSSIER_FAKEIMPL_TIMEOUT` | `120`   | seconds before that command is killed, then blocks        |
| `DS_HEALTH_CMD`            | unset   | health command folded into the light-path sit-rep         |
| `DS_LIGHT_LOG`             | `5`     | commits shown in the light-path sit-rep                   |
| `DS_RECOVER_DAYS`          | `3`     | lookback window for `--recover`                           |

## Drift gate

`lib-ds-check.sh` is the deterministic core of `ds:check` — zero model turns. It regenerates the index from a ledger walk, then exits non-zero naming any dossier whose header, location and closure disagree. Wire it as a push gate without paying for the full skill:

```bash
bash plugins/dossier/hooks/lib-ds-check.sh .scratchpad
git diff --exit-code .scratchpad/INDEX.md
```

The regen is idempotent, so any diff means the committed index was stale.

## Migration

Coming from the legacy `{PLAN,SPEC,AUDIT}.md` plus `closeout/` layout:

```
/dossier:migrate        # scouts each repo, proposes a DOSSIER.md, you approve
/dossier:migrate --gc   # cleanup pass for legacy orphans
```

Idempotent; a per-repo marker prevents repeats.

## Docs

| Doc                                          | What is in it                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)         | Priorities, tenets, enforcement map, testing standard, how this evolves, lineage       |
| [RESEARCH.md](./RESEARCH.md)                 | Decisions with their rejected alternatives, facts with a recheck trigger, open strides |
| [FORMAT.md](./plugins/dossier/FORMAT.md)     | Ledger encoding spec                                                                   |
| [ADAPTERS.md](./plugins/dossier/ADAPTERS.md) | Host-environment detection and composition routes                                      |

## License

ISC — see [LICENSE](./LICENSE).
