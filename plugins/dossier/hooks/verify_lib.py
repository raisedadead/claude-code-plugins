"""Verify-layer shared primitives.

Stdlib-only. Python 3.10+. No external deps.

Generic surface (v2):
    cache_dir()             -> Path
    state_file()            -> Path
    load_state()            -> set[str]
    save_state(set)         -> None
    http_cached(url, ttl)   -> dict|list|None

Check functions (each returns (claim, truth, source_url) or None):
    check_eol(slug, version_str)             # endoflife.date
    check_freetext(alias, version_str)        # free-text prose; alias→slug via authorities
    check_pkg_outdated(ecosystem, pkg, ver)   # any package registry
    check_image_tag(image, tag)               # Dockerfile FROM, k8s image:, compose image:
    check_action_sha(repo, ref)               # GitHub Action `uses:` unpinned
    check_k8s_apiversion(matched)             # k8s deprecated apiVersion (static map)
    check_ai_model(model_name)                # AI model deprecation (static map)
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

from verify_authorities import (
    AI_MODEL_DEPRECATED,
    DOCKER_IMAGE_TO_SLUG,
    EOL_ALIAS_TO_SLUG,
    PKG_REGISTRY,
)

CACHE_TTL_DEFAULT = 86400  # 24h for registries / release endpoints
CACHE_TTL_IMMUTABLE = 86400 * 30  # 30d for resolved-tag SHAs
USER_AGENT = "dossier-verify/0.2 (+https://github.com/raisedadead/claude-code-plugins)"
HTTP_TIMEOUT_S = 5


# ─── Infra ─────────────────────────────────────────────────────────────


def cache_dir() -> Path:
    """Per-project HTTP cache root: <cwd>/.scratchpad/.verify-cache/. Falls back to $TMPDIR."""
    root = Path.cwd() / ".scratchpad" / ".verify-cache"
    try:
        root.mkdir(parents=True, exist_ok=True)
        return root
    except OSError:
        fb = Path(os.environ.get("TMPDIR", "/tmp")) / "dossier-verify-cache"
        fb.mkdir(parents=True, exist_ok=True)
        return fb


def state_file() -> Path:
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
    """JSON GET with TTL cache. Returns None on network / parse error."""
    key = hashlib.sha1(url.encode()).hexdigest()
    cache_path = cache_dir() / f"{key}.json"

    if cache_path.is_file():
        try:
            entry = json.loads(cache_path.read_text())
            if time.time() - entry["fetched_at"] < ttl_s:
                return entry["data"]
        except (json.JSONDecodeError, KeyError, OSError):
            pass

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


# ─── Generic helpers ───────────────────────────────────────────────────


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


def _strip_image_tag(tag: str) -> str:
    """`1.20-alpine` → `1.20`, `22-slim-bullseye` → `22`, `lts` → `lts`."""
    # Split off common suffixes
    for sep in ("-alpine", "-slim", "-bullseye", "-bookworm", "-buster", "-jammy", "-noble", "-focal", "-trusty"):
        if tag.endswith(sep):
            tag = tag[: -len(sep)]
            break
    # If still has '-', take part before first '-'
    if "-" in tag and not tag.startswith("v"):
        tag = tag.split("-", 1)[0]
    return tag


def _dot_get(data, path):
    cur = data
    for k in path:
        if isinstance(k, str) and isinstance(cur, dict):
            cur = cur.get(k)
        elif isinstance(k, int) and isinstance(cur, list) and -len(cur) <= k < len(cur):
            cur = cur[k]
        else:
            return None
        if cur is None:
            return None
    return cur


def _normalize_alias(s: str) -> str:
    return s.lower().replace(".", "").replace(" ", "").replace("_", "")


def _alias_to_slug(alias: str) -> str | None:
    direct = EOL_ALIAS_TO_SLUG.get(alias.lower())
    if direct:
        return direct
    return EOL_ALIAS_TO_SLUG.get(_normalize_alias(alias))


# ─── Generic check functions ───────────────────────────────────────────


def check_eol(slug: str, version_str: str):
    """Flag if `slug v<version>` lands on an EOL release."""
    releases = _eol_releases(slug)
    if not releases:
        return None
    parts = version_str.lstrip("vV").split(".")
    if not parts or not parts[0].isdigit():
        return None
    major = parts[0]
    minor = parts[1] if len(parts) > 1 and parts[1].isdigit() else None

    # Find best-match release (most-specific prefix match).
    candidates = [r for r in releases if str(r.get("name", "")).startswith(major)]
    if minor:
        narrowed = [r for r in candidates if str(r.get("name", "")).startswith(f"{major}.{minor}")]
        if narrowed:
            candidates = narrowed
    if not candidates:
        return None
    rel = candidates[0]
    if not rel.get("isEol"):
        return None

    # Find a current (non-EOL) latest for the replacement suggestion.
    current = next((r.get("name") for r in releases if not r.get("isEol")), "?")
    eol_date = rel.get("eolFrom") or rel.get("eol") or "?"
    return (
        f"{slug} {version_str}",
        f"current: {slug} {current}. v{rel.get('name')} EOL {eol_date}.",
        f"https://endoflife.date/api/v1/products/{slug}",
    )


def check_freetext(alias: str, version_str: str):
    """Free-text claim like 'Node 18' / 'Python 3.8'. Alias → slug → check_eol."""
    slug = _alias_to_slug(alias)
    if not slug:
        return None
    finding = check_eol(slug, version_str)
    if not finding:
        return None
    # Replace claim string with caller's exact phrasing.
    _, truth, src = finding
    return (f"{alias} {version_str}", truth, src)


def check_pkg_outdated(ecosystem: str, pkg: str, version_str: str):
    """Pinned package version vs registry latest. Flags only if ≥2 majors behind."""
    eco = PKG_REGISTRY.get(ecosystem)
    if not eco:
        return None
    v = version_str.lstrip().strip('"\'')
    if v.startswith(("^", "~", ">", "<", "*")) or v in {"latest", "next", "main", "master", "edge"}:
        return None
    pinned_major = _semver_major(v)
    if pinned_major is None:
        return None

    url = eco["url"].format(pkg=pkg)
    if eco["path"] == ["__lookup_packagist_first__"]:
        # Packagist: data.packages.<pkg>[0].version
        data = http_cached(url)
        if not isinstance(data, dict):
            return None
        packages = data.get("packages") or {}
        rels = packages.get(pkg) or []
        latest = rels[0].get("version") if rels else None
    else:
        data = http_cached(url)
        latest = _dot_get(data, eco["path"])
    if not latest or not isinstance(latest, str):
        return None
    latest_major = _semver_major(latest)
    if latest_major is None or pinned_major >= latest_major - 1:
        return None
    return (
        f"{ecosystem}:{pkg}@{version_str}",
        f"{pkg}@{latest} (latest)",
        url,
    )


def _semver_major(v: str) -> int | None:
    s = v.strip().lstrip("v").lstrip("^~>=<*")
    if not s or s in {"latest", "next", "*"}:
        return None
    head = s.split(".", 1)[0]
    if not head.isdigit():
        return None
    return int(head)


def check_image_tag(image: str, tag: str):
    """Container image FROM `<image>:<tag>` — flag if tag's release is EOL."""
    if not tag or tag in {"latest", "stable", "main", "edge"}:
        return None  # symbolic tags = operator-opted-in to drift
    slug = DOCKER_IMAGE_TO_SLUG.get(image.lower())
    if not slug:
        return None
    stripped = _strip_image_tag(tag)
    finding = check_eol(slug, stripped)
    if not finding:
        return None
    _, truth, src = finding
    return (
        f"FROM {image}:{tag}",
        truth,
        src,
    )


def check_action_sha(repo: str, ref: str):
    """GitHub Action `uses: <repo>@<ref>` — flag unless ref is SHA-pinned (7+ hex)."""
    if re.fullmatch(r"[0-9a-f]{7,40}", ref):
        return None
    api = f"https://api.github.com/repos/{repo}/git/refs/tags/{ref}"
    data = http_cached(api, ttl_s=CACHE_TTL_IMMUTABLE)
    sha = data.get("object", {}).get("sha", "") if isinstance(data, dict) else ""
    suggestion = f"uses: {repo}@{sha}  # {ref}" if sha else f"resolve: gh api repos/{repo}/git/refs/tags/{ref}"
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
    "autoscaling/v2beta1": "autoscaling/v2",
    "autoscaling/v2beta2": "autoscaling/v2",
    "storage.k8s.io/v1beta1": "storage.k8s.io/v1",
    "node.k8s.io/v1beta1": "node.k8s.io/v1",
    "scheduling.k8s.io/v1beta1": "scheduling.k8s.io/v1",
    "certificates.k8s.io/v1beta1": "certificates.k8s.io/v1",
    "events.k8s.io/v1beta1": "events.k8s.io/v1",
    "coordination.k8s.io/v1beta1": "coordination.k8s.io/v1",
}


def check_k8s_apiversion(matched: str):
    if matched not in _K8S_DEPRECATED:
        return None
    return (
        f"apiVersion: {matched}",
        f"apiVersion: {_K8S_DEPRECATED[matched]}",
        "https://kubernetes.io/docs/reference/using-api/deprecation-guide/",
    )


def check_ai_model(model_name: str):
    """AI model identifier vs vendor deprecation list."""
    if not model_name:
        return None
    norm = model_name.strip().strip("'\"")
    entry = AI_MODEL_DEPRECATED.get(norm) or AI_MODEL_DEPRECATED.get(norm.lower())
    if not entry:
        return None
    status, when, replacement, src = entry
    return (
        f"model: {model_name}",
        f"{status} ({when}). use: {replacement}",
        src,
    )


# ─── Legacy shims for older imports ────────────────────────────────────


def check_node_lts(major_str: str):
    """Backward-compat shim — delegates to check_eol('nodejs', ...).

    Kept so older verify_patterns.py imports still work during migration.
    """
    finding = check_eol("nodejs", major_str)
    if finding:
        _, truth, src = finding
        return (f"Node v{major_str}", truth, src)
    return None


def check_k8s_api(matched: str):
    """Backward-compat shim → check_k8s_apiversion."""
    return check_k8s_apiversion(matched)


def check_npm_outdated(pkg: str, version: str):
    """Backward-compat shim → check_pkg_outdated('npm', ...)."""
    return check_pkg_outdated("npm", pkg, version)
