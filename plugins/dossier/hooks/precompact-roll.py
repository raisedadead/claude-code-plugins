#!/usr/bin/env python3
"""PreCompact / SessionEnd hook — auto-dump TaskList before context loss.

Reads stdin JSON, locates transcript_path, reconstructs current TaskList
state, writes `<root>/.scratchpad/.tasklist-roll/<ts>.tlr` — `<root>` is the
payload `cwd` when it names a directory and the process cwd otherwise — emits a top-level
`systemMessage` breadcrumb. SessionEnd and PreCompact have no
`hookSpecificOutput` output branch in the CC hook schema, so context cannot
be injected from here — restore reads the newest .tlr from disk. Always
exits 0.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from roll_lib import (
        live_slug_from_index,
        new_roll_path,
        parse_transcript,
        render_tlr,
    )
except Exception as exc:  # noqa: BLE001
    print(f"roll-precompact load error: {type(exc).__name__}: {exc}", file=sys.stderr)
    sys.exit(0)


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        return 0

    transcript = payload.get("transcript_path") or ""
    sid = payload.get("session_id") or ""
    if not transcript:
        return 0

    try:
        tasks, parsed_sid = parse_transcript(Path(transcript))
    except Exception as exc:  # noqa: BLE001
        print(
            f"roll-precompact parse error: {type(exc).__name__}: {exc}", file=sys.stderr
        )
        return 0

    if not tasks:
        return 0

    event_name = payload.get("hook_event_name") or "PreCompact"
    trig = "sessionend" if event_name == "SessionEnd" else "precompact"
    sid = sid or parsed_sid or "unknown"
    try:
        hook_cwd = payload.get("cwd")
        root = Path(hook_cwd) if isinstance(hook_cwd, str) and hook_cwd else Path.cwd()
        if not root.is_dir():
            root = Path.cwd()
    except OSError:
        return 0
    try:
        doss = live_slug_from_index(root)
    except Exception:  # noqa: BLE001
        doss = ""
    body = render_tlr(tasks, sid, trig, doss)
    try:
        out_path = new_roll_path(root)
        tmp = out_path.with_suffix(out_path.suffix + ".tmp")
        tmp.write_text(body)
        tmp.replace(out_path)
    except OSError as exc:
        print(f"roll-precompact write error: {exc}", file=sys.stderr)
        return 0

    rel = out_path
    try:
        rel = out_path.relative_to(root)
    except ValueError:
        pass
    pending = sum(1 for t in tasks if t["status"] == "pending")
    note = (
        f"TaskList auto-rolled to {rel} ({len(tasks)} tasks, {pending} pending). "
        f"Run /dossier:roll restore to resume."
    )
    sys.stdout.write(json.dumps({"systemMessage": note}))
    return 0


if __name__ == "__main__":
    if sys.version_info < (3, 10):
        sys.exit(0)
    sys.exit(main())
