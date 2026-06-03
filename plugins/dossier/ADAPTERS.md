# ADAPTERS.md — Host-env detection + routing

Optional integrations dossier auto-detects. Plugin works without any of them. Detect-then-route, graceful fallback.

Skills + the `dossier-scout` agent reference this file. Detection runs once per skill invocation, cached for the duration.

______________________________________________________________________

## Adapter matrix

| Adapter            | Detection                                                        | If present                                                    | If absent              |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------- |
| `rtk` CLI          | `command -v rtk`                                                 | see §rtk below                                                | emit raw commands      |
| `context-mode` MCP | tool namespace has `mcp__context-mode__ctx_execute`              | use `ctx_batch_execute` for multi-repo scans                  | parallel Bash + Read   |
| `cavemem` MCP      | tool namespace has `mcp__cavemem__search`                        | augment §S tail with cross-session observations               | §S only                |
| `caveman` skill    | available-skills list has `caveman:caveman` or `ck:caveman`      | encourage caveman encoding in writes                          | plain markdown         |
| `fastedit` MCP     | tool namespace has `mcp__fastedit__fast_edit`                    | surgical edits to SOURCE task files; read via fast_search     | Edit tool              |
| `context7` MCP     | tool namespace has `mcp__claude_ai_Context7__resolve-library-id` | ground CURRENT library API docs before coding (see §context7) | WebFetch official docs |

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

## §context-mode — batch read primitive

MCP server providing `ctx_execute` / `ctx_search` / `ctx_batch_execute` / `ctx_fetch_and_index` tools. Cuts tool-call overhead when scanning many files / running many commands.

Detection: presence of `mcp__context-mode__*` in available tools.

If present, prefer:

| Use case                     | Without ctx           | With ctx                   |
| ---------------------------- | --------------------- | -------------------------- |
| Multi-repo `git status` scan | parallel Bash N calls | `ctx_batch_execute` 1 call |
| Multi-file Read sweep        | parallel Read N calls | `ctx_search` 1 call        |
| Index project tree           | `find` + Read         | `ctx_fetch_and_index`      |

`ds:check` + `ds:migrate` benefit most (multi-repo scans). Other skills use raw Bash.

If absent: parallel Bash / Read calls.

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

## Detection scaffold (skill body preamble)

Each `ds:*` skill begins with:

```markdown
### Step 0 — Detect host env (once)

Run:
- `command -v rtk &>/dev/null && echo HAS_RTK=1`
- Check tool namespace for: `mcp__context-mode__ctx_execute`, `mcp__cavemem__search`, `mcp__fastedit__fast_edit`
- Check available skills for: `caveman:caveman`, `ck:caveman`

Cache results for this invocation. Route commands per ADAPTERS.md tables.
Never error if absent. Never require any adapter.
```

## Non-goals

- No adapter is REQUIRED. Plugin must install + work cleanly on a vanilla Claude Code with no extras.
- `plugin.json` MUST NOT declare these as dependencies.
- Detection failure = silent fallback. Never block.
- No adapter version-check. Best-effort use.
