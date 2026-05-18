"""Verify-layer pattern registry.

Patterns-as-data. One dict per rule. No DSL. No regex compiler.

Shape:
    {
      "ruleName":   str    # stable id; appears in `# verify-skip: <name>` inline comment
      "scope":      "all" | "yaml" | "json" | "md"
      "path_check": callable(path: str) -> bool   # optional; None = always-on for scope
      "regex":      str    # compiled inside hook
      "check":      callable  # returns (claim, truth, source_url) or None
      "check_args": list[int]  # 1-based regex group indices passed positionally to check()
      "icon":       str
    }

Importer expects verify_lib to be on sys.path (hook prepends its own dir).
"""
from __future__ import annotations

from verify_lib import check_action_sha, check_k8s_api, check_node_lts


def _path_is_workflow(p: str) -> bool:
    return ".github/workflows/" in p and p.endswith((".yml", ".yaml"))


def _path_is_yaml(p: str) -> bool:
    return p.endswith((".yml", ".yaml"))


VERIFY_PATTERNS = [
    {
        "ruleName": "node_lts_version",
        "scope": "all",
        "path_check": None,
        "regex": r"\bnode(?:js)?\s*v?(\d{1,3})\b",
        "check": check_node_lts,
        "check_args": [1],
        "icon": "⚠",
    },
    {
        "ruleName": "github_action_unpinned",
        "scope": "yaml",
        "path_check": _path_is_workflow,
        "regex": r"uses:\s+([\w.-]+/[\w.-]+)@([\w.-]+)\b",
        "check": check_action_sha,
        "check_args": [1, 2],
        "icon": "⚠",
    },
    {
        "ruleName": "k8s_deprecated_api",
        "scope": "yaml",
        "path_check": _path_is_yaml,
        "regex": r"apiVersion:\s+([\w./-]+)",
        "check": check_k8s_api,
        "check_args": [1],
        "icon": "⚠",
    },
]
