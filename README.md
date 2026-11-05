# claude-code-plugins

> Two plugins for Claude Code and Pi for building software you can prove is done. Built and used daily by [@raisedadead](https://github.com/raisedadead); opinionated, and usable in any repo.

An agent will happily report success it cannot demonstrate. These two plugins make "done" a checkable fact: a wave of work lives in one resumable ledger, and every gate ends in an exit code, a computed number, or a verdict line honestly labelled as a judgment.

| Plugin        | What it does                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **dossier**   | Wave-scoped workflow. One resumable `DOSSIER.md` drives a wave — tasks, bugs, invariants, cross-repo state — with in-session quality gates.                                                                                                                                                                                                            |
| **whetstone** | Per-task craft — red-green TDD, flaky-test audit, diagnosis, doubt review, grilling, merge-resolve, research and HTML reports, skill lint, column budget. TDD, flaky-test audit, merge-resolve, skill lint, column budget and HTML report end in a script's exit code; doubt review, grilling, diagnosis and the research verdicts are model-judgment. |

dossier drives the wave; whetstone is the craft at each gate. Designed to be used together, independent by invariant — either works alone, and every composition route skips silently when its sibling is absent.

**Why it is built this way:** [ARCHITECTURE.md](./ARCHITECTURE.md) · **What we decided and rejected:** [RESEARCH.md](./RESEARCH.md)

## Install

### Claude Code

```
/plugin marketplace add raisedadead/claude-code-plugins
/plugin install dossier@raisedadead-plugins
/plugin install whetstone@raisedadead-plugins
```

Needs Claude Code 2.1.311 or later ([mods](https://code.claude.com/docs/en/plugins/mods/overview) arrived in 2.1.287; 2.1.311 fires `SubagentStop` once per subagent, which the verdict log needs), `git`, `bash` and Node.js 22.18+ on `PATH`. Neither plugin needs Python. whetstone ships commands in `bin/`, which limits it to Claude Code — claude.ai and Cowork do not install a plugin with a `bin/` directory.

### Pi

Needs Pi 1.5.0 or later, Node.js 22.19+, `git` and `bash`.

```sh
pi install git:github.com/raisedadead/claude-code-plugins
```

The repository includes generated Pi artifacts, so installation needs no build step or Rulesync. Pi loads the extensions and skills declared in the root `package.json`. Use `/skill:dossier-status`, `/skill:dossier-new`, `/skill:dossier-build`, `/skill:dossier-check` and `/skill:dossier-close`. Whetstone commands use `/skill:whetstone-<name>`. Skill names have plugin prefixes to avoid the two `grill` names colliding.

`/dossier-tasks` reads the ledger in either host. Pi shows a read-only task selector and status widget; it does not provide Claude's editable TaskList projection. For explicit `dossier-build --auto`, Pi uses the opt-in `dossier_auto` tool and native settlement continuation, not Claude's `/goal` evaluator. `/dossier-auto stop` or Escape stops it. A new session also stops it. The driver reads actual task rows, stops on PAUSE, limits tasks/continuations and retries no ledger progress only once. Decision classification remains model-judgment.

Pi supplies `dossier_delegate` and `whetstone_delegate` for fresh artifact-only missions. Named reviewers have no edit/write tools; Bash read-only is prompt-only, not sandboxed. A `general-purpose` builder needs explicit `write: true`; its native mutations retain dossier's guards when dossier is installed. Child sessions inherit the selected model and public provider auth, not the parent transcript, user extensions or project instructions. An unavailable model or credential fails explicitly; Claude model aliases and private transient credentials are not guessed. Read needed project rules into the mission.

`whetstone_verify_claims` replaces the Claude verification Workflow on Pi. It validates returned JSON and marks missing or malformed rulings `UNRULED`. Verdicts remain model-judgment. Web/advisor tools are optional; scouts can use read-only shell fetches and must report inaccessible sources. Pi does not add plugin bin directories to PATH; generated instructions resolve bundled executables by absolute path.

Each plugin can run without its sibling. Pi's [package resource filters](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md#select-package-resources) can select one plugin's extension and skills. For a standalone local artifact, build only that plugin as described under Contributing.

### Ledger location

dossier keeps its ledger in `.scratchpad/` at the repo root. Ignore it — globally, or per clone with `echo .scratchpad/ >> .git/info/exclude`. `/dossier:new` says so when it finds the directory unignored, and leaves the choice to you.

**Updating.** No `version` field, so Claude Code versions each plugin by this repo's commit SHA and `claude plugin update dossier@raisedadead-plugins` picks up every commit ([how versions are computed](https://code.claude.com/docs/en/plugins/loading#versions-and-updates); [D1](./RESEARCH.md)). There is no release/version bump; the plugin changelogs retain the earlier release history. Pi's Git installation also follows the selected Git ref; use `pi update` to update it.

## Commands

The tables below use Claude command syntax. On Pi, replace `/dossier:<name>` with `/skill:dossier-<name>` and `/whetstone:<name>` with `/skill:whetstone-<name>`.

**dossier — the four you type:**

| Command                                    | What it does                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `/dossier:status` (or "ds", "what's next") | Session-open driver. Decision-first sit-rep. `--full` for tables, `--recover` after a crash. |
| `/dossier:new "<goal>"`                    | Start a wave. Grills the goal first, then prompts scope and repos; pins library versions.    |
| `/dossier:check`                           | Read-only drift audit across every repo the wave touches.                                    |
| `/dossier:close`                           | `--complete` · `--successor <slug>` · `--abandon "<why>"`. Shows the plan, then closes.      |

On Claude Code, `/dossier-tasks` opens the task pane: the needs tree under the progress line. The status line shows that line too, and ends with `/dossier-tasks`. In the pane, `enter` on an open agent row puts `/dossier:build T<n>` in an empty prompt box; on any other row it shows the full task.

**When to start a wave:** the work spans more than one session, touches more than 5 files, or needs a step only you can do. Smaller work runs without a dossier.

Lifecycle verbs ride the wave rather than your memory: `/dossier:build` executes tasks (`--auto` loops hands-off), `/dossier:converge` runs the wave contract's done-when criteria ("are we done"), and `backprop` (bug → invariant), `grill` and `verify` fire at their moments. In a live wave the `UserPromptSubmit` hook prints the contract's state beside every prompt, naming `ds:converge` for the verdict.

### Wave contracts

A `§T` list says what to do and never what done means. A contract says it in commands: a `consumer`, and a `## done-when` table whose every row is a command with an expected result. `ds:converge` runs them and answers `MET` / `UNMET` / `PARSE` (exit 0/1/2); `ds:close` runs the same check before it archives.

The home is the repo's choice. `mkdir .dossier` opts into tracked contracts at `.dossier/<date>-<slug>.md` — citable as evidence, archived to `.dossier/_archive/` at close. Without that directory, `ds:new` writes `<wave-dir>/CONTRACT.md` instead and says what the weaker home costs: untracked wherever `.scratchpad/` is gitignored, and its criteria run as shell from a file no diff ever showed a reviewer. The plugin never creates `.dossier/` for you.

**A wave opened before contracts existed** keeps working — `ds:close` records `converge=absent` and archives it. The per-prompt line will read `no contract` until you write one: hand-author `.dossier/<date>-<slug>.md` (or `<wave-dir>/CONTRACT.md`) with a `consumer` row and a `done-when` table, and commit it — the budget count starts at that commit.

**whetstone — invoke directly, or let dossier compose them:**

| Command                       | Done when                                              |
| ----------------------------- | ------------------------------------------------------ |
| `/whetstone:tdd-cycle`        | red must fail, green and full suite must pass          |
| `/whetstone:doubt-pass`       | 3-cycle cap; every finding classified (model-judgment) |
| `/whetstone:flaky-test-audit` | computed per-test rate                                 |
| `/whetstone:merge-resolve`    | zero markers, pass-count at or above baseline          |
| `/whetstone:skill-smith`      | frontmatter, line budget, reference depth              |
| `/whetstone:tiger-style`      | column budget computed from the staged diff            |
| `/whetstone:html-report`      | exit 1 on a diagram that does not parse                |
| `/whetstone:research-report`  | every claim gets a verdict or `UNRULED`                |

The other whetstone skills are methods with no computed gate: `grill`, `diagnose`, `prototype`, `wizard`, `domain-modeling` and `codebase-design`. They are adapted from [mattpocock/skills](https://github.com/mattpocock/skills) under its MIT licence; [THIRD_PARTY_NOTICES.md](./plugins/whetstone/THIRD_PARTY_NOTICES.md) lists each file. whetstone also ships the `whetstone-scout` and `whetstone-grounder` agents and the `verify-claims` workflow.

On Claude Code, whetstone also ships its scripts as commands on the Bash tool's `PATH` while it is enabled, which is how dossier's composed routes reach them in any project: `run-slice`, `lint-skill`, `flake-runner`, `tiger-check <repo>` (column budget of the lines a commit adds), `claim-check <path>...` (prose asserting enforcement that names nothing checkable) and `html-report <report.md> <report.html>`.

## Quickstart

```
/dossier:new "Cache auth tokens in Valkey with a TTL clamp"
/goal Keep running ds:build --auto until it prints DONE or PAUSE. Stop on PAUSE.
/dossier:status
/dossier:close --successor auth-rollout
```

On Pi, the corresponding start/build sequence is `/skill:dossier-new "Cache auth tokens in Valkey with a TTL clamp"`, then `/skill:dossier-build --auto`. It uses the native driver described above; no `/goal` installation is needed.

`--auto` pauses on a real decision — blocked, ambiguous, destructive, push, retries, stale state, budget — and logs the reason. Pushing and closing stay yours: the loop stops at the last `x`-flip.

## Quality gates

In-session hooks. The four write-time gates — the header and marker guards (one row and one switch below), the invariant guard and freshness verify — scope themselves to projects that opted in — with no `.scratchpad/dossier/` directory they do nothing — and inside such a repo they cover ad-hoc edits too, not just work driven by a command. The fake-impl backstop is the exception on both counts: it runs at Stop rather than at write time, and it is keyed to its env var alone, so once you set that it applies in any repo. Gate strength matches signal strength — see [ARCHITECTURE.md](./ARCHITECTURE.md).

| Gate                   | Default | Toggle                               | What it catches                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **marker guard**       | on      | `DOSSIER_MARKER_GUARD=off`           | Phase and audit-id markers leaking into source; bad state tokens in a ledger.                                                                                                                                                                                                                                                                                        |
| **invariant guard**    | on      | `DOSSIER_INVARIANT_GUARD=off`        | Edits matching a project-registered pattern. Fail-open with no registry, an unreadable payload, a spawn error, or any `ds invariant-check` result but exit 1 with output.                                                                                                                                                                                            |
| **freshness verify**   | on      | `# verify-skip: <rule>` on the line  | Stale version, EOL, SHA and deprecated-model claims. Advisory; never blocks.                                                                                                                                                                                                                                                                                         |
| **fake-impl backstop** | off     | `DOSSIER_FAKEIMPL_CMD='<fast test>'` | On stop with a dirty tree — untracked files included — runs your test command; a non-zero exit or a `DOSSIER_FAKEIMPL_TIMEOUT` timeout blocks, and a run past the hook's 180-second limit, a `git status` error or a spawn error lets the stop through. Its first block in each turn asks for the whole reply again, because focus mode shows only the last message. |
| **claim gate**         | on      | disable whetstone                    | whetstone. A final reply that claims enforcement with no exit code, citation or honesty label. Sends the flagged lines back as context once per turn and asks for the whole reply again with the fix, because focus mode shows only the last message; never blocks.                                                                                                  |

The invariant guard is where the ratchet lands: for a recurring bug class with a regex shape, `ds:backprop` offers to register the pattern, and the guard then denies a matching edit (PreToolUse `deny`; the offer is model-judgment). Registry is a JSON list at `.scratchpad/dossier/.invariant-guards.json` — gitignored by design, so the suite leaves no artifact in a project that did not ask for one:

```json
[{ "id": "no-raw-sql", "pattern": "execute\\(f?\"SELECT", "message": "parameterize", "paths": ["**/*.py"] }]
```

On Pi, native edit/write callbacks return `block: true` for a denial. Header/marker and invariant policy share the Claude implementation. Freshness and bug/invariant reminders are appended to the tool result for the model. Final-reply feedback uses `agent_before_settle` with bounded continuation; it is not an independent evaluator. Native write guards do not inspect Bash writes in either host.

In a dossier repo, when a doubter or reviewer subagent stops (`whetstone-doubter`, `dossier-reviewer`, or an agent named `reviewer`), its first verdict line is appended to `.scratchpad/dossier/.verdicts.jsonl`. It is a log, not a gate: it never blocks.

On Pi, verdict logging observes successful plugin delegate results; it does not observe unrelated third-party delegation tools. The task view stays read-only, while the existing `cli/ds` commands own ledger mutations.

Freshness authorities live in `plugins/dossier/engine/verify-authorities.ts` — adding a product is one data row, no code change.

Other knobs: `DOSSIER_FAKEIMPL_TIMEOUT` (120), `DOSSIER_LIVE_NUDGE` (1) and `DOSSIER_SESSION_TITLE` (0) are read by hook code. `DOSSIER_LIVE_NUDGE=0` silences the one-line toast that the session start raises when exactly one dossier is live; the model still receives the same fact through `additionalContext`. `DOSSIER_SESSION_TITLE=1` restores the session rename that shipped default-on until 2026-08-25 — read the CHANGELOG entry for that date before setting it, since no hook can see a sibling hook's title. `DS_HEALTH_CMD`, `DS_LIGHT_LOG` (5) and `DS_RECOVER_DAYS` (3) are honoured by the `status` skill, not by any hook — they steer a model-run step, so treat them as strong defaults rather than enforcement.

## Docs

| Doc                                          | What is in it                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)         | Priorities, tenets, enforcement map, testing standard, how this evolves, lineage |
| [RESEARCH.md](./RESEARCH.md)                 | Decisions with rejected alternatives, facts with a recheck trigger, open strides |
| [INSPIRATIONS.md](./INSPIRATIONS.md)         | Sources we borrow from, what we refused from each, and when we last looked       |
| [FORMAT.md](./plugins/dossier/FORMAT.md)     | Ledger encoding spec                                                             |
| [ADAPTERS.md](./plugins/dossier/ADAPTERS.md) | Host-environment detection and composition routes                                |

Skill routing has a live-model eval suite: `claude plugin eval plugins/dossier --ablation none` ([evals/README.md](./plugins/dossier/evals/README.md)).

## Contributing

Edit shared content under `plugins/`, native Pi adapters under `plugins/*/pi/`, and common Pi code under `hosts/pi/`. Keep Claude metadata and install paths unchanged. `pi/` is generated and committed; edit source, then rebuild it:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm build:check
pnpm test
pnpm check
bash tools/ci.sh all
```

`build:check` exits 1 for missing, extra, changed or differently executable output files and writes nothing. The builder preflights metadata and resources, refuses symlink inputs and unsafe/unowned output, and stages replacement before changing existing output. It assumes trusted local source and no concurrent writer to the same output. It never installs into a harness or changes consumer settings.

Build a standalone Pi artifact with `node tools/build/build.ts --plugin dossier --out /tmp/dossier-pi`, or substitute `whetstone`. Choose a new or builder-owned output directory. For an assembled Claude marketplace, use `--target claude --out /tmp/claude-plugins`; source manifests and registration modules are preserved. `node tools/build/build.ts --help` lists the options.

Tests exercise real Pi loading and provider loops with a deterministic local provider, including fresh delegation, inherited public auth, mutation denial and once-only reply continuation. They call no remote model. Claude mods retain their native `claude plugin test` suite. Interactive rendering, provider-specific remote behavior and private rig integration are not established by these fixtures.

Run `pnpm install` and `git config core.hooksPath .githooks` once per clone or worktree. `tools/ci.sh` holds every check. Each CI job runs its part (`bash tools/ci.sh dossier`, `tools`, `whetstone`), and the pre-push hook runs `bash tools/ci.sh all`. The hook ignores `CI_STEPS`; set `PRE_PUSH_STEPS` to narrow it, and the hook prints the list it runs. `CI_LIST=1 bash tools/ci.sh all` prints every step name and runs none; the hook ignores `CI_LIST` too. It needs bash 5 or later. A local run uses the versions that `.github/workflows/ci.yml` and `requirements-dev.txt` pin: Node through `fnm`, Python and ruff through `uv`, Claude Code through `npx`, and it exits 1 when one of them is missing. After `pnpm install` it runs up to one step per core at once (`CI_JOBS=<n>` sets the number), prints `ok` or `FAIL` and the time for each step with the output of a failed one, and ends with `CI: ok <n> steps in <t>s` or `CI: FAIL <k> of <n> in <t>s — <steps>`. The hook reads the working tree, so it exits 1 on a dirty tree or a branch that is not checked out. A tag push skips the checks.

## License

ISC — see [LICENSE](./LICENSE).
