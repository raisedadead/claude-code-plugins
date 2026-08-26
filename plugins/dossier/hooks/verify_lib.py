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
from concurrent.futures import ThreadPoolExecutor
from functools import partial
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
    tmp = p.with_name(f"{p.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps({"fired": sorted(fired)}))
    tmp.replace(p)


def http_cached_status(
    url: str,
    ttl_s: int = CACHE_TTL_DEFAULT,
    quiet: bool = False,
    timeout_s: int = HTTP_TIMEOUT_S,
):
    """JSON GET with TTL cache. Returns (status, data).

    status is "ok", "missing" (the server answered 404/410 — the resource does
    not exist) or "offline" (no usable answer). A caller that walks a namespace
    needs the two failures apart: "missing" ends the walk, "offline" only means
    this run learned nothing. A miss is cached like a hit, so a walk costs one
    round trip per probe per TTL rather than one per run.
    """
    key = hashlib.sha1(url.encode()).hexdigest()
    cache_path = cache_dir() / f"{key}.json"

    if cache_path.is_file():
        try:
            entry = json.loads(cache_path.read_text())
            if time.time() - entry["fetched_at"] < ttl_s:
                data = entry["data"]
                return ("ok", data) if data is not None else ("missing", None)
        except (json.JSONDecodeError, KeyError, OSError):
            pass

    if os.environ.get("DOSSIER_VERIFY_CACHE_ONLY"):
        return "offline", None

    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        if exc.code in (404, 410):
            _cache_write(cache_path, None)
            return "missing", None
        if not quiet:
            print(f"verify offline: {url} (HTTPError {exc.code})", file=sys.stderr)
        return "offline", None
    except (
        urllib.error.URLError,
        json.JSONDecodeError,
        TimeoutError,
        OSError,
    ) as exc:
        if not quiet:
            print(f"verify offline: {url} ({type(exc).__name__})", file=sys.stderr)
        return "offline", None

    _cache_write(cache_path, data)
    return "ok", data


def _cache_write(cache_path: Path, data) -> None:
    tmp = cache_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"fetched_at": time.time(), "data": data}))
    tmp.replace(cache_path)


def http_cached(url: str, ttl_s: int = CACHE_TTL_DEFAULT):
    """JSON GET with TTL cache. Returns None on network / parse error."""
    return http_cached_status(url, ttl_s)[1]


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


def latest_eol(slug: str):
    """Current (non-EOL) release series + exact latest for an endoflife.date product.

    Returns (series, exact_latest, source_url) or None on offline / unknown.
    """
    releases = _eol_releases(slug)
    if not releases:
        return None
    cur = next((r for r in releases if not r.get("isEol")), None)
    if not cur:
        return None
    series = str(cur.get("name", "?"))
    latest = cur.get("latest")
    if isinstance(latest, dict):
        exact = str(latest.get("name", series))
    elif isinstance(latest, str):
        exact = latest
    else:
        exact = series
    return series, exact, f"https://endoflife.date/api/v1/products/{slug}"


def _strip_image_tag(tag: str) -> str:
    """`1.20-alpine` → `1.20`, `22-slim-bullseye` → `22`, `lts` → `lts`."""
    # Split off common suffixes
    for sep in (
        "-alpine",
        "-slim",
        "-bullseye",
        "-bookworm",
        "-buster",
        "-jammy",
        "-noble",
        "-focal",
        "-trusty",
    ):
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
        narrowed = [
            r
            for r in candidates
            if str(r.get("name", "")).startswith(f"{major}.{minor}")
        ]
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


GO_MAJOR_PROBE_MAX = 12
# The proxy resolves an unknown module path against its origin before it can
# answer 404, which overruns HTTP_TIMEOUT_S on the first ask and returns in
# ~0.1s once it has that answer cached. Probed 2026-08-26 against
# proxy.golang.org: github.com/twpayne/chezmoi/v9 timed out at 5s, then
# answered 404 in 0.083s.
GO_MAJOR_PROBE_TIMEOUT_S = 12
_GO_MAJOR_SUFFIX = re.compile(r"/v[0-9]+$")


def _go_probe(module: str, timeout_s: int = HTTP_TIMEOUT_S):
    """(status, (version, url)) for one Go module path. status per http_cached_status."""
    url = PKG_REGISTRY["go"]["url"].format(pkg=module)
    status, data = http_cached_status(url, quiet=True, timeout_s=timeout_s)
    if status != "ok":
        return status, None
    version = _dot_get(data, PKG_REGISTRY["go"]["path"])
    if not isinstance(version, str) or not version:
        return "missing", None
    return "ok", (version, url)


def _go_latest(pkg: str):
    """(version, url, warning) for a Go module, walking its major versions.

    A Go module at major 2 or above carries a `/vN` path suffix
    (https://go.dev/ref/mod#major-version-suffixes), so the unversioned path
    answers with the last v0/v1 release — a real version, and stale by however
    many majors the module has since cut. Probe /v2../vN concurrently and keep
    the highest that resolves; a path that already names its major is answered
    as asked. The proxy fetches from origin on a cold miss and can exceed
    HTTP_TIMEOUT_S, so a probe that times out leaves that major UNKNOWN, not
    absent: the walk reports those in `warning` rather than treating its answer
    as the highest. Majors above GO_MAJOR_PROBE_MAX are never probed.
    """
    probe = partial(_go_probe, timeout_s=GO_MAJOR_PROBE_TIMEOUT_S)
    status, base = probe(pkg)
    if status == "offline" or _GO_MAJOR_SUFFIX.search(pkg):
        return (base[0], base[1], None) if base else None

    majors = list(range(2, GO_MAJOR_PROBE_MAX + 1))
    with ThreadPoolExecutor(max_workers=6) as pool:
        probed = list(pool.map(lambda n: probe(f"{pkg}/v{n}"), majors))

    best, best_major = base, 1
    for major, (probe_status, found) in zip(majors, probed):
        if probe_status == "ok":
            best, best_major = found, major
    unknown = [
        f"/v{major}"
        for major, (probe_status, _) in zip(majors, probed)
        if probe_status == "offline" and major > best_major
    ]
    if not best:
        return None
    # Exclusive by construction: `unknown` needs a major above the answer, and
    # the answer sits on the ceiling in the other branch.
    if unknown:
        warning = f"the go proxy did not answer for {', '.join(unknown)} — a higher major may exist"
    elif best_major == GO_MAJOR_PROBE_MAX:
        warning = f"/v{GO_MAJOR_PROBE_MAX} is the highest major probed — a higher major may exist"
    else:
        warning = None
    return best[0], best[1], warning


def latest_version_detail(ecosystem: str, pkg: str):
    """latest_version plus a warning string when the answer may not be the highest."""
    if ecosystem == "go":
        return _go_latest(pkg)
    res = latest_version(ecosystem, pkg)
    return (res[0], res[1], None) if res else None


def latest_version(ecosystem: str, pkg: str):
    """Registry's current latest version + source URL. Returns (version, url) or None.

    Shared by check_pkg_outdated (reactive) and resolve_pins.py (proactive); both
    hit the same http_cached store, so a version resolved once warms the other.
    """
    eco = PKG_REGISTRY.get(ecosystem)
    if not eco:
        return None
    if ecosystem == "go":
        # The exact path as asked. Walking a module's majors is the proactive
        # resolver's job (latest_version_detail) — this one answers an edit hook.
        return _go_probe(pkg)[1]
    url = eco["url"].format(pkg=pkg)
    if eco["path"] == ["__lookup_packagist_first__"]:
        data = http_cached(url)
        if not isinstance(data, dict):
            return None
        rels = (data.get("packages") or {}).get(pkg) or []
        latest = rels[0].get("version") if rels else None
    else:
        data = http_cached(url)
        latest = _dot_get(data, eco["path"])
        if not isinstance(latest, str) or not latest:
            fallback = eco.get("fallback_path")
            latest = _dot_get(data, fallback) if fallback else None
    if not latest or not isinstance(latest, str):
        return None
    return latest, url


def check_pkg_outdated(ecosystem: str, pkg: str, version_str: str):
    """Pinned package version vs registry latest. Flags only if ≥2 majors behind."""
    v = version_str.lstrip().strip("\"'")
    if v.startswith(("^", "~", ">", "<", "*")) or v in {
        "latest",
        "next",
        "main",
        "master",
        "edge",
    }:
        return None
    pinned_major = _semver_major(v)
    if pinned_major is None:
        return None
    res = latest_version(ecosystem, pkg)
    if not res:
        return None
    latest, url = res
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
    suggestion = (
        f"uses: {repo}@{sha}  # {ref}"
        if sha
        else f"resolve: gh api repos/{repo}/git/refs/tags/{ref}"
    )
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
