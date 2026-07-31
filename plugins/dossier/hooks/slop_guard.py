#!/usr/bin/env python3
"""Slop gate (PreToolUse: Edit | Write | MultiEdit) — dossier workflow policy.

Denies an edit whose NEW content introduces a placeholder marker (TODO / FIXME /
XXX / HACK) or a hardcoded weak secret literal. Enabled by default; set
DOSSIER_SLOP_GATE=0 (or false/no/off) to disable. Markdown targets are skipped
(placeholders are legitimate in docs). Enforcement layers under, never
duplicates, dossier-reviewer's judgement.

Scoped to a running wave: this is a policy about how dossier work is done, not
a universal opinion about source, so it stays silent unless the session's cwd
holds a dossier in state live or paused. A closed or archived wave switches it
back off. Sibling guards gate on the directory alone; this one is stricter
because an unfinished marker is only slop relative to a wave that promised to
finish it.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

_MARKERS = re.compile(r"\b(TODO|FIXME|XXX|HACK)\b")
_WEAK_SECRET = re.compile(
    r"""(?ix)
    (password|passwd|secret|api[_-]?key|token)
    \s*[:=]\s*
    ['"][^'"\s]{3,}['"]
    """
)
_DISABLED_VALUES = {"0", "false", "no", "off"}


def _enabled() -> bool:
    return os.environ.get("DOSSIER_SLOP_GATE", "").strip().lower() not in _DISABLED_VALUES


def _dossier_active(event: dict) -> bool:
    """True when a live or paused wave is running in the session's cwd.

    Undeterminable state resolves to True: an absent cwd or a broken import is
    a defect, and silently switching a gate off is the worse failure.
    """
    cwd = event.get("cwd")
    if not isinstance(cwd, str) or not cwd:
        return True
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        from dossier_header import has_active_dossier
    except Exception as exc:  # noqa: BLE001
        print(f"slop gate: state probe failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return True
    return has_active_dossier(cwd)


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
    if not _dossier_active(data):
        sys.exit(0)
    tool_input = data.get("tool_input", {}) or {}
    path = str(tool_input.get("file_path") or tool_input.get("path") or "")
    if path.endswith((".md", ".mdc", ".markdown")):
        sys.exit(0)
    content = _new_content(tool_name, tool_input)
    if _MARKERS.search(content):
        _deny(
            "slop gate: placeholder marker (TODO/FIXME/XXX/HACK) in new content — "
            "finish or remove it. Set DOSSIER_SLOP_GATE=0 to disable."
        )
    if _WEAK_SECRET.search(content):
        _deny(
            "slop gate: hardcoded secret literal in new content — use an env var or "
            "secret store. Set DOSSIER_SLOP_GATE=0 to disable."
        )
    sys.exit(0)


if __name__ == "__main__":
    main()
