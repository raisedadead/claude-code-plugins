---
name: verify
description: Fact-check freshness-sensitive technical claims (Node LTS, GH Action pins, k8s apiVersion, package versions, EOL OS/runtime) against authoritative sources. Auto-fires as PreToolUse hook on Edit/Write/MultiEdit; also invokable on demand for the previous response. Invoke when user says "verify", "fact-check", "is this current", "/dossier:verify", or when reviewing freshness claims.
argument-hint: '[claim or topic]'
---

# ds:verify — empirical freshness check

Two surfaces. Same authorities, different triggers.

## Surface 1 — PreToolUse hook (auto)

Already wired in `hooks/hooks.json`. Fires on `Edit | Write | MultiEdit`. Scans `tool_input.content` against patterns in `hooks/verify_patterns.py`. Emits stderr reminder + `additionalContext` on findings. Non-blocking. Per-session dedup. Operator escape via `# verify-skip: <ruleName>` inline comment.

No invocation required — it runs every time the model writes a file.

## Surface 2 — `/dossier:verify [<topic>]` (manual)

Fact-check the previous response, or `<topic>` if provided, by querying primary sources. Report a tabular verdict.

### Steps

1. Identify claim(s) to verify. From `$ARGUMENTS` if provided, else the previous assistant message.
1. Classify each claim:
   - Version / LTS / EOL → endoflife.date (`https://endoflife.date/api/v1/products/<slug>`)
   - Package version → npm / PyPI / crates / RubyGems / Hex / Packagist / etc.
   - GitHub Action `uses:` → resolve via `gh api repos/<owner>/<repo>/git/refs/tags/<tag>`
   - k8s `apiVersion` → `https://kubernetes.io/docs/reference/using-api/deprecation-guide/`
   - General "is this current" → WebSearch + WebFetch
1. For each claim, fetch the authority. **Trust raw JSON; never trust a model-summary of raw JSON.**
1. Compose table.

### Output format

```
| Claim | Verdict | Source |
|-------|---------|--------|
| <quoted claim> | Confirmed / Incorrect / Outdated / Unverifiable | <URL> |
```

For Incorrect or Outdated rows, append a one-line correction: `wrong: <X> · right: <Y>`.

### Examples

```
/dossier:verify "Node 22 is LTS"
| Claim                | Verdict   | Source                                                |
|----------------------|-----------|-------------------------------------------------------|
| Node 22 is LTS       | Confirmed | https://endoflife.date/api/v1/products/nodejs         |

/dossier:verify "use Node 20 LTS"
| Claim             | Verdict  | Source                                                |
|-------------------|----------|-------------------------------------------------------|
| use Node 20 LTS   | Outdated | https://endoflife.date/api/v1/products/nodejs         |
wrong: v20 · right: current LTS = v24 (Krypton), v22 (Jod). v20 EOL 2026-04-30.
```

## Authorities (canonical)

| Domain                | URL                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Software EOL / LTS    | `https://endoflife.date/api/v1/products/{slug}` (455+ products)                                                        |
| npm                   | `https://registry.npmjs.org/{pkg}/latest`                                                                              |
| PyPI                  | `https://pypi.org/pypi/{pkg}/json`                                                                                     |
| crates.io             | `https://crates.io/api/v1/crates/{name}`                                                                               |
| Go modules            | `https://proxy.golang.org/{module}/@v/list`                                                                            |
| GH releases           | `https://api.github.com/repos/{owner}/{repo}/releases/latest`                                                          |
| GH tag → SHA          | `https://api.github.com/repos/{owner}/{repo}/git/refs/tags/{tag}`                                                      |
| GH Actions security   | `https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions` |
| k8s deprecation guide | `https://kubernetes.io/docs/reference/using-api/deprecation-guide/`                                                    |

## Hard rules

- Cite the authority URL in every Verdict row.
- Trust raw JSON. Never summarize a JSON response and ask the model to compare against the claim — too easy to hallucinate a wrong field. Compare exact field values directly.
- If authority unreachable: mark Verdict = `Unverifiable` with `(offline: <url>)`. Never guess.
- Never bump a copyright year proactively (project-specific; see operator MEMORY.md).

## Pattern registry

The auto-hook patterns live in `${CLAUDE_PLUGIN_ROOT}/hooks/verify_patterns.py`. Add a new rule by appending a dict to `VERIFY_PATTERNS` and a check function to `verify_lib.py`. No DSL — patterns are plain Python.

## Cite

- ADAPTERS.md §verify (when added)
- FORMAT.md (no spec changes — verify is orthogonal to dossier sections)
