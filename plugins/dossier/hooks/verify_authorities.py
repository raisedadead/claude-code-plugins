"""Authority registry — primary sources for freshness verification.

Data-only. No logic. New product = add a row.

Two tables:
    EOL_ALIAS_TO_SLUG  : free-text/file-shape alias → endoflife.date slug
    PKG_REGISTRY       : ecosystem → URL template + latest-version JSON path

endoflife.date covers 455+ products: languages, OSes, distros, databases,
frameworks, runtimes, container orchestrators, CI tools, package managers, etc.
Browse: https://endoflife.date/api/v1/products

Adding a product:
    1. Find slug via https://endoflife.date/api/v1/products
    2. Add the slug + every casing/synonym to EOL_ALIAS_TO_SLUG.
    3. That's it.
"""
from __future__ import annotations

# Subject aliases → endoflife.date product slug. Lowercase keys.
# Keep aliases sorted longest-first when consumed by the regex (handled at use site).
EOL_ALIAS_TO_SLUG: dict[str, str] = {
    # ── Languages / runtimes ────────────────────────────────────────────
    "node": "nodejs", "node.js": "nodejs", "nodejs": "nodejs", "nodejsruntime": "nodejs",
    "python": "python", "python3": "python", "cpython": "python",
    "ruby": "ruby",
    "go": "go", "golang": "go",
    "rust": "rust",
    "php": "php",
    "perl": "perl",
    "java": "java", "openjdk": "java", "jdk": "java",
    "kotlin": "kotlin",
    "scala": "scala",
    "elixir": "elixir",
    "erlang": "erlang",
    "swift": "swift",
    "dart": "dart",
    "lua": "lua",
    "haskell": "haskell", "ghc": "haskell",
    "clojure": "clojure",
    "crystal": "crystal",
    "nim": "nim",
    "zig": "zig",
    "ocaml": "ocaml",
    "deno": "deno",
    "bun": "bun",
    "dotnet": "dotnet", ".net": "dotnet", "netcore": "dotnet", "net": "dotnet",
    "powershell": "powershell",

    # ── Operating systems / distros ────────────────────────────────────
    "ubuntu": "ubuntu",
    "debian": "debian",
    "alpine": "alpine", "alpinelinux": "alpine",
    "centos": "centos",
    "rhel": "rhel", "redhatenterpriselinux": "rhel",
    "rockylinux": "rocky-linux", "rocky": "rocky-linux",
    "almalinux": "almalinux", "alma": "almalinux",
    "amazonlinux": "amazon-linux", "amzn": "amazon-linux",
    "fedora": "fedora",
    "opensuse": "opensuse",
    "macos": "macos", "osx": "macos",
    "windows": "windows",
    "android": "android",
    "ios": "ios",
    "raspbian": "raspbian",

    # ── Databases / caches / brokers ───────────────────────────────────
    "mysql": "mysql",
    "mariadb": "mariadb",
    "postgres": "postgresql", "postgresql": "postgresql", "psql": "postgresql",
    "mongodb": "mongodb", "mongo": "mongodb",
    "redis": "redis",
    "valkey": "valkey",
    "sqlite": "sqlite",
    "cassandra": "cassandra",
    "elasticsearch": "elasticsearch", "elastic": "elasticsearch",
    "opensearch": "opensearch",
    "kafka": "apache-kafka", "apachekafka": "apache-kafka",
    "rabbitmq": "rabbitmq",
    "memcached": "memcached",
    "couchdb": "couchdb",
    "couchbase": "couchbase",
    "neo4j": "neo4j",
    "influxdb": "influxdb",
    "clickhouse": "clickhouse",
    "etcd": "etcd",

    # ── Container / orchestration / service mesh ───────────────────────
    "kubernetes": "kubernetes", "k8s": "kubernetes",
    "docker": "docker-engine", "dockerengine": "docker-engine",
    "containerd": "containerd",
    "openshift": "openshift",
    "rancher": "rancher",
    "helm": "helm",
    "argocd": "argo-cd", "argo-cd": "argo-cd",
    "istio": "istio",
    "linkerd": "linkerd",
    "envoy": "envoy",
    "consul": "consul",
    "nomad": "nomad",
    "vault": "vault",

    # ── Web servers / reverse proxies ──────────────────────────────────
    "nginx": "nginx",
    "apache": "apache", "httpd": "apache",
    "traefik": "traefik",
    "caddy": "caddy",
    "haproxy": "haproxy",

    # ── CI / SCM / build ───────────────────────────────────────────────
    "gitlab": "gitlab",
    "jenkins": "jenkins",
    "circleci": "circleci",
    "drone": "drone",
    "terraform": "terraform",
    "ansible": "ansible",
    "packer": "packer",
    "vagrant": "vagrant",
    "maven": "maven",
    "gradle": "gradle",

    # ── Frameworks (where endoflife.date tracks them) ──────────────────
    "django": "django",
    "rails": "rails", "rubyonrails": "rails",
    "laravel": "laravel",
    "symfony": "symfony",
    "spring": "spring-framework", "spring-framework": "spring-framework",
    "springboot": "spring-boot", "spring-boot": "spring-boot",
    "angular": "angular",
    "nextjs": "nextjs", "next.js": "nextjs",
    "nuxt": "nuxt",
    "react": "react",
    "vue": "vue",
    "svelte": "svelte",
    "ember": "emberjs", "emberjs": "emberjs",
    "drupal": "drupal",
    "wordpress": "wordpress",
    "magento": "magento",

    # ── Browsers / clients ─────────────────────────────────────────────
    "chrome": "chrome", "googlechrome": "chrome",
    "firefox": "firefox",
    "safari": "safari",
    "edge": "microsoft-edge",
}


# Ecosystem → registry. JSON GET, dotted-path resolves the "latest" field.
PKG_REGISTRY: dict[str, dict] = {
    "npm": {
        "url": "https://registry.npmjs.org/{pkg}/latest",
        "path": ["version"],
    },
    "pypi": {
        "url": "https://pypi.org/pypi/{pkg}/json",
        "path": ["info", "version"],
    },
    "crates": {
        "url": "https://crates.io/api/v1/crates/{pkg}",
        "path": ["crate", "newest_version"],
    },
    "rubygems": {
        "url": "https://rubygems.org/api/v1/gems/{pkg}.json",
        "path": ["version"],
    },
    "hex": {
        "url": "https://hex.pm/api/packages/{pkg}",
        "path": ["releases", 0, "version"],
    },
    "packagist": {
        # Used as: pkg = "{vendor}/{name}".
        "url": "https://repo.packagist.org/p2/{pkg}.json",
        "path": ["__lookup_packagist_first__"],  # custom — see check_pkg_outdated
    },
    "go": {
        # Go module proxy returns JSON {Version, Time}. pkg = module path.
        "url": "https://proxy.golang.org/{pkg}/@latest",
        "path": ["Version"],
    },
}


# Docker official-image → endoflife.date slug.
# Image tags often carry suffixes (`-alpine`, `-slim`, `-bullseye`); strip before matching.
DOCKER_IMAGE_TO_SLUG: dict[str, str] = {
    "node": "nodejs",
    "python": "python",
    "ruby": "ruby",
    "golang": "go",
    "rust": "rust",
    "php": "php",
    "openjdk": "java", "eclipse-temurin": "java", "amazoncorretto": "java",
    "ubuntu": "ubuntu",
    "debian": "debian",
    "alpine": "alpine",
    "centos": "centos",
    "amazonlinux": "amazon-linux",
    "fedora": "fedora",
    "rockylinux": "rocky-linux",
    "almalinux": "almalinux",
    "mysql": "mysql",
    "mariadb": "mariadb",
    "postgres": "postgresql",
    "mongo": "mongodb",
    "redis": "redis",
    "valkey/valkey": "valkey",
    "memcached": "memcached",
    "nginx": "nginx",
    "httpd": "apache",
    "traefik": "traefik",
    "caddy": "caddy",
    "haproxy": "haproxy",
    "elasticsearch": "elasticsearch",
    "opensearch": "opensearch",
    "rabbitmq": "rabbitmq",
    "wordpress": "wordpress",
    "drupal": "drupal",
}


# AI model identifiers known to be sunset / deprecated.
# Static map — vendor docs don't expose a stable registry API.
# Keys are matched case-insensitively against `model:` / `model=` / `model="<X>"` text.
# Value tuple: (status, sunset_date_or_note, recommended_replacement, source_url)
AI_MODEL_DEPRECATED: dict[str, tuple[str, str, str, str]] = {
    "gpt-3.5-turbo": ("deprecated", "various sunset dates by sub-variant", "gpt-4o-mini / gpt-4o", "https://platform.openai.com/docs/deprecations"),
    "gpt-3.5-turbo-0301": ("retired", "2024-06-13", "gpt-4o-mini", "https://platform.openai.com/docs/deprecations"),
    "gpt-3.5-turbo-0613": ("retired", "2024-06-13", "gpt-4o-mini", "https://platform.openai.com/docs/deprecations"),
    "gpt-3.5-turbo-16k": ("retired", "2024-06-13", "gpt-4o", "https://platform.openai.com/docs/deprecations"),
    "gpt-4": ("legacy", "active but superseded", "gpt-4o / gpt-4-turbo / o-series", "https://platform.openai.com/docs/deprecations"),
    "gpt-4-32k": ("retired", "2024-06-06", "gpt-4o / gpt-4-turbo", "https://platform.openai.com/docs/deprecations"),
    "gpt-4-vision-preview": ("retired", "2024-12-06", "gpt-4o", "https://platform.openai.com/docs/deprecations"),
    "text-davinci-003": ("retired", "2024-01-04", "gpt-4o-mini", "https://platform.openai.com/docs/deprecations"),
    "text-davinci-002": ("retired", "2024-01-04", "gpt-4o-mini", "https://platform.openai.com/docs/deprecations"),
    "code-davinci-002": ("retired", "2023-03-23", "gpt-4o", "https://platform.openai.com/docs/deprecations"),
    "ada": ("retired", "2024-01-04", "text-embedding-3-small", "https://platform.openai.com/docs/deprecations"),
    "babbage": ("retired", "2024-01-04", "gpt-4o-mini", "https://platform.openai.com/docs/deprecations"),
    "curie": ("retired", "2024-01-04", "gpt-4o-mini", "https://platform.openai.com/docs/deprecations"),
    "davinci": ("retired", "2024-01-04", "gpt-4o", "https://platform.openai.com/docs/deprecations"),
    "claude-1": ("retired", "2024-07-21", "claude-3.5-sonnet / claude-3.7-sonnet / claude-4 family", "https://docs.anthropic.com/en/docs/about-claude/model-deprecations"),
    "claude-1.3": ("retired", "2024-07-21", "claude-3.5-sonnet+", "https://docs.anthropic.com/en/docs/about-claude/model-deprecations"),
    "claude-2": ("retired", "2025-07-21", "claude-3.5-sonnet+", "https://docs.anthropic.com/en/docs/about-claude/model-deprecations"),
    "claude-2.0": ("retired", "2025-07-21", "claude-3.5-sonnet+", "https://docs.anthropic.com/en/docs/about-claude/model-deprecations"),
    "claude-2.1": ("retired", "2025-07-21", "claude-3.5-sonnet+", "https://docs.anthropic.com/en/docs/about-claude/model-deprecations"),
    "claude-instant-1": ("retired", "2024-11-06", "claude-3-haiku / claude-3.5-haiku", "https://docs.anthropic.com/en/docs/about-claude/model-deprecations"),
    "claude-instant-1.2": ("retired", "2024-11-06", "claude-3-haiku / claude-3.5-haiku", "https://docs.anthropic.com/en/docs/about-claude/model-deprecations"),
    "claude-3-sonnet-20240229": ("retired", "2025-07-21", "claude-3.5-sonnet+", "https://docs.anthropic.com/en/docs/about-claude/model-deprecations"),
    "claude-3-opus-20240229": ("legacy", "active but superseded", "claude-4-opus / claude-4.1-opus", "https://docs.anthropic.com/en/docs/about-claude/model-deprecations"),
    "gemini-1.0-pro": ("retired", "2025-02-15", "gemini-1.5-pro / gemini-2.0-flash+", "https://ai.google.dev/gemini-api/docs/models/legacy-models"),
    "gemini-pro": ("retired", "alias of gemini-1.0-pro", "gemini-1.5-pro / 2.0+", "https://ai.google.dev/gemini-api/docs/models/legacy-models"),
    "gemini-pro-vision": ("retired", "2025-02-15", "gemini-1.5-pro", "https://ai.google.dev/gemini-api/docs/models/legacy-models"),
    "llama-2": ("legacy", "Meta released Llama 3.x; 2 still functional", "llama-3.x", "https://huggingface.co/meta-llama"),
    "llama2": ("legacy", "Meta released Llama 3.x; 2 still functional", "llama-3.x", "https://huggingface.co/meta-llama"),
    "palm-2": ("retired", "2024 (Google PaLM API)", "gemini-1.5+", "https://ai.google.dev/palm_docs/deprecation"),
    "text-bison": ("retired", "2024 (Vertex AI)", "gemini-1.5+", "https://cloud.google.com/vertex-ai/generative-ai/docs/model-versioning"),
    "chat-bison": ("retired", "2024 (Vertex AI)", "gemini-1.5+", "https://cloud.google.com/vertex-ai/generative-ai/docs/model-versioning"),
}
