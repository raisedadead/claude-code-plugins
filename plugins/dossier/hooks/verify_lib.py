"""Verify-layer shared primitives.

Stdlib-only. Python 3.10+. No external deps.

Surface:
    cache_dir()           -> Path           # per-project HTTP cache root
    state_file()          -> Path           # per-session dedup ledger
    load_state()          -> set[str]       # fingerprints fired this session
    save_state(set)       -> None
    http_cached(url, ttl) -> dict|list|None # JSON GET, cached, network-fault-tolerant
    check_node_lts(major) -> tuple|None     # Node LTS check vs endoflife.date
    check_action_sha(repo, ref) -> tuple|None
    check_k8s_api(matched)      -> tuple|None

Each check_*() returns (claim, truth, source_url) on finding, else None.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CACHE_TTL_DEFAULT = 86400  # 24h for registry/release endpoints
CACHE_TTL_IMMUTABLE = 86400 * 30  # 30d for resolved-tag SHAs
USER_AGENT = "dossier-verify/0.1 (+https://github.com/raisedadead/claude-code-plugins)"
HTTP_TIMEOUT_S = 5


def cache_dir() -> Path:
    """Per-project HTTP cache root: <cwd>/.scratchpad/.verify-cache/.

    Falls back to $TMPDIR if .scratchpad unwritable.
    """
    root = Path.cwd() / ".scratchpad" / ".verify-cache"
    try:
        root.mkdir(parents=True, exist_ok=True)
        return root
    except OSError:
        fb = Path(os.environ.get("TMPDIR", "/tmp")) / "dossier-verify-cache"
        fb.mkdir(parents=True, exist_ok=True)
        return fb


def state_file() -> Path:
    """Per-session dedup ledger. Keyed by $CLAUDE_SESSION_ID or PPID."""
    sid = os.environ.get("CLAUDE_SESSION_ID") or f"pid-{os.getppid()}"
    sid_safe = re.sub(r"[^A-Za-z0-9_.-]", "_", sid)
    return cache_dir() / f"state-{sid_safe}.json"


def load_state() -> set[str]:
    p = state_file()
    if not p.is_file():
        return set()
    try:
        return set(json.loads(p.read_text()).get("fired", []))
    except (json.JSONDecodeError, OSError, KeyError):
        return set()


def save_state(fired: set[str]) -> None:
    p = state_file()
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps({"fired": sorted(fired)}))
    tmp.replace(p)


def http_cached(url: str, ttl_s: int = CACHE_TTL_DEFAULT):
    """JSON GET with TTL cache. Returns None on network / parse error.

    Cache key = sha1(url). Atomic tmp+rename writes.
    """
    key = hashlib.sha1(url.encode()).hexdigest()
    cache_path = cache_dir() / f"{key}.json"

    if cache_path.is_file():
        try:
            entry = json.loads(cache_path.read_text())
            if time.time() - entry["fetched_at"] < ttl_s:
                return entry["data"]
        except (json.JSONDecodeError, KeyError, OSError):
            pass  # cache poisoned, refetch

    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
            data = json.loads(resp.read().decode())
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError, OSError) as exc:
        print(f"verify offline: {url} ({type(exc).__name__})", file=sys.stderr)
        return None

    tmp = cache_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"fetched_at": time.time(), "data": data}))
    tmp.replace(cache_path)
    return data


# ─── Authority checks ─────────────────────────────────────────────────────


def _eol_releases(slug: str):
    """Normalize endoflife.date response to list of release dicts."""
    data = http_cached(f"https://endoflife.date/api/v1/products/{slug}")
    if not data:
        return []
    if isinstance(data, dict):
        return data.get("result", {}).get("releases", []) or []
    if isinstance(data, list):
        return data  # legacy v0 array shape
    return []


def check_node_lts(major_str: str):
    """Claimed Node major vs endoflife.date current LTS list.

    Returns (claim, truth, src) if claim is not in the LTS-and-maintained set, else None.
    """
    try:
        major = int(major_str)
    except (ValueError, TypeError):
        return None
    releases = _eol_releases("nodejs")
    if not releases:
        return None
    # Filter: LTS AND not EOL. `isMaintained` alone is too broad (true on EOL'd lines too).
    lts = [r.get("name", "") for r in releases if r.get("isLts") and not r.get("isEol")]
    if not lts:
        return None
    if str(major) in lts:
        return None
    return (
        f"Node v{major}",
        f"current LTS: {', '.join('v' + v for v in lts)}",
        "https://endoflife.date/api/v1/products/nodejs",
    )


def check_action_sha(repo: str, ref: str):
    """GitHub Action `uses: <repo>@<ref>` — flag unless ref is SHA-pinned (7+ hex).

    Returns (claim, suggested-pin, src). Always fires for tag/branch refs;
    resolves SHA on a best-effort basis.
    """
    if re.fullmatch(r"[0-9a-f]{7,40}", ref):
        return None
    api = f"https://api.github.com/repos/{repo}/git/refs/tags/{ref}"
    data = http_cached(api, ttl_s=CACHE_TTL_IMMUTABLE)
    if isinstance(data, dict):
        sha = data.get("object", {}).get("sha", "")
    else:
        sha = ""
    suggestion = f"uses: {repo}@{sha}  # {ref}" if sha else f"resolve via: gh api repos/{repo}/git/refs/tags/{ref}"
    return (
        f"uses: {repo}@{ref}",
        suggestion,
        "https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions",
    )


_K8S_DEPRECATED = {
    "extensions/v1beta1": "networking.k8s.io/v1 (Ingress) or apps/v1 (Deployment/RS/DS)",
    "apps/v1beta1": "apps/v1",
    "apps/v1beta2": "apps/v1",
    "batch/v1beta1": "batch/v1",
    "policy/v1beta1": "policy/v1",
    "rbac.authorization.k8s.io/v1beta1": "rbac.authorization.k8s.io/v1",
    "networking.k8s.io/v1beta1": "networking.k8s.io/v1",
}


def check_k8s_api(matched: str):
    """Static map of deprecated k8s apiVersion → current GA equivalent."""
    if matched not in _K8S_DEPRECATED:
        return None
    return (
        f"apiVersion: {matched}",
        f"apiVersion: {_K8S_DEPRECATED[matched]}",
        "https://kubernetes.io/docs/reference/using-api/deprecation-guide/",
    )


def _semver_major(v: str) -> int | None:
    """Extract integer major from a version string. Returns None for ranges/symbolic."""
    s = v.strip().lstrip("v").lstrip("^~>=<*")
    if not s or s in {"latest", "next", "*"}:
        return None
    head = s.split(".", 1)[0]
    try:
        return int(head)
    except ValueError:
        return None


def check_npm_outdated(pkg: str, version: str):
    """npm `<pkg>": "<version>"` — flag only if pinned major is ≥2 behind latest.

    Skip exact `latest` / `next` / `*` / range operators (range = operator opt-in to drift).
    """
    if version.lstrip().startswith(("^", "~", ">", "<", "*")) or version in {"latest", "next"}:
        return None
    pinned = _semver_major(version)
    if pinned is None:
        return None
    data = http_cached(f"https://registry.npmjs.org/{pkg}/latest")
    if not data or not isinstance(data, dict):
        return None
    latest = data.get("version", "")
    latest_major = _semver_major(latest)
    if latest_major is None or pinned >= latest_major - 1:
        return None
    return (
        f"{pkg}@{version}",
        f"{pkg}@{latest} (latest)",
        f"https://registry.npmjs.org/{pkg}",
    )
