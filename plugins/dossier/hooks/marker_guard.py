#!/usr/bin/env python3
"""Claude Code PreToolUse marker guard.

Matcher: Edit | Write | MultiEdit.

Reads hook JSON on stdin. Blocks edits that would land phase/stage/audit
markers (`// Phase 1:`, `// Step N:`, `// V11 (Phase 3 / A7):`, `// PH3-B7`)
inside non-dossier source files. Source must stay phase-agnostic. Phase
tracking belongs in `.scratchpad/dossier/PLAN.md` / `DOSSIER.md §B`.

Exit 0: allow. Exit 2: block + stderr feeds Claude.

Bypass: `DOSSIER_MARKER_GUARD=off`. Use only with written rationale in the
live dossier's §S timeline.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

# Comment-line prefix across the languages dossier covers. The guard only
# fires on lines that start with one of these so phase tokens inside string
# literals or domain code (e.g. `phase1` keys) pass.
COMMENT_PREFIX = r"^\s*(?://+|#+|--|/\*+|\*(?!/)|<!--|;)\s*"

MARKER_PATTERNS: tuple[re.Pattern[str], ...] = (
    # `Phase 1:`, `PHASE 3`, `V11 (Phase 3 / A7)`, etc.
    re.compile(COMMENT_PREFIX + r".*\b(Phase|Stage|Step)\s+\d+\b", re.IGNORECASE),
    # `PH3-B7`, `PH12-A1` audit-id form.
    re.compile(COMMENT_PREFIX + r".*\bPH\d+-[A-Z]\d+\b"),
)

# Paths under these prefixes may carry phase markers freely.
DOSSIER_ALLOW_PREFIXES = (
    ".scratchpad/dossier/",
    ".scratchpad/",
)

# Filenames that are dossier ledgers regardless of location.
DOSSIER_ALLOW_NAMES = {
    "DOSSIER.md",
    "PLAN.md",
    "SPEC.md",
    "AUDIT.md",
    "LENS.md",
}

EDIT_TOOLS = {"Edit", "Write", "MultiEdit"}


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


def find_marker(chunks: list[str]) -> tuple[str, str] | None:
    """Return (offending_line, pattern) on first hit, else None."""
    for chunk in chunks:
        for line in chunk.splitlines():
            for pattern in MARKER_PATTERNS:
                if pattern.search(line):
                    return line.strip(), pattern.pattern
    return None


def block(path: str, line: str) -> int:
    print(
        "\n".join(
            [
                f"dossier marker guard: blocked edit to '{path}'.",
                "",
                f"  offending line: {line}",
                "",
                "Phase / stage / audit-id markers belong in DOSSIER.md §B",
                "(or `.scratchpad/dossier/PLAN.md` if escalated), not in",
                "source files. Source must be phase-agnostic.",
                "",
                "Drop the marker prefix; keep the why-tail (workaround ref,",
                "non-obvious invariant, upstream-bug link) if useful. Move",
                "the phase or audit reference into DOSSIER.md §B as a row.",
                "",
                "Emergency bypass: DOSSIER_MARKER_GUARD=off, with rationale",
                "logged in the live dossier's §S timeline.",
            ]
        ),
        file=sys.stderr,
    )
    return 2


def main() -> int:
    if os.environ.get("DOSSIER_MARKER_GUARD") == "off":
        return 0

    try:
        event = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    file_path, chunks = hook_payload(event)
    if not file_path or not chunks:
        return 0

    if is_dossier_path(file_path):
        return 0

    hit = find_marker(chunks)
    if hit is None:
        return 0

    return block(file_path, hit[0])


if __name__ == "__main__":
    sys.exit(main())
