# ADAPTERS.md — Host-env detection + routing

Optional integrations dossier auto-detects. Plugin works without any of them. Detect-then-route, graceful fallback.

Skills + the `dossier-scout` agent reference this file. Detection runs once per skill invocation, cached for the duration.

______________________________________________________________________

## Adapter matrix

| Adapter            | Detection                                                        | If present                                                    | If absent              |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------- |
| `rtk` CLI          | `command -v rtk`                                                 | see §rtk below                                                | emit raw commands      |
| `cavemem` MCP      | tool namespace has `mcp__cavemem__search`                        | augment §S tail with cross-session observations               | §S only                |
| `caveman` skill    | available-skills list has `caveman:caveman` or `ck:caveman`      | encourage caveman encoding in writes                          | plain markdown         |
| `fastedit` MCP     | tool namespace has `mcp__fastedit__fast_edit`                    | surgical edits to SOURCE task files; read via fast_search     | Edit tool              |
| `context7` MCP     | tool namespace has `mcp__claude_ai_Context7__resolve-library-id` | ground CURRENT library API docs before coding (see §context7) | WebFetch official docs |
| `Workflow` tool    | tool namespace has `Workflow` (native harness)                   | scout fan-out when targets > 2 (see §workflow)                | parallel Agent spawns  |
| `whetstone` plugin | available agent types list has `whetstone:whetstone-doubter`     | doubt gate at design-class `ds:build` (see §whetstone)        | graceful skip          |

## §rtk — token-compression wrapper

User-installed CLI that wraps verbose Bash output (git log, find, kubectl, etc.) for token savings.

Two install modes:

1. **Hooked**: user has PreToolUse Bash rewrite hook. Plugin emits raw commands. Hook rewrites transparently. No plugin action needed.
1. **Unhooked**: `rtk` binary on PATH but no hook wired. Plugin manually pipes through `| rtk err` or prefixes `rtk summary` for verbose ops.

Detection sequence inside skill:

```bash
HAS_RTK=0
HAS_RTK_HOOK=0
if command -v rtk &>/dev/null; then
  HAS_RTK=1
  # Heuristic: check if recent Bash output shows <rtk_summary> markers.
  # If not, assume unhooked. Conservative: prefix when emitting verbose ops.
fi
```

Routing examples:

```bash
# Verbose: git log spanning >100 commits
# Hooked: git log --oneline -200
# Unhooked w/ rtk: rtk summary git log --oneline -200

# Verbose: find walk
# Hooked: find . -name '*.md' -not -path '*/node_modules/*'
# Unhooked w/ rtk: rtk summary find . -name '*.md' -not -path '*/node_modules/*'

# Always raw (trivial output):
# git status -sb
# git rev-list --count origin..HEAD
```

If `HAS_RTK=0`: emit raw. Accept verbose output.

## §cavemem — cross-session memory

MCP server providing `search` / `timeline` / `get_observations`. Stores cross-turn memory.

Detection: presence of `mcp__cavemem__*` in available tools.

If present:

- `ds:status` queries `mcp__cavemem__timeline` for recent dossier-related observations, augments §S tail.
- `ds:backprop` queries `mcp__cavemem__search` for prior occurrences of the bug class.

If absent: skip silently. No fallback needed.

## §caveman — encoding skill

Other plugin or skill that compresses output. Detection: available-skills list contains `caveman:caveman` or `ck:caveman`.

If present: writers (ds:new, ds:build, ds:backprop) prefer caveman encoding in §S entries + DOSSIER.md prose. Pipe-tables already caveman-style per FORMAT.md.

If absent: plain markdown. Pipe-tables still apply.

## §fastedit — surgical AST edits (SOURCE files only)

MCP server providing tree-sitter AST splice edits. Detection: presence of `mcp__fastedit__fast_edit`.

Scope: SOURCE task files in supported languages (`.py .js .ts .tsx .rs .go .java .c .cpp .rb .swift .kt .cs .php .ex` …). `ds:build` step 6 (WORK) may use it for surgical code edits. The read tools (`fast_search` / `fast_read` / `fast_diff`) shell out to ripgrep/git and work on any file, DOSSIER.md included.

**NOT for DOSSIER.md writes.** fastedit rejects `.md` — no markdown grammar, so `detect_language` returns `None` and every `fast_edit` / `fast_batch_edit` / `fast_multi_edit` call returns `unsupported file type '.md'`. DOSSIER.md mutations go through the bundled helpers instead (FORMAT.md §15): `lib-row-flip.sh` (§T/§B state flips) and `lib-s-append.sh` (§S appends). Those are deterministic, atomic, and always present — no detection, no fallback gymnastics.

If fastedit absent: use the Edit tool for source files.

## §context7 — current library API docs

MCP server (Upstash) serving version-current API docs. Detection: tool namespace has `mcp__claude_ai_Context7__resolve-library-id` (+ `__query-docs`).

If present: `ds:build` PIN CHECK (step 5.5) grounds the API SHAPE for a pinned lib — `resolve-library-id{libraryName:<pkg>}` then `query-docs{libraryId, query:<specific API question>}` before coding, so the model writes the current API, not a remembered one.

If absent: `WebFetch` the library's official docs URL (the `ds:verify` convention). Never required.

Do NOT use the context7 HTTP API as the default path — it requires a paid `ctx7sk-` key (no-new-secret rule). Opt-in only if the operator has exported `CONTEXT7_API_KEY`.

## §workflow — deterministic scout fan-out

Native harness tool (not MCP). Detection: tool namespace has `Workflow`.

Scope: **research fan-out ONLY** — `ds:check` step 2 (§V/§T/§X scan), `ds:migrate` step 3 (repo inspection), `ds:backprop` root-cause research. NEVER the `ds:build` loop: Workflows run in background with no mid-run steer and no orchestrator FS/shell — breaks TDD-commit-per-flip + §S resume.

Route:

- targets ≤ 2 OR tool absent → parallel Agent spawns (`subagent_type: dossier:dossier-scout`). Workflow setup overhead not worth it.
- targets > 2 → one Workflow run. Skill-instructed invocation = explicit operator opt-in per the Workflow tool contract.

Script template — skill prepares `args.missions` = `[{repo, mission}]` (mission text per skill, DOSSIER.md pasted in where the skill's template says so):

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

Wins vs raw Agent spawns: schema-validated rows (no prose parsing), `pipeline()` (no barrier idle), budget-gated width with logged drops (no silent caps), `resumeFromRunId` (crashed sweep resumes — finished scouts return cached).

If absent: parallel Agent calls, one per repo, identical missions.

## §whetstone — adversarial doubt gate (cross-plugin agent)

Sibling plugin (`raisedadead/claude-code-plugins`) shipping the `whetstone:whetstone-doubter` fresh-context design reviewer. dossier composes it at phase gates; whetstone stays independently publishable.

Detection is a NEW path — agents, not CLI / MCP-namespace / skill-triggers:

- **Primary:** the session context lists available agent types (the `Agent` tool's registry). Present iff the list contains `whetstone:whetstone-doubter`.
- **Fallback (suspenders):** if an `Agent` call is made anyway and the type is absent, the harness returns a recoverable tool-result error — `Agent type '<name>' not found. Available agents: ...` — the turn survives and the error enumerates what IS available. On this error: append §S `doubt=skipped-absent`, continue the build. Graceful skip, never block.

Invocation (when present): `Agent` tool, `subagent_type: whetstone:whetstone-doubter`, artifact-only mission per whetstone's doubt-pass protocol (extracted plan + contract, no parent reasoning). Verdict line `DOUBT: FAILURES | NO FAILURE FOUND` — model-judgment parsed, not computed.

Absent-type semantics are UNDOCUMENTED upstream — verified empirically on Claude Code 2.1.205 (2026-07-20; corroborated by anthropics/claude-code#59881, #68945). One unconfirmed contrary report exists (#32975 comment) — hence belt+suspenders: pre-check the agent list AND catch the not-found error. Re-verify on major harness bumps.

If absent: skip the doubt gate silently (§S note only). Never error, never prompt.

**Skill route (`whetstone:merge-resolve`, ds:build step 6):** detection = available-skills list (same class as §caveman). Scope: merge-class only — plain `git merge` conflicts; `rebase`/`cherry-pick` conflicts stay operator-driven (their `--continue` commits escape ds:build's task-scoped commit discipline). No cross-plugin path resolution needed: the skill runs with its own plugin root. Absent → inline resolution, §S-noted.

**Script route (`lint_skill.py`, ds:build step 6):** same deterministic resolution (source-checkout relative path or `DOSSIER_LINT_SKILL`); lints any touched SKILL.md pre-commit. Unresolvable → skip silently with §S note — CI's repo-wide sweep remains the backstop.

**Script route (`tiger_check.py`, ds:build step 7, between `git add` and `git commit`):** resolved as `tiger-check` on `PATH` (whetstone ships `bin/tiger-check`; Claude Code puts a plugin's `bin/` on the Bash tool's `PATH` while it is enabled), falling back to the source-checkout path `plugins/whetstone/skills/tiger-style/scripts/tiger_check.py` or an operator-set `DOSSIER_TIGER_CHECK`; measures the column budget of the lines the staged diff adds. Exit `0` clean, with the examined and skipped counts on the verdict line so an empty index is distinguishable from both a real pass and a docs-only commit · `1` a limit the repo declared was exceeded (blocking) · `2` the built-in 100-column fallback was exceeded (advisory, never blocks) · `64` not a git work tree. Unresolvable → skip silently, §S `tiger=skipped-absent`. Require a `TIGER:` line in stdout before trusting any of those numbers: a missing script makes the interpreter exit 2, and a directory makes it exit 1, aliasing NAG and BLOCK respectively.

**Reach, stated honestly:** the source-relative path resolves only inside a checkout of this repo. In a consuming project the two plugins live in sibling cache directories and `${CLAUDE_PLUGIN_ROOT}` addresses only the running plugin's own root, so nothing here can find whetstone — the route is `skipped-absent` on every commit unless the operator sets `DOSSIER_TIGER_CHECK`. That is a real hole in the composition story, not a detail: `ARCHITECTURE.md` warns that a rule reaching only this repo's CI is a benefit no consumer gets, and a route that resolves only in this checkout is the same defect one layer down.

The checker's own limit knob is `WHETSTONE_TIGER_COLS`, deliberately NOT a `DOSSIER_` name: it configures whetstone's behaviour and has to work for someone who never installed this plugin (D2). `DOSSIER_TIGER_CHECK` keeps the dossier prefix because it is this plugin resolving a path to a sibling — the same shape as the three routes around it.

**Script route (`flake_runner.sh`, ds:backprop step 4.5):** same deterministic resolution as run_slice below (source-checkout relative path or `DOSSIER_FLAKE_RUNNER`); triages failing-test bugs for nondeterminism before an invariant is minted. Unresolvable → triage skipped silently.

**Script route (`run_slice.sh`, ds:build step 6):** resolution is deterministic only — the source-checkout relative path (`plugins/whetstone/skills/tdd-cycle/scripts/run_slice.sh`) or an operator-set `DOSSIER_RUN_SLICE` env path. Glob auto-discovery of the installed plugin cache was rejected by doubt-pass: extraction mtimes are not version signals, stale cache dirs survive reinstalls, and cross-marketplace name collisions can select wrong-provenance scripts. The agent-registry check above governs AGENT composition only; script and agent detection never substitute for each other. Unresolvable script → raw test commands, silently.

## Detection scaffold (skill body preamble)

Each `ds:*` skill begins with:

```markdown
### Step 0 — Detect host env (once)

Run:
- `command -v rtk &>/dev/null && echo HAS_RTK=1`
- Check tool namespace for: `mcp__cavemem__search`, `mcp__fastedit__fast_edit`, `Workflow`
- Check available skills for: `caveman:caveman`, `ck:caveman`
- Check available agent types for: `whetstone:whetstone-doubter`

Cache results for this invocation. Route commands per ADAPTERS.md tables.
Never error if absent. Never require any adapter.
```

## Non-goals

- No adapter is REQUIRED. Plugin must install + work cleanly on a vanilla Claude Code with no extras.
- `plugin.json` MUST NOT declare these as dependencies.
- Detection failure = silent fallback. Never block.
- No adapter version-check. Best-effort use.
