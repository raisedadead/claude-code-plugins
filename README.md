# claude-code-plugins

> Two Claude Code plugins for building software you can prove is done. Built and used daily by [@raisedadead](https://github.com/raisedadead); opinionated.

An agent will happily report success it cannot demonstrate. These two plugins make "done" a checkable fact: a piece of work lives in one plan file that a session can pick up again, and every step ends in an exit code, a computed number, or a verdict line honestly labelled as a judgment.

| Plugin        | What it does                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **dossier**   | One plan file per piece of work, and a `ds` command for every step that gives the same result each time: the lint, the baseline, the checks, the commits, the hand-off. A model does the judgement. |
| **whetstone** | Per-task craft — red-green TDD, a flaky-test rate, diagnosis, doubt review, grilling, research and HTML reports, skill lint, column budget. TDD, skill lint, column budget and HTML report end in a script's exit code; the flaky-test rate is computed and printed, and sets no exit code; doubt review, grilling, diagnosis and the research verdicts are model-judgment. |

whetstone works alone, in any repo. dossier is built for the author's own rig: it names whetstone's agents and the rig's tools, and does not fall back when one is missing ([ADAPTERS.md](./plugins/dossier/ADAPTERS.md)).

**Why it is built this way:** [ARCHITECTURE.md](./ARCHITECTURE.md) · **What we decided and rejected:** [RESEARCH.md](./RESEARCH.md)

## Install

```
/plugin marketplace add raisedadead/claude-code-plugins
/plugin install dossier@raisedadead-plugins
/plugin install whetstone@raisedadead-plugins
```

Needs Claude Code 2.1.311 or later ([mods](https://code.claude.com/docs/en/plugins/mods/overview) arrived in 2.1.287; CI runs 2.1.311), `git`, `bash` and Node.js 22.18+ on `PATH`. Neither plugin needs Python. whetstone ships commands in `bin/`, which limits it to Claude Code — claude.ai and Cowork do not install a plugin with a `bin/` directory.

dossier keeps its ledger in `.scratchpad/` at the repo root. Ignore it — globally, or per clone with `echo .scratchpad/ >> .git/info/exclude`.

**Updating.** No `version` field, so Claude Code versions each plugin by this repo's commit SHA and `claude plugin update dossier@raisedadead-plugins` picks up every commit ([how versions are computed](https://code.claude.com/docs/en/plugins/loading#versions-and-updates); [D1](./RESEARCH.md)). No release is cut now (D46); each plugin's `CHANGELOG.md` holds the history up to its last tag.

## Commands

**dossier — one skill per stage:**

| Command             | What it does                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `/dossier:plan`     | Opens a dossier and writes its plan with you: goal, scope, decisions, rows, checks, commits. One fresh agent checks the plan, and the author rules on each finding. |
| `/dossier:build`    | Builds the rows of a checked plan, one row at a time, each in its planned commit. `--auto` goes on until a row waits on you.          |
| `/dossier:ship`     | One review of the branch, the fixup commits folded into the planned commits, the landing, then the CI watch.                         |
| `/dossier:close`    | Closes the dossier, moves the rows that wait to the register, and archives the folder.                                               |
| `/dossier:backprop` | Turns a bug into a row and a check that fails until the bug is fixed.                                                                 |
| `/dossier:verify`   | Checks a freshness claim — a version, an EOL date, a SHA — against its primary source. Runs anywhere, with or without a dossier.     |

`ds help` lists the commands under the skills. [FORMAT.md](./plugins/dossier/FORMAT.md) has the file shapes. At session start, `ds triage --start` shows the deferred rows that are due, the rows out of shape and the dossiers whose plan changed after its check.

**When to start a dossier:** the work needs more than one commit, spans more than one session, or has a step only you can do. Smaller work runs without one.

**whetstone — invoke directly, or let dossier compose them:**

| Command                       | Done when                                     |
| ----------------------------- | --------------------------------------------- |
| `/whetstone:tdd-cycle`        | red must fail, green and full suite must pass |
| `/whetstone:doubt-pass`       | 3-cycle cap; every finding classified (model-judgment) |
| `/whetstone:skill-smith`      | frontmatter, line budget, reference depth     |
| `/whetstone:tiger-style`      | column budget computed from the staged diff   |
| `/whetstone:html-report`      | exit 1 on a diagram that does not parse       |
| `/whetstone:research-report`  | every claim gets a verdict or `UNRULED`       |

The other whetstone skills are methods with no computed gate: `grill`, `diagnose`, `prototype`, `domain-modeling` and `codebase-design`. They are adapted from [mattpocock/skills](https://github.com/mattpocock/skills) under its MIT licence; [THIRD_PARTY_NOTICES.md](./plugins/whetstone/THIRD_PARTY_NOTICES.md) lists each file. whetstone also ships the `verify-claims` workflow and the `gatherer`, `plan-checker`, `reviewer`, `security-reviewer`, `whetstone-scout`, `whetstone-grounder` and `whetstone-doubter` agents. The operator's rig holds each of them to a read-only shell and scratch-only writes. The verdicts are model-judgment.

whetstone also ships its scripts as commands on the Bash tool's `PATH` while it is enabled: `run-slice`, `lint-skill`, `flake-runner <N> <results.json> <cmd...>` (reruns a test and prints its flakiness rate), `tiger-check <repo>` (column budget of the lines a commit adds), `claim-check <path>...` (prose asserting enforcement that names nothing checkable) and `html-report <report.md> <report.html>`.

## Quickstart

```
/dossier:plan auth-token-cache "Cache auth tokens in Valkey with a TTL clamp"
/dossier:build --auto
/dossier:ship
/dossier:close "auth tokens cached with a clamped TTL"
```

`--auto` stops when a row waits on you. The prompt of the landing is yours.

## Hooks

Each plugin ships one hook, and neither stops a tool call or a turn.

| Hook                     | Plugin    | What it does                                                                                                                      |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| session-start triage     | dossier   | Adds the output of `ds triage --start` as context at start, after `/clear` and on resume; nothing when no row is due. It skips a compaction. |
| skill lint reminder      | whetstone | After an Edit or Write of `skills/<name>/SKILL.md`, adds the `lint-skill` findings for that file as context.                       |

Under managed settings, `managed-mcp.json` or a Team or Enterprise `/login`, Claude Code's built-in guard `sec-default` does not run a user-installed mod's `classic.*` hooks, so neither hook runs. `/plugin` shows a note on the plugin. See RESEARCH.md F46.

The checks that stop a step are `ds` commands, which exit 1 when the step before them has not passed; [ARCHITECTURE.md](./ARCHITECTURE.md) has the verdict grammar.

## Docs

| Doc                                          | What is in it                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)         | The tenet, priorities, enforcement map, testing standard, how this evolves, lineage |
| [RESEARCH.md](./RESEARCH.md)                 | Decisions with rejected alternatives, facts with a recheck trigger, open strides |
| [INSPIRATIONS.md](./INSPIRATIONS.md)         | Sources we borrow from, what we refused from each, and when we last looked       |
| [FORMAT.md](./plugins/dossier/FORMAT.md)     | The dossier file shapes                                                          |
| [ADAPTERS.md](./plugins/dossier/ADAPTERS.md) | What dossier expects from the author's rig                                       |

## Contributing

Run `pnpm install` and `git config core.hooksPath .githooks` once per clone or worktree. `tools/ci.sh` holds every check. Each CI job runs its part (`bash tools/ci.sh dossier`, `tools`, `whetstone`), and the pre-push hook runs `bash tools/ci.sh all`. The hook ignores `CI_STEPS`; set `PRE_PUSH_STEPS` to narrow it, and the hook prints the list it runs. `CI_LIST=1 bash tools/ci.sh all` prints every step name and runs none; the hook ignores `CI_LIST` too. It needs bash 5 or later. A local run uses the versions that `.github/workflows/ci.yml` and `requirements-dev.txt` pin: Node through `fnm`, bun at the version `ci.yml` pins, Python and ruff through `uv`, Claude Code through `npx`, and it exits 1 when one of them is missing. The plugin suites run on `bun test` with a coverage floor. The `node-tests` step runs the same files on Node under Vitest; it runs in CI, and locally only with `CI_STEPS=node-tests`. After `pnpm install` it runs up to one step per core at once (`CI_JOBS=<n>` sets the number), prints `ok` or `FAIL` and the time for each step with the output of a failed one, and ends with `CI: ok <n> steps in <t>s` or `CI: FAIL <k> of <n> in <t>s — <steps>`. The hook reads the working tree, so it exits 1 on a dirty tree or a branch that is not checked out. A tag push skips the checks.

## License

ISC — see [LICENSE](./LICENSE).
