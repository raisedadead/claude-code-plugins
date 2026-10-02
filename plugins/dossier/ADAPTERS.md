# ADAPTERS.md — optional integrations

Integrations dossier uses when the session has them. The plugin works without any of them: each one is detected at its point of use, and an absent one is a silent fallback.

Detection needs no probe. The session already lists its tools, skills and agent types; a skill reads that list where it branches.

Decision ids (D2, D4, D18) refer to [RESEARCH.md](https://github.com/raisedadead/claude-code-plugins/blob/main/RESEARCH.md).

| Adapter            | Present when                                                 | Used by                                                  | If absent                 |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------------------- | ------------------------- |
| `context7` MCP     | a tool ending `__resolve-library-id` / `__query-docs`        | `ds:build` step 5.5 — ground the current API of a pin    | WebFetch the official docs |
| `Workflow` tool    | `Workflow` in the tool list (native harness tool)            | `ds:check` step 2 — scout fan-out when §X > 2 repos      | parallel `Agent` spawns   |
| `whetstone` plugin | `whetstone:whetstone-doubter` in the agent list; `bin/` on `PATH` | `ds:build` doubt, TDD, lint, tiger, conflict routes; `ds:backprop` flake triage | graceful skip, §S-noted   |

Personal tooling — output compressors, memory servers, alternative edit tools — belongs in the operator's own harness, not here. The same test D18 applies to gates applies to adapters: this file carries what helps anyone who installs the plugin, not one operator's preferences.

## §context7 — current library API docs

MCP server serving version-current API docs. The middle segment of the tool name is whatever the operator registered the server as, so match the `__resolve-library-id` / `__query-docs` suffix.

`ds:build` PIN CHECK (step 5.5) grounds the API shape of a pinned lib — `resolve-library-id{libraryName:<pkg>}` then `query-docs{libraryId, query:<specific API question>}` — so the model writes the current API rather than a remembered one. Nothing this plugin ships reads a context7 key; whether the server is registered is the operator's choice.

## §workflow — deterministic scout fan-out

Scope: research fan-out only — `ds:check` step 2 (§V/§T/§X scan). The `ds:build` loop stays on `/goal`: Workflows run in the background with no mid-run steer, which breaks commit-per-flip and §S resume.

- targets ≤ 2, or no `Workflow` tool → parallel `Agent` spawns (`subagent_type: dossier:dossier-scout`).
- targets > 2 → one Workflow run. A skill that instructs the call is the operator opt-in the Workflow tool contract asks for.

Script template — the skill prepares `args.missions` = `[{repo, mission}]`:

```js
export const meta = {name: 'ds-scout-fanout', description: 'parallel dossier-scout missions', phases: [{title: 'Scan'}]}
const ROW = {type: 'object', properties: {
  repo: {type: 'string'}, kind: {type: 'string'}, id: {type: 'string'},
  status: {type: 'string'}, detail: {type: 'string'}},
  required: ['repo', 'kind', 'id', 'status']}
const FINDINGS = {type: 'object', properties: {findings: {type: 'array', items: ROW}}, required: ['findings']}
const width = budget.total ? Math.max(1, Math.floor(budget.remaining() / 80_000)) : args.missions.length
if (width < args.missions.length) log(`budget cap: ${width}/${args.missions.length} repos — dropped: ${args.missions.slice(width).map(m => m.repo).join(' ')}`)
const out = await pipeline(args.missions.slice(0, width), m =>
  agent(m.mission, {label: `scout:${m.repo}`, phase: 'Scan', agentType: 'dossier:dossier-scout', schema: FINDINGS}))
return out.filter(Boolean).flatMap(o => o.findings)
```

What it buys over raw spawns: schema-validated rows, no barrier idle, a budget-gated width that logs what it dropped, and `resumeFromRunId` so a crashed sweep returns finished scouts from cache.

## §whetstone — the sibling plugin

whetstone ships the craft dossier composes at its gates. Neither plugin declares the other a dependency; every route below skips when whetstone is absent (D2).

**Agent route (`whetstone:whetstone-doubter`, `ds:build` step 5.6).** Present iff the session's agent list names it. If an `Agent` call is made anyway and the type is absent, the harness returns a recoverable tool error naming the available agents — on that error append §S `doubt=skipped-absent` and continue. Verdict line `DOUBT: FAILURES | NO FAILURE FOUND` — model-judgment, parsed.

**Skill route (`whetstone:merge-resolve`, `ds:build` step 6).** Present iff the available-skills list names it. Plain `git merge` conflicts only; `rebase` / `cherry-pick` conflicts stay operator-driven, since their `--continue` commits escape `ds:build`'s task-scoped commit discipline. Absent → inline resolution, §S-noted.

**Script routes.** Claude Code puts an enabled plugin's `bin/` on the Bash tool's `PATH`, and `${CLAUDE_PLUGIN_ROOT}` names only the running plugin's own root, so `bin/` is the one supported way for dossier to reach a whetstone script ([plugins reference](https://code.claude.com/docs/en/plugins-reference)). Each route calls a bare command name; not on `PATH` means whetstone is absent.

| command        | route                                                         | not on `PATH`                  |
| -------------- | ------------------------------------------------------------- | ------------------------------ |
| `run-slice`    | `ds:build` step 6 — red, green and full-suite exit codes      | raw test commands              |
| `lint-skill`   | `ds:build` step 6 — lint a touched `SKILL.md` before commit   | §S `skill-lint=skipped-absent` |
| `tiger-check`  | `ds:build` step 7 — column budget of the staged lines         | §S `tiger=skipped-absent`      |
| `flake-runner` | `ds:backprop` step 4.5 — rerun a failing test, compute a rate | §S `flake-triage=skipped`      |

`tiger-check` exits `0` clean · `1` a limit the repo declared was exceeded (blocking) · `2` the built-in 100-column fallback was exceeded (advisory) · `64` not a git work tree. Require a `TIGER:` line in stdout before trusting the number: a missing script makes `node` exit 1, which aliases BLOCK, and a missing `node` makes the wrapper exit 127.

The checker's limit knob is `WHETSTONE_TIGER_COLS`, deliberately not a `DOSSIER_` name: it configures whetstone and has to work for someone who never installed dossier.

Discovering a sibling by globbing the plugin cache was rejected (D4): extraction mtimes are not version signals, stale cache dirs survive reinstalls, and a name collision across marketplaces can select a script of the wrong provenance.

## Non-goals

- Every adapter is optional. The plugin installs and works on a vanilla Claude Code with no extras.
- `plugin.json` declares no dependency on any of them.
- No adapter version check. Best-effort use.
