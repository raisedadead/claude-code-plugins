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
import os
import sys
import time
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


def test_a_compaction_summary_is_not_an_operator_prompt() -> None:
    record = {
        "type": "user",
        "isCompactSummary": True,
        "message": {
            "content": "This session is being continued from a previous conversation"
        },
    }
    assert census.is_operator_prompt(record) is False


def test_a_repeated_notification_is_collected_once() -> None:
    first = _prompt(_notification("toolu_1", "REVIEW: CHANGES"))
    repeat = _prompt(_notification("toolu_1", "REVIEW: PASS"))
    other = _prompt(_notification("toolu_2", "REVIEW: PASS"))
    feed = [(first, "a"), (_prompt("hi"), "a"), (repeat, "b"), (other, "b")]
    found = census.first_notifications(feed)
    assert [(key, path) for key, _result, path in found] == [
        ("toolu_1", "a"),
        ("toolu_2", "b"),
    ]
    assert "REVIEW: CHANGES" in found[0][1], found[0][1]


def test_review_skips_replayed_request_blobs() -> None:
    blob = "api-request-blob"
    typed = "<command-name>/dossier:build</command-name>\n<command-args>T4 --review</command-args>"
    records = [
        {**_skill("dossier:build", "T3 --review"), "type": blob},
        {**_prompt(typed), "type": blob},
        _skill("dossier:build", "T5"),
    ]
    assert census.review_flag(records) == {"builds": 1, "with --review": 0}


def test_the_run_mean_names_only_resolved_runs() -> None:
    runs = census.failure_runs(
        {"s1": ["CHANGES", "CHANGES", "PASS", "PASS", "CHANGES"]}
    )
    line = census.runs_line("reviewer", runs)
    assert (
        line
        == "  reviewer: {2: 1, 0: 1, '1+unresolved': 1}  mean over resolved runs=1.00"
    ), line


def test_the_reviewer_grammar_and_its_findings_count() -> None:
    grammar = census.VERDICT_GRAMMAR["reviewer"]
    for text, verdict in (
        ("REVIEW: PASS", "PASS"),
        ("REVIEW: CHANGES", "CHANGES"),
        ("REVIEW: clean", "clean"),
        ("REVIEW: 2 findings (1 major, 1 minor)", "2 findings"),
        ("REVIEW: 1 finding (1 minor)", "1 finding"),
    ):
        found = grammar.search(text)
        assert found is not None and found.group(1) == verdict, text
    values = [
        "3 findings",
        "0 findings",
        "CHANGES",
        "DOUBT: FAILURES",
        "clean",
        "PASS",
        "NO FAILURE FOUND",
        "1 finding",
    ]
    assert census.failure_runs({"s1": values}) == {1: 1, 2: 1, 0: 2, "1+unresolved": 1}


def test_a_findings_count_reports_under_one_label() -> None:
    labels = [
        census.verdict_label(v)
        for v in ("3 findings", "1 finding", "0 findings", "PASS")
    ]
    assert labels == ["findings>0", "findings>0", "0 findings", "PASS"], labels


def test_a_vanished_transcript_sorts_first_instead_of_raising() -> None:
    assert census.modified_at("/nonexistent/gone.jsonl") == -1.0


def test_transcripts_come_oldest_first() -> None:
    import tempfile

    saved = census.TRANSCRIPTS
    with tempfile.TemporaryDirectory() as root:
        newer, older = Path(root, "a.jsonl"), Path(root, "b.jsonl")
        newer.write_text("{}\n")
        older.write_text("{}\n")
        os.utime(newer, (2000, 2000))
        os.utime(older, (1000, 1000))
        try:
            census.TRANSCRIPTS = str(Path(root, "**", "*.jsonl"))
            assert census.transcripts() == [str(older), str(newer)]
            os.utime(newer, (500, 500))
            assert census.transcripts() == [str(newer), str(older)]
        finally:
            census.TRANSCRIPTS = saved


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


def test_row_windows_read_each_stamp_in_its_own_local_offset() -> None:
    lines = [
        "2026-01-15 10:00 ds:build T1 START",
        "2026-07-15 10:00 ds:build T1 DONE → x",
    ]
    saved = os.environ.get("TZ")
    try:
        os.environ["TZ"] = "America/New_York"
        time.tzset()
        start, end = census.row_windows(lines)["T1"].windows[0]
    finally:
        if saved is None:
            os.environ.pop("TZ")
        else:
            os.environ["TZ"] = saved
        time.tzset()
    assert start == _utc("2026-01-15T15:00:00+00:00"), start
    assert end == _utc("2026-07-15T14:00:59+00:00"), end


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


def test_an_open_shared_or_unmatched_row_stays_out_of_the_medians() -> None:
    rows = census.row_windows(
        [
            "2026-11-01 10:00 ds:build T1 START",
            "2026-11-01 10:10 ds:build T1 PAUSE reason=x",
            "2026-11-01 10:20 ds:build T1 START resume",
            "2026-11-01 10:30 ds:build T2 START",
            "2026-11-01 10:40 ds:build T2 DONE → x",
        ],
        IST,
    )
    counted = {"main": {"input": 5}, "sessions": {"s1"}}
    shared = {"main": {"input": 5}, "sessions": {"s1", "s2"}}
    assert census.row_exclusion(rows["T1"], counted).startswith("OPEN")
    assert census.row_exclusion(rows["T2"], shared).startswith("SHARED")
    assert census.row_exclusion(rows["T2"], {}).startswith("NO TRANSCRIPT")
    assert census.row_exclusion(rows["T2"], counted) is None


def _call(message_id: str, name: str, cache_read: int = 0) -> dict:
    usage = {"cache_read_input_tokens": cache_read}
    block = {"type": "tool_use", "name": name, "input": {}}
    message = {"id": message_id, "usage": usage, "content": [block]}
    return {"type": "assistant", "message": message}


def _result() -> dict:
    block = {"type": "tool_result", "content": "ok"}
    return {"type": "user", "message": {"content": [block]}}


def test_records_sharing_a_message_id_are_one_parallel_turn() -> None:
    records = [
        _call("a", "Bash"),
        _result(),
        _call("b", "Read"),
        _result(),
        _call("b", "Read"),
        _result(),
        _call("c", "Bash"),
        _result(),
        _call("d", "Grep"),
    ]
    turns = census.turn_sequence(records)
    assert [t.tools for t in turns] == [["Bash"], ["Read", "Read"], ["Bash"], ["Grep"]]
    assert census.call_runs(turns) == []


def test_an_operator_prompt_or_an_unscriptable_tool_breaks_a_run() -> None:
    records = [
        _call("a", "Bash"),
        _result(),
        _call("b", "Read", 10),
        _result(),
        _prompt("go on"),
        _call("c", "Bash"),
        _result(),
        {"type": "attachment", "attachment": {"type": "hook_success"}},
        _call("d", "Grep", 20),
        {**_call("x", "Bash"), "type": "api-request-blob"},
        _result(),
        _call("e", "Glob", 30),
        _result(),
        _call("f", "Agent"),
        _result(),
        _call("g", "Bash"),
    ]
    runs = census.call_runs(census.turn_sequence(records))
    assert [[t.tools[0] for t in run] for run in runs] == [["Bash", "Grep", "Glob"]]
    assert sum(t.cache_read for t in runs[0][1:]) == 50


def test_an_advisor_call_or_a_turn_copied_from_another_file_breaks_a_run() -> None:
    advisor = _call("b", "Bash")
    advisor["message"]["content"].append({"type": "server_tool_use", "name": "advisor"})
    records = [_call(key, "Read") for key in "acdefghi"]
    records.insert(1, advisor)
    records.insert(7, _prompt("<task-notification>done</task-notification>"))
    assert census.call_runs(census.turn_sequence(records, {"e"})) == []


def test_a_compaction_summary_breaks_a_run() -> None:
    compaction = {
        "type": "user",
        "isCompactSummary": True,
        "message": {
            "content": "This session is being continued from a previous conversation"
        },
    }
    records = [
        _call("a", "Bash"),
        _result(),
        _call("b", "Read"),
        _result(),
        compaction,
        _call("c", "Bash"),
        _result(),
        _call("d", "Grep"),
    ]
    assert census.call_runs(census.turn_sequence(records)) == []


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
