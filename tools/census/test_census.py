#!/usr/bin/env python3
"""Stdlib-only tests for census.py. Run directly or via pytest.

Only the notification join is pinned. That join is the invariant that breaks
plausibly rather than to zero if Claude Code's transcript shape drifts — a
verdict silently attributed to the wrong agent, or dropped, still prints a
table. The counting and formatting around it are not tested: they would be
documentation tests, and this repo does not write those.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "census", Path(__file__).resolve().parent / "census.py"
)
census = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(census)


def _notification(tool_use_id: str, result: str) -> str:
    return (
        f"<task-notification>\n<task-id>t1</task-id>\n"
        f"<tool-use-id>{tool_use_id}</tool-use-id>\n"
        f"<status>completed</status>\n<result>{result}</result>\n"
        "</task-notification>"
    )


def test_the_join_keys_a_verdict_to_its_spawn() -> None:
    text = _notification("toolu_42", "REVIEW: PASS\n\nlooks fine")
    found = census.NOTIFICATION.search(text)
    assert found is not None, text
    assert found.group(1) == "toolu_42", found.group(1)
    assert "REVIEW: PASS" in found.group(2), found.group(2)


def test_a_notification_without_a_tool_use_id_does_not_join() -> None:
    """A drifted shape must fail to match, not match the wrong id."""
    text = "<task-notification>\n<result>REVIEW: PASS</result>\n</task-notification>"
    assert census.NOTIFICATION.search(text) is None


def test_a_verdict_outside_a_result_is_not_read_as_one() -> None:
    """F32's first trap: `REVIEW: PASS` is literal text in our own SKILL.md."""
    text = "the skill body says `REVIEW: PASS` proceeds to step 7"
    assert census.NOTIFICATION.search(text) is None


def test_the_launch_metadata_carries_no_verdict() -> None:
    """F32's second trap: the Agent tool result is not the return value."""
    text = "Async agent launched successfully.\nagentId: abc123"
    assert census.NOTIFICATION.search(text) is None


def test_a_tool_result_record_is_not_an_operator_prompt() -> None:
    record = {
        "type": "user",
        "message": {"content": [{"type": "tool_result", "content": "output"}]},
    }
    assert census.is_operator_prompt(record) is False


def test_a_task_notification_is_not_an_operator_prompt() -> None:
    record = {
        "type": "user",
        "message": {"content": [{"type": "text", "text": "<task-notification>x"}]},
    }
    assert census.is_operator_prompt(record) is False


def test_a_real_prompt_is_an_operator_prompt() -> None:
    record = {"type": "user", "message": {"content": [{"type": "text", "text": "hi"}]}}
    assert census.is_operator_prompt(record) is True


def test_a_sidechain_prompt_is_not_counted() -> None:
    record = {
        "type": "user",
        "isSidechain": True,
        "message": {"content": [{"type": "text", "text": "hi"}]},
    }
    assert census.is_operator_prompt(record) is False


def _main() -> int:
    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
        except Exception as exc:
            failures += 1
            print(f"FAIL {name}: {type(exc).__name__}: {exc}", file=sys.stderr)
        else:
            print(f"ok {name}")
    if failures:
        print(f"{failures} failing", file=sys.stderr)
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
