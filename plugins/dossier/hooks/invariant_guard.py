#!/usr/bin/env python3
"""Claude Code PreToolUse invariant guard.

Matcher: Edit | Write | MultiEdit.

Blocks (exit 2) an edit whose content matches a project-registered forbidden
pattern — a §V invariant that ds:backprop promoted to a write-time guard for a
high-recurrence bug class. Fail-open by construction: with no registry, an
empty or malformed registry, a bad regex, or an out-of-scope path, it exits 0
and the write proceeds. Only an explicit, in-scope, matching registered pattern
blocks. Escape hatch: DOSSIER_INVARIANT_GUARD=off (log the rationale in §S).

Registry: .dossier/invariant-guards.json (cwd-relative), a JSON list;
    the legacy .scratchpad/dossier/.invariant-guards.json path is still read
of {"id", "pattern", "message", "paths"?}. "paths" is an optional list of fnmatch
globs scoping the guard; absent means every non-dossier source file.
"""

from __future__ import annotations

import fnmatch
import json
import os
import re
import sys
from pathlib import Path

EDIT_TOOLS = {"Edit", "Write", "MultiEdit"}
DOSSIER_ALLOW_PREFIXES = (".scratchpad/dossier/", ".scratchpad/")
DOSSIER_ALLOW_NAMES = {"DOSSIER.md", "PLAN.md", "SPEC.md", "AUDIT.md", "LENS.md"}
REGISTRY_CANDIDATES = (
    Path(".dossier/invariant-guards.json"),
    Path(".scratchpad/dossier/.invariant-guards.json"),
)


def hook_payload(event: dict) -> tuple[str | None, list[str]]:
    """Return (file_path, [content_chunks]) for the incoming tool call."""
    tool_name = event.get("tool_name")
    if tool_name not in EDIT_TOOLS:
        return None, []

    tool_input = event.get("tool_input") or {}
    file_path = tool_input.get("file_path") or tool_input.get("path")

    chunks: list[str] = []
    if tool_name == "Write":
        content = tool_input.get("content")
        if isinstance(content, str):
            chunks.append(content)
    elif tool_name == "Edit":
        new = tool_input.get("new_string")
        if isinstance(new, str):
            chunks.append(new)
    elif tool_name == "MultiEdit":
        for edit in tool_input.get("edits") or []:
            new = (edit or {}).get("new_string")
            if isinstance(new, str):
                chunks.append(new)

    return (str(file_path) if file_path else None), chunks


def is_dossier_path(file_path: str) -> bool:
    posix = Path(file_path).as_posix()
    if any(prefix in posix for prefix in DOSSIER_ALLOW_PREFIXES):
        return True
    return Path(file_path).name in DOSSIER_ALLOW_NAMES


def load_registry() -> list[dict]:
    """Read the guard registry. Returns [] on any read/parse error (fail-open)."""
    data = None
    for candidate in REGISTRY_CANDIDATES:
        try:
            data = json.loads(candidate.read_text(encoding="utf-8"))
            break
        except (OSError, json.JSONDecodeError):
            continue
    if data is None:
        return []
    if not isinstance(data, list):
        return []
    return [entry for entry in data if isinstance(entry, dict)]


def path_in_scope(file_path: str, paths: object) -> bool:
    if not isinstance(paths, list) or not paths:
        return True
    posix = Path(file_path).as_posix()
    return any(fnmatch.fnmatch(posix, g) for g in paths if isinstance(g, str))


def find_violation(
    file_path: str, chunks: list[str], registry: list[dict]
) -> dict | None:
    """Return the first registered entry an in-scope chunk violates, else None."""
    for entry in registry:
        pattern = entry.get("pattern")
        if not isinstance(pattern, str) or not pattern:
            continue
        if not path_in_scope(file_path, entry.get("paths")):
            continue
        try:
            compiled = re.compile(pattern)
        except re.error:
            continue
        if any(compiled.search(chunk) for chunk in chunks):
            return entry
    return None


def block(entry: dict, file_path: str) -> int:
    vid = entry.get("id", "?")
    message = entry.get("message", "")
    sys.stderr.write(
        f"dossier invariant guard: edit to '{file_path}' violates §V {vid}.\n"
        f"  pattern: {entry.get('pattern')}\n"
        f"  {message}\n"
        "  registered by ds:backprop (recurrence=high). Legit edit? set "
        "DOSSIER_INVARIANT_GUARD=off and log the rationale in §S.\n"
    )
    return 2


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    if not isinstance(event, dict):
        return 0

    if os.environ.get("DOSSIER_INVARIANT_GUARD") == "off":
        return 0

    file_path, chunks = hook_payload(event)
    if not file_path or not chunks:
        return 0

    if is_dossier_path(file_path):
        return 0

    registry = load_registry()
    if not registry:
        return 0

    entry = find_violation(file_path, chunks, registry)
    if entry is None:
        return 0

    return block(entry, file_path)


if __name__ == "__main__":
    if sys.version_info < (3, 10):
        sys.exit(0)
    sys.exit(main())
