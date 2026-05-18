---
name: verify
description: Empirical fact-check for any freshness-sensitive technical claim — versions, EOLs, package latest, GitHub Action SHAs, k8s apiVersions, AI model deprecations, CLI flags, API endpoints, framework versions, image tags, or anything where the model's training cutoff might be wrong. Routes through primary sources, never accepts model-paraphrased data. Auto-fires as PreToolUse hook on every Edit/Write/MultiEdit; invoke `/dossier:verify` on demand for the previous response. Invoke when user says "verify", "fact-check", "is this current", "/dossier:verify", "double check", or when reviewing freshness claims.
argument-hint: '[claim or topic; empty = fact-check previous response]'
---

# ds:verify — empirical freshness check

Two surfaces, same hard rule: **trust primary sources, never paraphrase JSON.**

## Surface 1 — PreToolUse hook (auto)

Wired in `hooks/hooks.json`. Fires on every `Edit | Write | MultiEdit`. Scans content against the broad pattern registry in `hooks/verify_patterns.py` and the authority catalog in `hooks/verify_authorities.py`. Coverage (140+ aliases, 34 Docker images, 31 AI models):

| Class                     | Authority                                    | Examples caught                                                |
| ------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| Language / runtime EOL    | endoflife.date                               | `Node 18`, `Python 3.8`, `Ruby 2.7`, `Go 1.18`, `PHP 7.4`      |
| OS / distro EOL           | endoflife.date                               | `Ubuntu 18.04`, `Debian 9`, `CentOS 7`, `Alpine 3.10`          |
| Database EOL              | endoflife.date                               | `Postgres 11`, `MySQL 5.7`, `Redis 5`, `MongoDB 4`             |
| Container image EOL       | endoflife.date via image alias               | `FROM node:18-alpine`, `image: postgres:11`, `nginx:1.18-slim` |
| GitHub Action pinning     | GitHub git refs API                          | `uses: actions/checkout@v4` → flag + resolved SHA              |
| k8s deprecated apiVersion | k8s deprecation guide (15-entry static map)  | `apiVersion: extensions/v1beta1` → networking.k8s.io/v1        |
| npm package outdated      | npmjs registry                               | `"react": "16.0.0"` (≥2 majors behind)                         |
| PyPI / pyproject outdated | pypi.org JSON                                | `django==2.2.0`                                                |
| Cargo / RubyGems / Go mod | crates.io / rubygems / go proxy              | `serde = "0.1.0"`, `gem 'rails', '5.0'`, `require foo v0.1.0`  |
| AI model deprecation      | OpenAI / Anthropic / Google deprecation docs | `model="gpt-3.5-turbo-0613"`, `claude-2.1`, `gemini-1.0-pro`   |

Non-blocking by design — emits stderr reminder + `additionalContext`. Per-session dedup. Operator escape: `# verify-skip: <ruleName>` on or near the line.

Cache at `<cwd>/.scratchpad/.verify-cache/` (24h TTL on registries, 30d on resolved SHAs). Offline = silent skip.

## Surface 2 — `/dossier:verify [<topic>]` (manual, generic)

**No pattern lock-in.** Model handles arbitrary freshness claims by classifying them and routing to the right primary source.

### Steps

1. **Identify claims.** From `$ARGUMENTS` if provided, else extract every freshness-sensitive claim from the previous assistant message. A "freshness-sensitive" claim is any statement where the answer could plausibly have changed since the model's training cutoff. Categories below.
1. **Classify each claim** into one of these buckets:
   - **Version / LTS / EOL** of language, OS, distro, database, runtime → `endoflife.date/api/v1/products/<slug>`
   - **Package latest** → ecosystem registry (npm/PyPI/crates/RubyGems/Hex/Packagist/Go proxy/Maven Central/Homebrew)
   - **GitHub release / tag / SHA** → `api.github.com/repos/<owner>/<repo>/releases/latest` or `/git/refs/tags/<tag>`
   - **CLI flag / subcommand** → vendor docs (search official site)
   - **API endpoint / schema** → vendor docs / OpenAPI spec
   - **AI model identifier** → vendor deprecation page (OpenAI/Anthropic/Google/Mistral/Meta)
   - **Framework / library API** → official docs (search) or release notes
   - **License / SPDX identifier** → `spdx.org/licenses/`
   - **Standard / RFC** → ietf.org / w3.org
   - **Anything else freshness-sensitive** → WebSearch first, then WebFetch the top primary source.
1. **Query the authority.**
   - JSON APIs: prefer `Bash` + `curl -s <url>` so you read **raw JSON** directly. Never use `WebFetch` for JSON — it summarizes and can hallucinate.
   - HTML docs: `WebSearch` then `WebFetch` is acceptable, but quote the exact text you compared against.
   - GitHub: prefer `gh api <path>` over WebFetch on github.com.
1. **Compare exact field values.** Pull the specific field (`releases[].name`, `info.version`, `crate.newest_version`, etc.) and compare against the claim's literal value. **Do NOT ask the model to read prose and decide if the claim matches.**
1. **Render verdict table.**

### Output format

```markdown
| Claim                | Verdict      | Source                                       |
| -------------------- | ------------ | -------------------------------------------- |
| Node 22 is LTS       | Confirmed    | endoflife.date/api/v1/products/nodejs        |
| use Node 20 LTS      | Outdated     | endoflife.date/api/v1/products/nodejs        |
| actions/checkout@v3  | Outdated     | github.com/actions/checkout/releases         |
| `gpt-3.5-turbo`      | Deprecated   | platform.openai.com/docs/deprecations        |
| RFC 2616 is current  | Incorrect    | datatracker.ietf.org/doc/rfc2616             |
| Tailwind v4 alpha    | Unverifiable | (no offline source reachable)                |
```

Verdict vocabulary (4 values + Unverifiable):

| Value        | Meaning                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| Confirmed    | Claim matches authority exactly.                                         |
| Outdated     | Claim was right at some past date; authority shows a newer current.      |
| Incorrect    | Claim never matched authority (typo / hallucination / wrong identifier). |
| Deprecated   | Authority says the named thing is retired/sunset; suggest replacement.   |
| Unverifiable | Network failure, paywall, or no authoritative source found. Say so.      |

For Outdated / Incorrect / Deprecated rows, append one line below the table per row:

```
wrong: Node 20 LTS · right: current LTS = v24 (Krypton) + v22 (Jod). v20 EOL 2026-04-30.
```

## Hard rules

- **Trust raw JSON. Never trust a model-summarized JSON response.** This is the single most important rule. `WebFetch` summarizes — that summary CAN hallucinate. Always use `curl -s <url>` (raw bytes) when the authority is a JSON endpoint, then `jq` or Python to extract exact fields.
- **Cite the authority URL in every row.** No verdict without a source.
- **Quote the exact text or field you compared.** Make the comparison reproducible.
- **If authority unreachable: mark `Unverifiable` and say which URL failed.** Never guess.
- **Never bump copyright years proactively** — see operator MEMORY.md.
- **Resist the "looks fine" instinct.** If you didn't pull the answer from a primary source, mark `Unverifiable`.

## Authority cheatsheet

| Need                      | Command (raw JSON path)                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Language / OS / DB EOL    | `curl -s https://endoflife.date/api/v1/products/<slug>` then read `result.releases[]`                                |
| npm latest                | `curl -s https://registry.npmjs.org/<pkg>/latest` → `.version`                                                       |
| PyPI latest               | `curl -s https://pypi.org/pypi/<pkg>/json` → `.info.version`                                                         |
| crates.io latest          | `curl -s https://crates.io/api/v1/crates/<pkg>` → `.crate.newest_version`                                            |
| Go module latest          | `curl -s https://proxy.golang.org/<module>/@latest` → `.Version`                                                     |
| RubyGems latest           | `curl -s https://rubygems.org/api/v1/gems/<name>.json` → `.version`                                                  |
| Hex (Elixir)              | `curl -s https://hex.pm/api/packages/<name>` → `.releases[0].version`                                                |
| Packagist (PHP)           | `curl -s https://repo.packagist.org/p2/<vendor>/<pkg>.json`                                                          |
| Homebrew formula          | `curl -s https://formulae.brew.sh/api/formula/<name>.json` → `.versions.stable`                                      |
| GitHub latest release     | `gh api repos/<owner>/<repo>/releases/latest` → `.tag_name`                                                          |
| GitHub tag → SHA          | `gh api repos/<owner>/<repo>/git/refs/tags/<tag>` → `.object.sha`                                                    |
| GitHub Actions security   | https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions |
| k8s deprecation           | https://kubernetes.io/docs/reference/using-api/deprecation-guide/                                                    |
| OpenAI deprecations       | https://platform.openai.com/docs/deprecations                                                                        |
| Anthropic deprecations    | https://docs.anthropic.com/en/docs/about-claude/model-deprecations                                                   |
| Google AI model lifecycle | https://ai.google.dev/gemini-api/docs/models                                                                         |
| SPDX licenses             | https://spdx.org/licenses/                                                                                           |
| Docker Hub image tag      | `curl -s "https://registry.hub.docker.com/v2/repositories/library/<image>/tags/?page_size=10"`                       |

## Adding a new authority / alias

Append a row to:

- `hooks/verify_authorities.EOL_ALIAS_TO_SLUG` for a new endoflife.date product.
- `hooks/verify_authorities.PKG_REGISTRY` for a new package ecosystem.
- `hooks/verify_authorities.DOCKER_IMAGE_TO_SLUG` for a new official Docker image.
- `hooks/verify_authorities.AI_MODEL_DEPRECATED` for a new sunset model.

No code change. Adding aliases is pure data.

## Composition

- **With `ds:check`**: drift detector runs `verify_sweep.py` on touched files automatically; findings fold into 🟡 warnings.
- **With `ds:build`**: PreToolUse hook fires on every Edit/Write inside the build; no explicit invocation needed.
- **With `ds:backprop`**: if a bug's root cause is "stale claim baked into code", the backprop fix should add the missing alias to `verify_authorities.py` so recurrence is caught at write time.

## Cite

- `hooks/verify_authorities.py` — alias maps + registry definitions
- `hooks/verify_lib.py` — generic check functions
- `hooks/verify_patterns.py` — pattern registry
- `hooks/verify_hook.py` — PreToolUse dispatcher
- `hooks/verify_sweep.py` — read-only sweep (used by ds:check)
