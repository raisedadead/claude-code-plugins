"""Verify-layer pattern registry (v2).

Broad coverage. Patterns dispatch to generic check functions in verify_lib.py.
Adding a product: add an alias row to verify_authorities.EOL_ALIAS_TO_SLUG.
No code change needed.

Pattern dict shape:
    {
      "ruleName":   str
      "scope":      "all"|"yaml"|"json"|"md"                # nothing else is read
      "path_check": callable(path: str) -> bool | None     # None = scope-only
      "regex":      str                                     # compiled at load time
      "_flags":     int                                     # re flags, default 0
      "check":      callable(...args) -> tuple|None        # from verify_lib
      "check_args": list[int]                               # 1-based regex group indices
      "icon":       str
    }

Those four scope values are the only ones `_scope_ok` branches on, in both
verify_hook.py and verify_sweep.py; every other value falls through to True and
so matches every file. Narrow by file type with path_check instead — the
Dockerfile, Cargo.toml, go.mod and Gemfile rules below all pair scope "all"
with a path_check for exactly that reason.
"""

from __future__ import annotations

import re

from verify_authorities import EOL_ALIAS_TO_SLUG
from verify_lib import (
    check_action_sha,
    check_ai_model,
    check_freetext,
    check_image_tag,
    check_k8s_apiversion,
    check_pkg_outdated,
)


# Build the free-text language regex from the alias map. Longest first.
_ALIASES_SORTED = sorted(EOL_ALIAS_TO_SLUG.keys(), key=lambda s: (-len(s), s))
_ALIAS_ALTERNATION = "|".join(re.escape(a) for a in _ALIASES_SORTED)
# `<alias> v?<digits>[.<digits>[.<digits>]]` — case-insensitive at use site.
_FREETEXT_RE = (
    rf"(?<![A-Za-z0-9._-])({_ALIAS_ALTERNATION})\s*[vV]?(\d+(?:\.\d+){{0,3}})\b"
)


def _p_workflow(p: str) -> bool:
    return ".github/workflows/" in p and p.endswith((".yml", ".yaml"))


def _p_yaml(p: str) -> bool:
    return p.endswith((".yml", ".yaml"))


def _p_pkg_json(p: str) -> bool:
    return p.endswith("package.json")


def _p_requirements(p: str) -> bool:
    name = p.rsplit("/", 1)[-1]
    return (
        name == "requirements.txt"
        or name.startswith("requirements-")
        and name.endswith(".txt")
    )


def _p_pyproject(p: str) -> bool:
    return p.endswith("pyproject.toml") or p.endswith("Pipfile")


def _p_cargo(p: str) -> bool:
    return p.endswith("Cargo.toml")


def _p_gomod(p: str) -> bool:
    return p.endswith("go.mod")


def _p_gemfile(p: str) -> bool:
    name = p.rsplit("/", 1)[-1]
    return name in {"Gemfile", "Gemfile.lock"}


def _p_dockerfile(p: str) -> bool:
    name = p.rsplit("/", 1)[-1]
    return (
        name == "Dockerfile"
        or name.startswith("Dockerfile.")
        or name.endswith(".dockerfile")
        or name.endswith(".Dockerfile")
    )


def _p_compose(p: str) -> bool:
    name = p.rsplit("/", 1)[-1]
    return name in {
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
    }


# Wrappers to bind ecosystem string into check_pkg_outdated (which expects ecosystem as first arg).
def _check_npm(pkg, ver):
    return check_pkg_outdated("npm", pkg, ver)


def _check_pypi(pkg, ver):
    return check_pkg_outdated("pypi", pkg, ver)


def _check_crates(pkg, ver):
    return check_pkg_outdated("crates", pkg, ver)


def _check_rubygems(pkg, ver):
    return check_pkg_outdated("rubygems", pkg, ver)


def _check_go_module(pkg, ver):
    return check_pkg_outdated("go", pkg, ver)


def _check_hex(pkg, ver):
    return check_pkg_outdated("hex", pkg, ver)


VERIFY_PATTERNS = [
    # ── Free-text language/runtime/OS/db claims in any file ────────────
    # "Node 18" / "Python 3.8" / "Ubuntu 20.04" / "Ruby 2.7" / etc.
    {
        "ruleName": "lang_eol_prose",
        "scope": "all",
        "path_check": None,
        "regex": _FREETEXT_RE,
        "_flags": re.IGNORECASE,
        "check": check_freetext,
        "check_args": [1, 2],
        "icon": "⚠",
    },
    # ── Dockerfile / compose / k8s `image:` ─────────────────────────────
    # `FROM <image>:<tag>` — image is repo path; tag often suffixed (-alpine, -slim).
    {
        "ruleName": "docker_image_eol",
        "scope": "all",
        "path_check": lambda p: _p_dockerfile(p) or _p_compose(p) or _p_yaml(p),
        "regex": r"(?:^|\s)(?:FROM|image:)\s+([\w./-]+):([\w.+-]+)",
        "_flags": re.MULTILINE,
        "check": check_image_tag,
        "check_args": [1, 2],
        "icon": "⚠",
    },
    # ── GitHub Action unpinned ─────────────────────────────────────────
    {
        "ruleName": "github_action_unpinned",
        "scope": "yaml",
        "path_check": _p_workflow,
        "regex": r"uses:\s+([\w.-]+/[\w.-]+)@([\w.-]+)\b",
        "check": check_action_sha,
        "check_args": [1, 2],
        "icon": "⚠",
    },
    # ── k8s deprecated apiVersion ──────────────────────────────────────
    {
        "ruleName": "k8s_deprecated_api",
        "scope": "yaml",
        "path_check": _p_yaml,
        "regex": r"apiVersion:\s+([\w./-]+)",
        "check": check_k8s_apiversion,
        "check_args": [1],
        "icon": "⚠",
    },
    # ── npm package.json deps (any of dependencies / devDependencies / peerDeps) ─
    {
        "ruleName": "npm_outdated",
        "scope": "json",
        "path_check": _p_pkg_json,
        "regex": r'"([@\w][\w./-]*)"\s*:\s*"([0-9][\w.+-]*)"',
        "check": _check_npm,
        "check_args": [1, 2],
        "icon": "ℹ",
    },
    # ── PyPI requirements.txt: `<pkg>==<ver>` ──────────────────────────
    {
        "ruleName": "pypi_outdated_reqs",
        "scope": "all",
        "path_check": _p_requirements,
        "regex": r"^\s*([A-Za-z][A-Za-z0-9._-]*)\s*==\s*([0-9][\w.+-]*)",
        "_flags": re.MULTILINE,
        "check": _check_pypi,
        "check_args": [1, 2],
        "icon": "ℹ",
    },
    # ── pyproject.toml [project.dependencies]: `<pkg>==<ver>` or PEP 621 ─
    {
        "ruleName": "pypi_outdated_pyproject",
        "scope": "all",
        "path_check": _p_pyproject,
        "regex": r'"([A-Za-z][A-Za-z0-9._-]*)\s*==\s*([0-9][\w.+-]*)"',
        "check": _check_pypi,
        "check_args": [1, 2],
        "icon": "ℹ",
    },
    # ── Cargo.toml `<pkg> = "<ver>"` (very loose; ignored if version is a range)
    {
        "ruleName": "crates_outdated",
        "scope": "all",
        "path_check": _p_cargo,
        "regex": r'^([a-z][a-z0-9_-]*)\s*=\s*"([0-9][\w.+-]*)"',
        "_flags": re.MULTILINE,
        "check": _check_crates,
        "check_args": [1, 2],
        "icon": "ℹ",
    },
    # ── Gemfile: `gem 'name', '~> 1.2'` or `gem "name", "1.2"`
    {
        "ruleName": "rubygems_outdated",
        "scope": "all",
        "path_check": _p_gemfile,
        "regex": r"""gem\s+['"]([\w.-]+)['"]\s*,\s*['"]([0-9][\w.+-]*)['"]""",
        "check": _check_rubygems,
        "check_args": [1, 2],
        "icon": "ℹ",
    },
    # ── go.mod: `<module> v<ver>` lines under require()
    {
        "ruleName": "go_module_outdated",
        "scope": "all",
        "path_check": _p_gomod,
        "regex": r"^\s*([\w./-]+)\s+v([0-9][\w.+-]*)",
        "_flags": re.MULTILINE,
        "check": _check_go_module,
        "check_args": [1, 2],
        "icon": "ℹ",
    },
    # ── AI model identifiers ───────────────────────────────────────────
    # Matches: model: "X" | model="X" | model_name = "X" | "model": "X"
    {
        "ruleName": "ai_model_deprecated",
        "scope": "all",
        "path_check": None,
        "regex": r"""(?:model(?:_name)?|"model")\s*[=:]\s*['"]([\w.:-]+)['"]""",
        "check": check_ai_model,
        "check_args": [1],
        "icon": "⚠",
    },
]
