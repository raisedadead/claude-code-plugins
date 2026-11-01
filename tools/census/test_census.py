#!/usr/bin/env python3
"""Stdlib-only tests for census.py. Run directly or via pytest.

Only the notification join is pinned. That join is the invariant that breaks
plausibly rather than to zero if Claude Code's transcript shape drifts — a
verdict silently attributed to the wrong agent, or dropped, still prints a
table. The counting and formatting around it are not tested: they would be
documentation tests, and this repo does not write those.
"""

from __future__ import annotations

import datetime
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


def _skill(name: str, args: str = "") -> dict:
    block = {
        "type": "tool_use",
        "name": "Skill",
        "input": {"skill": name, "args": args},
    }
    return {"type": "assistant", "message": {"content": [block]}}


def _prompt(text: str) -> dict:
    return {"type": "user", "message": {"content": [{"type": "text", "text": text}]}}


def test_review_counts_build_calls_and_the_flag() -> None:
    records = [
        _skill("dossier:build", "--auto"),
        _skill("dossier:build", "T3 --review"),
        _skill("dossier:status"),
        _prompt(
            "<command-name>/dossier:build</command-name>\n<command-args>T4 --review</command-args>"
        ),
    ]
    assert census.review_flag(records) == {"builds": 3, "with --review": 2}


def test_advisor_calls_split_main_thread_from_subagent() -> None:
    call = {"type": "server_tool_use", "name": "advisor", "input": {}}
    main = {"type": "assistant", "message": {"content": [call]}}
    side = {"type": "assistant", "isSidechain": True, "message": {"content": [call]}}
    other = {
        "type": "assistant",
        "message": {"content": [{"type": "server_tool_use", "name": "web_search"}]},
    }
    assert census.advisor_calls([main, main, side, other]) == {
        "main thread": 2,
        "subagent": 1,
    }


def test_guard_fires_count_tool_results_not_prose() -> None:
    fired = {
        "type": "user",
        "message": {
            "content": [
                {
                    "type": "tool_result",
                    "content": "dossier marker guard: 'a.ts' carries a marker",
                }
            ]
        },
    }
    quoted = _prompt("why did the dossier marker guard fire?")
    source = {
        "type": "user",
        "message": {
            "content": [
                {
                    "type": "tool_result",
                    "content": "12\t    f\"dossier marker guard: '{path}'\",",
                }
            ]
        },
    }
    assert census.guard_fires([fired, quoted, source]) == {"marker guard": 1}


def test_a_trigger_phrase_with_no_skill_call_after_it_is_a_miss() -> None:
    triggers = {"dossier:status": ["where are we"], "dossier:check": ["check drift"]}
    records = [
        _prompt("where are we on this?"),
        _skill("dossier:status"),
        _prompt("please check drift now"),
        _prompt("where are we"),
    ]
    assert census.missed_calls(records, triggers) == {
        "dossier:status": {"asked": 2, "missed": 1},
        "dossier:check": {"asked": 1, "missed": 1},
    }


def test_a_typed_command_a_skill_body_or_a_word_inside_another_is_not_a_miss() -> None:
    triggers = {"dossier:status": ["ds", "where are we"]}
    body = {**_prompt("ds:status runs where are we"), "isMeta": True}
    typed = _prompt("<command-name>/dossier:status</command-name> where are we")
    records = [
        body,
        typed,
        _prompt("the ds:build verb and builds"),
        _prompt("<x>where are we</x>"),
    ]
    assert census.missed_calls(records, triggers) == {}


def test_trigger_phrases_come_from_the_quoted_invoke_clause() -> None:
    description = 'Drift detector. Invoke when the user says "ds:check", "check drift", or before a PR.'
    assert census.trigger_phrases(description) == ["ds:check", "check drift"]


def test_the_verdict_log_counts_verdicts_misses_and_empty_messages() -> None:
    lines = [
        '{"agent_type": "whetstone:whetstone-doubter", "verdicts": ["DOUBT: FAILURES"]}',
        '{"agent_type": "whetstone:whetstone-doubter", "verdicts": ["SUBTRACT: 2 CUTS"]}',
        '{"agent_type": "dossier:dossier-reviewer", "verdicts": []}',
        '{"agent_type": "dossier:dossier-reviewer", "verdicts": null}',
        "not json",
    ]
    assert census.verdict_log(lines) == {
        "whetstone:whetstone-doubter": {"DOUBT: FAILURES": 1, "SUBTRACT: 2 CUTS": 1},
        "dossier:dossier-reviewer": {"no verdict line": 1, "no message": 1},
    }


IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))


def _utc(text: str) -> datetime.datetime:
    return datetime.datetime.fromisoformat(text)


def test_row_windows_read_starts_ends_and_resumes() -> None:
    lines = [
        "2026-11-01 10:00 ds:build T1 START class=design",
        "2026-11-01 10:05:30 ds:build T1 PAUSE reason=review",
        "2026-11-01 11:00 ds:build T1 START resume",
        "2026-11-01 11:10 ds:build T1 §X=refreshed; DONE → x",
        "2026-11-01 11:20 ds:build T2 START",
        "2026-11-01 11:21 ds:build T2 delegate=general-purpose",
        "2026-11-01 12:00 ds:build T3 START",
        "not a status line",
    ]
    rows = census.row_windows(lines, IST)
    assert rows["T1"].windows == [
        (_utc("2026-11-01T04:30:00+00:00"), _utc("2026-11-01T04:35:30+00:00")),
        (_utc("2026-11-01T05:30:00+00:00"), _utc("2026-11-01T05:40:59+00:00")),
    ]
    assert rows["T1"].delegated is False
    assert rows["T2"].delegated is True
    assert rows["T2"].windows == [] and rows["T2"].open is True
    assert rows["T3"].open is True


def _assistant(
    message_id: str,
    stamp: str,
    tokens: int,
    cwd: str = "/r",
    sidechain: bool = False,
    session: str = "s1",
) -> dict:
    usage = {
        "input_tokens": tokens,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "output_tokens": 1,
    }
    return {
        "type": "assistant",
        "cwd": cwd,
        "sessionId": session,
        "isSidechain": sidechain,
        "timestamp": stamp,
        "message": {"id": message_id, "model": "claude-x", "usage": usage},
    }


def test_row_tokens_count_each_message_once_in_one_row() -> None:
    rows = census.row_windows(
        [
            "2026-11-01 10:00 ds:build T1 START",
            "2026-11-01 10:10 ds:build T1 DONE → x",
            "2026-11-01 10:10 ds:build T2 START",
            "2026-11-01 10:20 ds:build T2 DONE → x",
        ],
        IST,
    )
    feed = [
        (_assistant("m1", "2026-11-01T04:31:00Z", 100), None),
        (_assistant("m1", "2026-11-01T04:31:00Z", 100), None),
        (_assistant("m2", "2026-11-01T04:40:30Z", 10), None),
        (_assistant("m3", "2026-11-01T04:32:00Z", 7, sidechain=True), "worker"),
        (
            _assistant("m4", "2026-11-01T04:33:00Z", 5, cwd="/r/.claude/worktrees/w"),
            None,
        ),
        (_assistant("m5", "2026-11-01T04:34:00Z", 999, cwd="/other"), None),
        (_assistant("m6", "2026-11-01T06:00:00Z", 999), None),
    ]
    tally = census.row_tokens(rows, feed, "/r")
    assert tally["T1"]["main"]["input"] == 105
    assert tally["T1"]["worker"]["input"] == 7
    assert tally["T2"]["main"]["input"] == 10
    assert tally["T1"]["sessions"] == {"s1"}


def test_a_class_with_fewer_than_three_rows_is_unverified() -> None:
    assert census.class_median([10, 20]) == "UNVERIFIED: fewer than 3 rows (n=2)"
    assert census.class_median([10, 20, 40]) == "median 20 (n=3)"


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
