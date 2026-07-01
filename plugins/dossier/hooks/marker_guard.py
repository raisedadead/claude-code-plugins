#!/usr/bin/env python3
"""Claude Code PreToolUse marker guard.

Matcher: Edit | Write | MultiEdit.

Reads hook JSON on stdin. Flags edits that would land a dossier audit-id
marker (`// PH3-B7`, `# PH12-A1`) inside non-dossier source files — phase
tracking belongs in `DOSSIER.md §B`, not source. Advisory only: never
blocks. Emits a PreToolUse `additionalContext` nudge and exits 0 so the
write proceeds. Bare `Phase|Stage|Step N` words are deliberately NOT
flagged — they collide with legitimate infra/CI/shell comments
(`# Step 1: dump`).

Always exits 0. Bypass: `DOSSIER_MARKER_GUARD=off`.
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

CANONICAL_STATES = frozenset({"live", "done", "paused"})
HEADER_RE = re.compile(r"^`[^`]*`\s+\S+\s+`([^`]*)`")


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


def check_header_token(file_path: str, chunks: list[str]) -> str | None:
    """Return a non-canonical header state token a chunk would write, else None."""
    if Path(file_path).name != "DOSSIER.md":
        return None
    for chunk in chunks:
        for line in chunk.splitlines():
            m = HEADER_RE.match(line)
            if m:
                token = m.group(1).strip()
                if token and token not in CANONICAL_STATES:
                    return token
    return None


def find_marker(chunks: list[str]) -> tuple[str, str] | None:
    """Return (offending_line, pattern) on first hit, else None."""
    for chunk in chunks:
        for line in chunk.splitlines():
            for pattern in MARKER_PATTERNS:
                if pattern.search(line):
                    return line.strip(), pattern.pattern
    return None


def advise(path: str, line: str) -> int:
    reason = "\n".join(
        [
            f"dossier marker guard: '{path}' carries a dossier audit-id marker.",
            f"  offending line: {line}",
            "",
            "Audit-id markers (`PH3-B7`) belong in DOSSIER.md §B as a row, not",
            "in source. Drop the marker; keep any why-tail (workaround ref,",
            "invariant, upstream-bug link). Advisory only — the write proceeds.",
        ]
    )
    out = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "additionalContext": reason,
        }
    }
    print(json.dumps(out))
    return 0


def main() -> int:
    if os.environ.get("DOSSIER_MARKER_GUARD") == "off":
        return 0

    try:
        event = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    if not isinstance(event, dict):
        return 0

    file_path, chunks = hook_payload(event)
    if not file_path or not chunks:
        return 0

    bad_token = check_header_token(file_path, chunks)
    if bad_token is not None:
        sys.stderr.write(
            f"dossier: refusing to write non-canonical header state '{bad_token}'.\n"
            "  canonical header states: live | done | paused.\n"
            "  route header changes through lib-header-state.sh "
            "(ds:close flips done; ds:status pause/resume) — not a raw Edit/Write.\n"
        )
        return 2

    if is_dossier_path(file_path):
        return 0

    hit = find_marker(chunks)
    if hit is None:
        return 0

    return advise(file_path, hit[0])


if __name__ == "__main__":
    if sys.version_info < (3, 10):
        sys.exit(0)
    sys.exit(main())
