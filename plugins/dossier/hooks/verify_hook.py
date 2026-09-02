#!/usr/bin/env python3
"""Verify-layer PreToolUse hook.

Matcher: Edit | Write | MultiEdit.

Reads stdin tool_use JSON, scans tool_input content against VERIFY_PATTERNS,
emits stderr reminders for findings. Non-blocking by default (exit 0).

Dedup: a `<ruleName>:<claim>` fingerprint is reported once per state file, and
       state_file() names that file from CLAUDE_SESSION_ID (falling back to
       `pid-<ppid>` when unset). Repeats within one payload collapse to one
       reminder; a later call in the same session stays silent.
Operator escape: a `# verify-skip: <ruleName>` marker anywhere in the scanned
                 content — own line or trailing a code line — drops that rule
                 for the whole tool call. Position does not matter: matches
                 above the marker are silenced too.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


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


def _is_dossier_path(path: str) -> bool:
    posix = Path(path).as_posix()
    return ".scratchpad/" in posix or Path(path).name in {
        "DOSSIER.md",
        "PLAN.md",
        "SPEC.md",
    }


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

    if not isinstance(payload, dict):
        return 0

    cwd = payload.get("cwd")
    if isinstance(cwd, str) and cwd:
        if not (Path(cwd) / ".scratchpad" / "dossier").is_dir():
            return 0
        os.environ["DOSSIER_SCRATCHPAD_ROOT"] = cwd

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        from verify_lib import load_state, save_state
        from verify_patterns import VERIFY_PATTERNS
    except Exception as exc:  # noqa: BLE001
        print(f"verify-layer load error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 0

    os.environ["DOSSIER_VERIFY_CACHE_ONLY"] = "1"

    tool_name = payload.get("tool_name", "")
    if tool_name not in {"Edit", "Write", "MultiEdit"}:
        return 0

    tool_input = payload.get("tool_input", {}) or {}
    path, content = _extract(tool_input, tool_name)
    if not content:
        return 0

    if _is_dossier_path(path):
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
            if fingerprint in fired or fingerprint in new_fps:
                continue
            new_fps.add(fingerprint)
            reminders.append(
                f"{rule['icon']} verify[{name}] {claim} → {truth} · src: {src}"
            )

    if reminders:
        save_state(fired | new_fps)
        body = (
            "\n".join(reminders)
            + "\nsilence a rule for this write: `# verify-skip: <ruleName>`"
            " anywhere in the content."
        )
        sys.stderr.write(
            f"verify: {len(reminders)} freshness finding(s); see context.\n"
        )
        out = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "additionalContext": body,
            }
        }
        sys.stdout.write(json.dumps(out))

    return 0


if __name__ == "__main__":
    if sys.version_info < (3, 10):
        sys.exit(0)
    sys.exit(main())
