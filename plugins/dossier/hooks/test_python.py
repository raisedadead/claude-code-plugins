#!/usr/bin/env python3
"""Stdlib-only tests for the dossier python hooks.

Run directly (`python3 test_python.py`) or under pytest. No third-party deps.
Covers the catastrophic-failure invariants of the roll + verify subsystem:
round-trip fidelity, transcript reconstruction, offline-safety, regex compile.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import roll_lib
import verify_lib


def test_tlr_round_trip() -> None:
    tasks = [
        {"id": "1", "subject": "Fix |sort| bug", "description": "INDEX regen\nsort flag wrong", "activeForm": "Fixing sort", "status": "completed", "blockedBy": []},
        {"id": "2", "subject": "Wire client", "description": "Wire client", "activeForm": "Wire client", "status": "in_progress", "blockedBy": ["1"]},
        {"id": "3", "subject": "Rollout", "description": "Rollout", "activeForm": "Rollout", "status": "pending", "blockedBy": []},
    ]
    parsed = roll_lib.parse_tlr(roll_lib.render_tlr(tasks, "sess-1", "explicit"))
    assert len(parsed) == 3, f"expected 3 rows, got {len(parsed)}"
    assert parsed[0]["subject"] == "Fix |sort| bug", parsed[0]["subject"]
    assert parsed[0]["status"] == "completed", parsed[0]["status"]
    assert parsed[1]["status"] == "in_progress" and parsed[1]["blockedBy"] == ["1"], parsed[1]
    assert parsed[2]["status"] == "pending", parsed[2]
    assert parsed[1]["description"] == "Wire client", parsed[1]["description"]


def test_parse_transcript() -> None:
    events = [
        {"sessionId": "s1", "message": {"content": [{"type": "tool_use", "name": "TaskCreate", "id": "tu1", "input": {"subject": "A", "description": "A", "activeForm": "Doing A"}}]}},
        {"message": {"content": [{"type": "tool_result", "tool_use_id": "tu1", "content": "Task #1 created successfully: A"}]}},
        {"message": {"content": [{"type": "tool_use", "name": "TaskCreate", "id": "tu2", "input": {"subject": "B", "description": "B", "activeForm": "Doing B"}}]}},
        {"message": {"content": [{"type": "tool_result", "tool_use_id": "tu2", "content": "Task #2 created successfully: B"}]}},
        {"message": {"content": [{"type": "tool_use", "name": "TaskUpdate", "id": "tu3", "input": {"taskId": "1", "status": "completed"}}]}},
        {"message": {"content": [{"type": "tool_use", "name": "TaskUpdate", "id": "tu4", "input": {"taskId": "2", "status": "deleted"}}]}},
    ]
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "transcript.jsonl"
        p.write_text("\n".join(json.dumps(e) for e in events) + "\n")
        tasks, sid = roll_lib.parse_transcript(p)
    assert sid == "s1", sid
    assert len(tasks) == 1, f"deleted task must drop; got {[t['id'] for t in tasks]}"
    assert tasks[0]["id"] == "1" and tasks[0]["status"] == "completed", tasks[0]


def test_verify_offline_safe() -> None:
    original = verify_lib.http_cached
    verify_lib.http_cached = lambda *a, **k: None  # type: ignore[assignment]
    try:
        assert verify_lib.check_eol("nodejs", "18") is None
        assert verify_lib.check_freetext("Node", "18") is None
        assert verify_lib.check_pkg_outdated("npm", "react", "16.0.0") is None
        assert verify_lib.check_image_tag("node", "18-alpine") is None
        assert verify_lib.check_action_sha("actions/checkout", "v4") is not None
    finally:
        verify_lib.http_cached = original  # type: ignore[assignment]


def test_verify_patterns_compile() -> None:
    import re

    from verify_patterns import VERIFY_PATTERNS

    assert VERIFY_PATTERNS, "pattern registry is empty"
    for rule in VERIFY_PATTERNS:
        re.compile(rule["regex"], rule.get("_flags", 0))


def test_resolve_pins_offline() -> None:
    import resolve_pins

    original = verify_lib.http_cached
    verify_lib.http_cached = lambda *a, **k: None  # type: ignore[assignment]
    try:
        assert resolve_pins.resolve("npm:react").get("offline") is True
        assert resolve_pins.resolve("eol:go").get("offline") is True
        assert "error" in resolve_pins.resolve("nocolonspec")
    finally:
        verify_lib.http_cached = original  # type: ignore[assignment]


def _run() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"ok   {t.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"FAIL {t.__name__}: {exc}", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"ERROR {t.__name__}: {type(exc).__name__}: {exc}", file=sys.stderr)
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(_run())
