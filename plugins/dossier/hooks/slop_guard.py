#!/usr/bin/env python3
"""Default-off slop gate (PreToolUse: Edit | Write | MultiEdit).

Enabled only when DOSSIER_SLOP_GATE is truthy. Denies an edit whose NEW content
introduces a placeholder marker (TODO / FIXME / XXX / HACK) or a hardcoded weak
secret literal. Inert (exit 0) when disabled, so it ships safely default-off to
every dossier user. Markdown targets are skipped (placeholders are legitimate in
docs). Enforcement layers under, never duplicates, dossier-reviewer's judgement.
"""

from __future__ import annotations

import json
import os
import re
import sys

_MARKERS = re.compile(r"\b(TODO|FIXME|XXX|HACK)\b")
_WEAK_SECRET = re.compile(
    r"""(?ix)
    (password|passwd|secret|api[_-]?key|token)
    \s*[:=]\s*
    ['"][^'"\s]{3,}['"]
    """
)
_ENABLED_VALUES = {"1", "true", "yes", "on"}


def _enabled() -> bool:
    return os.environ.get("DOSSIER_SLOP_GATE", "").strip().lower() in _ENABLED_VALUES


def _new_content(tool_name: str, tool_input: dict) -> str:
    if tool_name == "Write":
        return str(tool_input.get("content", ""))
    if tool_name == "Edit":
        return str(tool_input.get("new_string", ""))
    if tool_name == "MultiEdit":
        return "\n".join(
            str(edit.get("new_string", ""))
            for edit in tool_input.get("edits", []) or []
            if isinstance(edit, dict)
        )
    return ""


def _deny(reason: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
    sys.exit(0)


def main() -> None:
    if not _enabled():
        sys.exit(0)
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)
    tool_name = data.get("tool_name", "")
    if tool_name not in {"Edit", "Write", "MultiEdit"}:
        sys.exit(0)
    tool_input = data.get("tool_input", {}) or {}
    path = str(tool_input.get("file_path") or tool_input.get("path") or "")
    if path.endswith((".md", ".mdc", ".markdown")):
        sys.exit(0)
    content = _new_content(tool_name, tool_input)
    if _MARKERS.search(content):
        _deny(
            "slop gate: placeholder marker (TODO/FIXME/XXX/HACK) in new content — "
            "finish or remove it. Unset DOSSIER_SLOP_GATE to disable."
        )
    if _WEAK_SECRET.search(content):
        _deny(
            "slop gate: hardcoded secret literal in new content — use an env var or "
            "secret store. Unset DOSSIER_SLOP_GATE to disable."
        )
    sys.exit(0)


if __name__ == "__main__":
    main()
