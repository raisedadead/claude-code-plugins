---
name: verify
description: Empirical fact-check for freshness-sensitive claims — versions, EOLs, package latest, GitHub Action SHAs, k8s apiVersions, AI model deprecations, image tags, or anything the model's training cutoff may have staled. Primary sources only. Auto-fires as a PreToolUse hook on Edit/Write/MultiEdit, but only in a repo with a `.scratchpad/dossier/` directory; `/dossier:verify` on demand works anywhere. Invoke when user says "verify", "fact-check", "is this current", "/dossier:verify", "double check", or when reviewing freshness claims.
argument-hint: '[claim or topic; empty = fact-check previous response]'
---

# ds:verify — empirical freshness check

Two surfaces, one rule: **read the primary source's raw bytes.**

## Surface 1 — PreToolUse hook (auto)

Wired in `hooks/hooks.json`. Fires on `Edit | Write | MultiEdit`, and only in a repo that has a `.scratchpad/dossier/` directory — elsewhere it exits 0 without scanning. Scans content against the pattern registry in `hooks/verify_patterns.py` and the authority catalog in `hooks/verify_authorities.py` (140+ aliases, 34 Docker images, 31 AI models). Covers language/runtime/OS/distro/database EOL, container-image EOL, GitHub Action SHA pinning, k8s deprecated apiVersions, npm/PyPI/Cargo/RubyGems/Go-mod outdated packages, and AI-model deprecation. Full coverage matrix + per-source cheatsheet → [`references/authorities.md`](references/authorities.md).

Non-blocking by design — emits a stderr reminder plus `additionalContext`. Per-session dedup. Operator escape: `# verify-skip: <ruleName>` on or near the line.

Cache at `<project root>/.scratchpad/.verify-cache/` (24h TTL on registries, 30d on resolved SHAs). Offline = silent skip.

## Surface 2 — `/dossier:verify [<topic>]` (manual, generic)

No pattern lock-in: the model classifies an arbitrary freshness claim and routes it to the right primary source.

### Steps

1. **Identify claims.** From `$ARGUMENTS` when provided, else every freshness-sensitive claim in the previous assistant message. Freshness-sensitive = the answer could plausibly have changed since the training cutoff.
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
   - JSON APIs: `Bash` + `curl -s <url>`, so you read raw JSON. `WebFetch` summarises JSON, and a summary can hallucinate.
   - HTML docs: `WebSearch` then `WebFetch`, quoting the exact text you compared against.
   - GitHub: `gh api <path>` over WebFetch on github.com.
1. **Compare exact field values.** Pull the specific field (`releases[].name`, `info.version`, `crate.newest_version`, …) and compare it against the claim's literal value. The comparison is field-to-value, not prose-to-impression.
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

- **Raw JSON only.** `curl -s <url>` (raw bytes) then `jq` or Python for the exact field. `WebFetch` returns a model summary of the JSON, and that summary can hallucinate — this is the rule the rest depend on.
- **Cite the authority URL in every row.** A verdict carries its source.
- **Quote the exact text or field you compared**, so the comparison reproduces.
- **Authority unreachable → `Unverifiable`, naming the URL that failed.**
- **Copyright years change when the operator asks for it** — see operator MEMORY.md.
- **Answer from the source you pulled.** Anything that came from memory instead is `Unverifiable`, whatever it looks like.

## Authority cheatsheet + extending the catalog

Per-source raw-JSON `curl` / `gh api` paths, and how to add a new authority (pure data, no code change) → [`references/authorities.md`](references/authorities.md).

## Composition

- **With `ds:check`**: the drift detector runs `verify_sweep.py` on touched files automatically; findings fold into 🟡 warnings.
- **With `ds:build`**: the PreToolUse hook is active inside the build (a live wave means the `.scratchpad/dossier/` gate passes), so no explicit invocation is needed. It skips dossier paths themselves — `.scratchpad/`, `DOSSIER.md`, `PLAN.md`, `SPEC.md` — so ledger writes stay unscanned.
- **With `ds:backprop`**: when a bug's root cause is "stale claim baked into code", the backprop fix adds the missing alias to `verify_authorities.py` so recurrence is caught at write time.

## Cite

- `hooks/verify_authorities.py` — alias maps + registry definitions
- `hooks/verify_lib.py` — generic check functions
- `hooks/verify_patterns.py` — pattern registry
- `hooks/verify_hook.py` — PreToolUse dispatcher
- `hooks/verify_sweep.py` — read-only sweep (used by ds:check)
