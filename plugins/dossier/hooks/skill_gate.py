#!/usr/bin/env python3
"""Non-blocking breadcrumb when a built-in review skill fires mid-build.

PreToolUse (Skill) + UserPromptExpansion hook. When /review, /security-review,
or /simplify is invoked while a live dossier has a ds:build in flight
(.ds-lock present), emits additionalContext reminding to fold the verdict into
the step 6.5 artifact trail and §S. Always exit 0; fail-open on any parse or
filesystem error. Payload field names are INFERRED by composition — the
assistant-side tool_use transcript shape ({"skill", "args"}) plus the
tool_name/tool_input wrapper convention the sibling Edit/Write hooks receive —
NOT captured from a live Skill/UserPromptExpansion hook stdin (none observed
as of Claude Code 2.1.205). A shape mismatch silently disables this breadcrumb
(unknown shapes are a no-op by design); re-verify on harness bumps.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

BUILTINS = {"review", "security-review", "simplify"}


def _state_path(session: str) -> Path:
    safe = "".join(c for c in session if c.isalnum() or c in "-_") or "default"
    return Path(tempfile.gettempdir()) / f"ds-skill-gate-{safe}"


def _flight(cwd: str) -> str | None:
    root = Path(cwd) / ".scratchpad"
    try:
        index = (root / "INDEX.md").read_text(encoding="utf-8")
    except OSError:
        return None
    live: set[str] = set()
    for line in index.splitlines():
        cells = [c.strip() for c in line.split("|")]
        if len(cells) > 3 and cells[3] == "live":
            live.add(f"{cells[1]}-{cells[2]}")
    if not live:
        return None
    for lock in sorted((root / "dossier").glob("*/.ds-lock")):
        key = lock.parent.name
        if key not in live:
            continue
        try:
            data = json.loads(lock.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return key
        if not isinstance(data, dict):
            return key
        return f"{key}: {data.get('skill', '?')} {data.get('target', '?')}"
    return None


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return 0
    if not isinstance(payload, dict):
        return 0

    tool_input = payload.get("tool_input") or {}
    name = ""
    if isinstance(tool_input, dict):
        name = str(tool_input.get("skill") or tool_input.get("name") or "")
    if not name:
        name = str(payload.get("command") or "")
    if name not in BUILTINS:
        return 0

    cwd = str(payload.get("cwd") or "")
    if not cwd:
        return 0
    flight = _flight(cwd)
    if not flight:
        return 0

    session = str(payload.get("session_id") or "")
    state = _state_path(session) if session else None
    key = f"skill-gate:{name}"
    if state is not None:
        try:
            if key in state.read_text(encoding="utf-8").splitlines():
                return 0
        except OSError:
            pass

    event = str(payload.get("hook_event_name") or "PreToolUse")
    body = (
        f"live dossier build in flight ({flight}) — fold /{name} findings into "
        "the ds:build step 6.5 artifact trail and record the verdict in §S. "
        "Reminder only, never blocking."
    )
    sys.stdout.write(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": event,
                    "additionalContext": body,
                }
            }
        )
    )
    if state is not None:
        try:
            with state.open("a", encoding="utf-8") as fh:
                fh.write(key + "\n")
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
