#!/usr/bin/env python3
"""Verify-layer PreToolUse hook.

Matcher: Edit | Write | MultiEdit.

Reads stdin tool_use JSON, scans tool_input content against VERIFY_PATTERNS,
emits stderr reminders for findings. Non-blocking by default (exit 0).

Session-dedup: same finding fires once per CLAUDE_SESSION_ID.
Operator escape: `# verify-skip: <ruleName>` on a line suppresses that rule
                 on the next match for the same fingerprint.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

# Make sibling modules importable when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from verify_lib import load_state, save_state
    from verify_patterns import VERIFY_PATTERNS
except Exception as exc:  # noqa: BLE001
    # Never block a tool call due to verify-layer failure.
    print(f"verify-layer load error: {type(exc).__name__}: {exc}", file=sys.stderr)
    sys.exit(0)


def _extract(tool_input: dict, tool_name: str) -> tuple[str, str]:
    """Pull (file_path, content) from the tool_input payload across Edit/Write/MultiEdit shapes."""
    path = tool_input.get("file_path") or tool_input.get("path") or ""
    if tool_name == "Write":
        return path, str(tool_input.get("content", ""))
    if tool_name == "Edit":
        return path, str(tool_input.get("new_string", ""))
    if tool_name == "MultiEdit":
        edits = tool_input.get("edits", []) or []
        parts = [str(e.get("new_string", "")) for e in edits if isinstance(e, dict)]
        return path, "\n".join(parts)
    return path, ""


def _scope_ok(scope: str, path: str) -> bool:
    if scope == "all":
        return True
    if scope == "yaml":
        return path.endswith((".yml", ".yaml"))
    if scope == "json":
        return path.endswith(".json")
    if scope == "md":
        return path.endswith(".md")
    return True


_SKIP_LINE = re.compile(r"#\s*verify-skip:\s*([\w,-]+)")


def _skip_set(content: str) -> set[str]:
    """Collect rule names suppressed via `# verify-skip: <rule>[,<rule>...]` lines."""
    out: set[str] = set()
    for m in _SKIP_LINE.finditer(content):
        for name in m.group(1).split(","):
            name = name.strip()
            if name:
                out.add(name)
    return out


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        return 0

    tool_name = payload.get("tool_name", "")
    if tool_name not in {"Edit", "Write", "MultiEdit"}:
        return 0

    tool_input = payload.get("tool_input", {}) or {}
    path, content = _extract(tool_input, tool_name)
    if not content:
        return 0

    skipped = _skip_set(content)
    fired = load_state()
    reminders: list[str] = []
    new_fps: set[str] = set()

    for rule in VERIFY_PATTERNS:
        name = rule["ruleName"]
        if name in skipped:
            continue
        if not _scope_ok(rule.get("scope", "all"), path):
            continue
        pc = rule.get("path_check")
        if pc and path and not pc(path):
            continue

        try:
            pattern = re.compile(rule["regex"], rule.get("_flags", 0))
        except re.error:
            continue

        for m in pattern.finditer(content):
            try:
                args = [m.group(i) for i in rule["check_args"]]
            except IndexError:
                continue
            try:
                finding = rule["check"](*args)
            except Exception:  # noqa: BLE001
                finding = None
            if not finding:
                continue
            claim, truth, src = finding
            fingerprint = f"{name}:{claim}"
            if fingerprint in fired:
                continue
            new_fps.add(fingerprint)
            reminders.append(
                f"{rule['icon']} verify[{name}] {claim} → {truth}\n   src: {src}\n"
                f"   skip: `# verify-skip: {name}`"
            )

    if reminders:
        sys.stderr.write("\n".join(reminders) + "\n")
        save_state(fired | new_fps)
        out = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "additionalContext": "\n".join(reminders),
            }
        }
        sys.stdout.write(json.dumps(out))

    return 0


if __name__ == "__main__":
    sys.exit(main())
