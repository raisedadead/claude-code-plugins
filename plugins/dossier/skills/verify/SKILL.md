---
name: verify
description: Empirical fact-check for freshness-sensitive claims — versions, EOLs, package latest, GitHub Action SHAs, k8s apiVersions, AI model deprecations, image tags, or anything the model's training cutoff may have staled. Primary sources only. Runs on demand, anywhere. Invoke when user says "verify", "fact-check", "is this current", "/dossier:verify", "double check", or when reviewing freshness claims.
argument-hint: '[claim or topic; empty = fact-check previous response]'
---

# ds:verify — empirical freshness check

One rule: **read the primary source's raw bytes.**

## `/dossier:verify [<topic>]`

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
   - **Framework / library API** → official docs; for a claim that something changed in a version, its release notes
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
wrong: Node 20 LTS · right: <LTS majors from jq on endoflife.date/api/v1/products/nodejs> · <EOL date of the claimed line>
```

## Hard rules

- **Raw JSON only.** `curl -s <url>` (raw bytes) then `jq -r '<path>'` for the exact field. `WebFetch` returns a model summary of the JSON, and that summary can hallucinate — this is the rule the rest depend on.
- **Cite the authority URL in every row.** A verdict carries its source.
- **Quote the exact text or field you compared**, so the comparison reproduces.
- **Authority unreachable → `Unverifiable`, naming the URL that failed.**
- **Copyright years change only when the operator asks for it.**
- **Answer from the source you pulled.** Anything that came from memory instead is `Unverifiable`, whatever it looks like.

## Authority cheatsheet

Per-source raw-JSON `curl` / `gh api` paths → [`references/authorities.md`](references/authorities.md).
