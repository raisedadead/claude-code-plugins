#!/usr/bin/env python3
"""Non-blocking breadcrumb when review-family or whetstone skills fire.

PreToolUse (Skill) + UserPromptExpansion hook, two branches:
- Built-ins (/review, /security-review, /simplify): fire only while a live
  dossier has a ds:build in flight (.ds-lock present) — reminder routes the
  verdict into the step 6.5 artifact trail + §S.
- Whetstone skills: fire on ANY live dossier, lock or not — reminder: record
  the §S line that skill's own rule calls for via lib-s-append.sh (first live
  row = current; main thread writes, never subagents). Matched against the
  WHETSTONE allowlist below, not the `whetstone:` prefix, so an unlisted
  whetstone: name is a no-op; test_skill_gate.sh pins that allowlist to one
  entry per directory under plugins/whetstone/skills/.
Always exit 0; fail-open on any parse or filesystem error. Payload field names are INFERRED by composition — the
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
WHETSTONE = {
    "whetstone:doubt-pass",
    "whetstone:flaky-test-audit",
    "whetstone:merge-resolve",
    "whetstone:skill-smith",
    "whetstone:tdd-cycle",
    "whetstone:tiger-style",
}


def _state_path(session: str) -> Path:
    safe = "".join(c for c in session if c.isalnum() or c in "-_") or "default"
    return Path(tempfile.gettempdir()) / f"ds-skill-gate-{safe}"


def _dossier_state(cwd: str) -> tuple[str | None, str | None]:
    root = Path(cwd) / ".scratchpad"
    try:
        index = (root / "INDEX.md").read_text(encoding="utf-8")
    except OSError:
        return None, None
    live: list[str] = []
    for line in index.splitlines():
        cells = [c.strip() for c in line.split("|")]
        if len(cells) > 3 and cells[3] == "live":
            live.append(f"{cells[1]}-{cells[2]}")
    if not live:
        return None, None
    for lock in sorted((root / "dossier").glob("*/.ds-lock")):
        key = lock.parent.name
        if key not in live:
            continue
        try:
            data = json.loads(lock.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return live[0], key
        if not isinstance(data, dict):
            return live[0], key
        return live[0], f"{key}: {data.get('skill', '?')} {data.get('target', '?')}"
    return live[0], None


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
    if name not in BUILTINS and name not in WHETSTONE:
        return 0

    cwd = str(payload.get("cwd") or "")
    if not cwd:
        return 0
    live_first, flight = _dossier_state(cwd)
    if name in BUILTINS and not flight:
        return 0
    if name in WHETSTONE and not live_first:
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
    if name in BUILTINS:
        body = (
            f"live dossier build in flight ({flight}) — fold /{name} findings into "
            "the ds:build step 6.5 artifact trail and record the verdict in §S. "
            "Reminder only, never blocking."
        )
    else:
        body = (
            f"live dossier ({live_first}) — after this skill's verdict, record the "
            "§S line this skill's own rule calls for via dossier's lib-s-append.sh "
            "(first live row = current; main thread writes, never subagents). "
            "Reminder only, never blocking."
        )
    sys.stdout.write(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": event,
                    "additionalContext": body,
                }
            },
            ensure_ascii=False,
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
