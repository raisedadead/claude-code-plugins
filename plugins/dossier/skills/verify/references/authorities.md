# verify — authority reference

Loaded on demand. The procedure lives in `../SKILL.md`; this file is the lookup detail (kept out of the always-resident skill body to save tokens).

## Authority cheatsheet (raw-JSON paths)

Trust raw JSON. Use `curl -s <url>` (raw bytes) for JSON endpoints, never `WebFetch` (it summarizes and can hallucinate). Prefer `gh api` over WebFetch on github.com.

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
