# claude-code-plugins

> Personal Claude Code plugins by @raisedadead — a two-plugin engineering toolbox.

An agent will happily report success it cannot demonstrate. These two plugins make "done" a checkable fact: a wave of work lives in one resumable ledger, and every gate ends in an exit code, a computed number, or a verdict line honestly labelled as a judgment.

| Plugin        | What it does                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **dossier**   | Phase-scoped workflow. One resumable `DOSSIER.md` drives a wave — tasks, bugs, invariants, cross-repo state — with in-session quality gates.              |
| **whetstone** | Per-task craft, each skill carrying a deterministic self-verify: red-green TDD, flaky-test audit, doubt review, merge-resolve, skill lint, column budget. |

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

Lifecycle verbs ride the wave rather than your memory: `/dossier:build` executes tasks, `/dossier:converge` runs the wave contract's done-when criteria ("are we done"), `/dossier:ship` writes the changelog, and `backprop` / `grill` / `verify` / `roll` / `migrate` fire at their moments. In a live wave the `UserPromptSubmit` hook prints the contract's state beside every prompt, naming `ds:converge` for the verdict.

### Wave contracts

A `§T` list says what to do and never what done means. A contract says it in commands: a `consumer`, and a `## done-when` table whose every row is a command with an expected result. `ds:converge` runs them and answers `MET` / `UNMET` / `PARSE` (exit 0/1/2); `ds:close` runs the same check before it archives.

The home is the repo's choice. `mkdir .dossier` opts into tracked contracts at `.dossier/<date>-<slug>.md` — citable as evidence, archived to `.dossier/_archive/` at close. Without that directory, `ds:new` writes `<wave-dir>/CONTRACT.md` instead and says what the weaker home costs: untracked wherever `.scratchpad/` is gitignored, and its criteria run as shell from a file no diff ever showed a reviewer. The plugin never creates `.dossier/` for you.

**A wave opened before contracts existed** keeps working — `ds:close` records `converge=absent` and archives it. The per-prompt line will read `no contract` until you write one: hand-author `.dossier/<date>-<slug>.md` (or `<wave-dir>/CONTRACT.md`) with a `consumer` row and a `done-when` table, and commit it — the budget count starts at that commit.

**whetstone — invoke directly, or let dossier compose them:**

| Command                       | Self-verify                                   |
| ----------------------------- | --------------------------------------------- |
| `/whetstone:tdd-cycle`        | red must fail, green and full suite must pass |
| `/whetstone:doubt-pass`       | 3-cycle cap; every finding classified         |
| `/whetstone:flaky-test-audit` | computed per-test rate                        |
| `/whetstone:merge-resolve`    | zero markers, pass-count at or above baseline |
| `/whetstone:skill-smith`      | frontmatter, line budget, reference depth     |
| `/whetstone:tiger-style`      | column budget computed from the staged diff   |

Two of them also ship as commands on `PATH` while whetstone is enabled, which is how dossier's composed routes reach them in any project: `tiger-check <repo>` (column budget of the lines a commit adds) and `claim-check <path>...` (prose asserting enforcement that names nothing checkable).

## Quickstart

```
/dossier:new auth-cache
/goal Keep running ds:build --auto until it prints DONE or PAUSE. Stop on PAUSE.
/dossier:status
/dossier:close --successor auth-rollout
```

`--auto` pauses on a real decision — blocked, ambiguous, destructive, push, retries, stale state, budget — and logs the reason. Pushing and closing stay yours: the loop stops at the last `x`-flip.

## Quality gates

In-session hooks. The three write-time gates scope themselves to projects that opted in — with no `.scratchpad/dossier/` directory they do nothing — and inside such a repo they cover ad-hoc edits too, not just work driven by a command. The fake-impl backstop is the exception on both counts: it runs at Stop rather than at write time, and it is keyed to its env var alone, so once you set that it applies in any repo. Gate strength matches signal strength — see [ARCHITECTURE.md](./ARCHITECTURE.md).

| Gate                   | Default | Toggle                               | What it catches                                                                                 |
| ---------------------- | ------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **marker guard**       | on      | `DOSSIER_MARKER_GUARD=off`           | Phase and audit-id markers leaking into source; bad state tokens in a ledger.                   |
| **invariant guard**    | on      | `DOSSIER_INVARIANT_GUARD=off`        | Edits matching a project-registered pattern. Fail-open until you register one.                  |
| **freshness verify**   | on      | `# verify-skip: <rule>` on the line  | Stale version, EOL, SHA and deprecated-model claims. Advisory; never blocks.                    |
| **fake-impl backstop** | off     | `DOSSIER_FAKEIMPL_CMD='<fast test>'` | On stop with a dirty tree — untracked files included — runs your test command; non-zero blocks. |

The invariant guard is where the ratchet lands: `ds:backprop` promotes a recurring bug class into a write-time block. Registry is a JSON list at `.scratchpad/dossier/.invariant-guards.json` — gitignored by design, so the suite leaves no artifact in a project that did not ask for one:

```json
[{ "id": "no-raw-sql", "pattern": "execute\\(f?\"SELECT", "message": "parameterize", "paths": ["**/*.py"] }]
```

Freshness authorities live in `hooks/verify_authorities.py` — adding a product is one data row, no code change.

Other knobs: `DOSSIER_FAKEIMPL_TIMEOUT` (120), `DOSSIER_LIVE_NUDGE` (1) and `DOSSIER_SESSION_TITLE` (0) are read by hook code. `DOSSIER_LIVE_NUDGE=0` silences the one-line `systemMessage` that `session-start.sh` raises when exactly one dossier is live; the model still receives the same fact through `additionalContext`. `DOSSIER_SESSION_TITLE=1` restores the session rename that shipped default-on until 2026-08-25 — read the CHANGELOG entry for that date before setting it, since no hook can see a sibling hook's title. `DS_HEALTH_CMD`, `DS_LIGHT_LOG` (5) and `DS_RECOVER_DAYS` (3) are honoured by the `status` skill, not by any hook — they steer a model-run step, so treat them as strong defaults rather than enforcement.

## Docs

| Doc                                          | What is in it                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)         | Priorities, tenets, enforcement map, testing standard, how this evolves, lineage |
| [RESEARCH.md](./RESEARCH.md)                 | Decisions with rejected alternatives, facts with a recheck trigger, open strides |
| [INSPIRATIONS.md](./INSPIRATIONS.md)         | Sources we borrow from, what we refused from each, and when we last looked       |
| [FORMAT.md](./plugins/dossier/FORMAT.md)     | Ledger encoding spec                                                             |
| [ADAPTERS.md](./plugins/dossier/ADAPTERS.md) | Host-environment detection and composition routes                                |

Migrating from the legacy `{PLAN,SPEC,AUDIT}.md` layout: `/dossier:migrate`, `--gc` to sweep orphans. Idempotent.

## License

ISC — see [LICENSE](./LICENSE).
