# claude-code-plugins

> Personal Claude Code plugins by @raisedadead — a two-plugin engineering toolbox.

An agent will happily report success it cannot demonstrate. These two plugins make "done" a checkable fact: a wave of work lives in one resumable ledger, and every gate ends in an exit code, a computed number, or a verdict line honestly labelled as a judgment.

| Plugin        | What it does                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **dossier**   | Phase-scoped workflow. One resumable `DOSSIER.md` drives a wave — tasks, bugs, invariants, cross-repo state — with in-session quality gates. |
| **whetstone** | Per-task craft, each skill carrying a deterministic self-verify: red-green TDD, flaky-test audit, doubt review, merge-resolve, skill lint.   |

dossier drives the wave; whetstone is the craft at each gate. Designed to be used together, independent by invariant — either works alone, and every composition route skips silently when its sibling is absent.

**Why it is built this way:** [ARCHITECTURE.md](./ARCHITECTURE.md) · **What we decided and rejected:** [RESEARCH.md](./RESEARCH.md)

## Install

```
/plugin marketplace add raisedadead/claude-code-plugins
/plugin install dossier@raisedadead-plugins
/plugin install whetstone@raisedadead-plugins
```

Needs `python3` 3.10+ on `PATH`; without it the python hooks no-op gracefully.

**Updating.** No `version` field — the commit SHA is the version ([D1](./RESEARCH.md)). Nothing signals a release to the plugin cache, so if an update seems not to take, clear the cache and reinstall.

## Commands

**dossier — the four you type:**

| Command                                    | What it does                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `/dossier:status` (or "ds", "what's next") | Session-open driver. Decision-first sit-rep. `--full` for tables, `--recover` after a crash. |
| `/dossier:new <slug>`                      | Start a wave. Prompts goal, scope, repos; pins current library versions.                     |
| `/dossier:check`                           | Read-only drift audit across every repo the wave touches.                                    |
| `/dossier:close`                           | `--complete` · `--successor <slug>` · `--abandon "<why>"`. Validate, close, archive.         |

Everything else fires automatically or is power-user: `build` (the TDD engine, `--auto` to loop hands-off), `backprop` (bug → invariant), `grill`, `ship`, `verify`, `roll`, `migrate`.

**whetstone — invoke directly, or let dossier compose them:**

| Command                       | Self-verify                                   |
| ----------------------------- | --------------------------------------------- |
| `/whetstone:tdd-cycle`        | red must fail, green and full suite must pass |
| `/whetstone:doubt-pass`       | 3-cycle cap; every finding classified         |
| `/whetstone:flaky-test-audit` | computed per-test rate                        |
| `/whetstone:merge-resolve`    | zero markers, pass-count at or above baseline |
| `/whetstone:skill-smith`      | frontmatter, line budget, reference depth     |

## Quickstart

```
/dossier:new auth-cache
/goal Keep running ds:build --auto until it prints DONE or PAUSE. Stop on PAUSE.
/dossier:status
/dossier:close --successor auth-rollout
```

`--auto` pauses only on a real decision — blocked, ambiguous, destructive, push, retries, stale state, budget — and logs the reason. Never auto-pushes, never auto-closes.

## Quality gates

In-session hooks, firing whenever the plugin is enabled, so they cover ad-hoc work too. Gate strength matches signal strength — see [ARCHITECTURE.md](./ARCHITECTURE.md).

| Gate                   | Default | Toggle                               | What it catches                                                                |
| ---------------------- | ------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| **slop**               | on      | `DOSSIER_SLOP_GATE=0`                | New `TODO` / `FIXME` / `XXX` / `HACK` markers and weak-secret literals.        |
| **marker guard**       | on      | `DOSSIER_MARKER_GUARD=off`           | Phase and audit-id markers leaking into source; bad state tokens in a ledger.  |
| **invariant guard**    | on      | `DOSSIER_INVARIANT_GUARD=off`        | Edits matching a project-registered pattern. Fail-open until you register one. |
| **freshness verify**   | on      | `# verify-skip: <rule>` on the line  | Stale version, EOL, SHA and deprecated-model claims. Advisory; never blocks.   |
| **fake-impl backstop** | off     | `DOSSIER_FAKEIMPL_CMD='<fast test>'` | On stop with a dirty tree, runs your test command; non-zero blocks.            |

The invariant guard is where the ratchet lands: `ds:backprop` promotes a recurring bug class into a write-time block. Registry is a JSON list at `.dossier/invariant-guards.json`, tracked so it survives a fresh clone:

```json
[{ "id": "no-raw-sql", "pattern": "execute\\(f?\"SELECT", "message": "parameterize", "paths": ["**/*.py"] }]
```

Freshness authorities live in `hooks/verify_authorities.py` — adding a product is one data row, no code change.

Other knobs: `DOSSIER_FAKEIMPL_TIMEOUT` (120), `DS_HEALTH_CMD`, `DS_LIGHT_LOG` (5), `DS_RECOVER_DAYS` (3).

## Drift gate

Deterministic, zero model turns. Wire it as a push or CI gate:

```bash
bash plugins/dossier/hooks/lib-drift-gate.sh .scratchpad
```

It exits 2 rather than passing when it cannot actually work — outside a git work tree, or when the index is gitignored, including by a global ignore file that makes it inert in every repo. A gitignored index makes `git diff --exit-code` succeed on a stale or absent file alike, which reads as a green gate that checked nothing.

## Docs

| Doc                                          | What is in it                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)         | Priorities, tenets, enforcement map, testing standard, how this evolves, lineage |
| [RESEARCH.md](./RESEARCH.md)                 | Decisions with rejected alternatives, facts with a recheck trigger, open strides |
| [FORMAT.md](./plugins/dossier/FORMAT.md)     | Ledger encoding spec                                                             |
| [ADAPTERS.md](./plugins/dossier/ADAPTERS.md) | Host-environment detection and composition routes                                |

Migrating from the legacy `{PLAN,SPEC,AUDIT}.md` layout: `/dossier:migrate`, `--gc` to sweep orphans. Idempotent.

## License

ISC — see [LICENSE](./LICENSE).
