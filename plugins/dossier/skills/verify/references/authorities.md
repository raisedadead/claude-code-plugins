# verify — authority reference

Loaded on demand. The procedure lives in `../SKILL.md`; this file is the lookup detail (kept out of the always-resident skill body to save tokens).

## PreToolUse hook coverage

Auto-fires on every `Edit | Write | MultiEdit`. Patterns in `hooks/verify_patterns.py`, catalog in `hooks/verify_authorities.py` (140+ aliases, 34 Docker images, 31 AI models).

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

## Adding a new authority / alias

Append a row to one of these maps — no code change, pure data:

- `hooks/verify_authorities.EOL_ALIAS_TO_SLUG` — a new endoflife.date product.
- `hooks/verify_authorities.PKG_REGISTRY` — a new package ecosystem.
- `hooks/verify_authorities.DOCKER_IMAGE_TO_SLUG` — a new official Docker image.
- `hooks/verify_authorities.AI_MODEL_DEPRECATED` — a new sunset model.
