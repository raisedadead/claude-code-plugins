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
sys.modules[SPEC.name] = census
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


def test_a_message_from_another_session_is_not_an_operator_prompt() -> None:
    relayed = '<teammate-message teammate_id="scout">done</teammate-message>'
    for text in (relayed, f"Another Claude session sent a message:\n{relayed}"):
        assert census.is_operator_prompt(_prompt(text)) is False, text
        assert (
            census.is_operator_prompt({"type": "user", "message": {"content": text}})
            is False
        )
    assert census.is_operator_prompt(_prompt(f"why did this arrive? {relayed}")) is True
    peer = {
        **_prompt('<relay from="coordinator">go</relay>'),
        "origin": {"kind": "peer"},
    }
    assert census.is_operator_prompt(peer) is False


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


def test_records_skip_replayed_request_blobs() -> None:
    import json
    import tempfile

    blob = "api-request-blob"
    advisor = {"type": "server_tool_use", "name": "advisor"}
    lines = [
        {**_skill("dossier:build", "T3 --review"), "type": blob},
        {"type": blob, "message": {"content": [advisor]}},
        _skill("dossier:build", "T5"),
    ]
    with tempfile.TemporaryDirectory() as root:
        path = Path(root, "s.jsonl")
        path.write_text("".join(json.dumps(line) + "\n" for line in lines))
        found = list(census.records(str(path)))
    assert census.review_flag(found) == {"builds": 1, "with --review": 0}
    assert census.advisor_calls(found) == {"main thread": 0, "subagent": 0}


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
        "dossier:dossier-reviewer": {
            "no verdict line": 1,
            "no message or StructuredOutput call": 1,
        },
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


def test_a_row_with_a_done_line_and_no_start_is_closed_not_open() -> None:
    rows = census.row_windows(
        [
            "2026-11-01 10:00 ds:build T1 DONE → x cite=abc operator row",
            "2026-11-01 10:10 ds:build T2 START",
            "2026-11-01 10:20 ds:build T3 BLOCKED needs=T1",
        ],
        IST,
    )
    assert census.unmeasured(rows["T1"]) == "closed with no START line, not measured"
    assert census.unmeasured(rows["T2"]) == "open"
    assert census.unmeasured(rows["T3"]) == "open"


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


def _bash(tool_id: str, command: str, sidechain: bool = False, **extra) -> dict:
    block = {"type": "tool_use", "id": tool_id, "name": "Bash"}
    block["input"] = {"command": command}
    return {
        "type": "assistant",
        "isSidechain": sidechain,
        "message": {"content": [block]},
        **extra,
    }


def _output(tool_id: str, text: str, **extra) -> dict:
    block = {"type": "tool_result", "tool_use_id": tool_id, "content": text}
    return {"type": "user", "message": {"content": [block]}, **extra}


def _edit(path: str, new: str, old: str = "", **extra) -> dict:
    block = {"type": "tool_use", "id": f"e-{path}-{new}", "name": "Edit"}
    block["input"] = {"file_path": path, "old_string": old, "new_string": new}
    return {"type": "assistant", "message": {"content": [block]}, **extra}


def _write(path: str, content: str, session: str) -> dict:
    block = {"type": "tool_use", "id": f"w-{path}", "name": "Write"}
    block["input"] = {"file_path": path, "content": content}
    return {"type": "assistant", "sessionId": session, "message": {"content": [block]}}


def _multi_edit(path: str, new: str, session: str) -> dict:
    block = {"type": "tool_use", "id": f"me-{path}", "name": "MultiEdit"}
    edits = [
        {"old_string": "a", "new_string": "b"},
        {"old_string": "", "new_string": new},
    ]
    block["input"] = {"file_path": path, "edits": edits}
    return {"type": "assistant", "sessionId": session, "message": {"content": [block]}}


def test_a_script_counts_as_use_only_where_it_runs_as_a_command() -> None:
    runs = {
        "git add a.py && tiger-check": {"whetstone:tiger-style"},
        '"$D"/bin/lint-skill skills/x': {"whetstone:skill-smith"},
        "bash plugins/x/scripts/run_slice.sh red t": {"whetstone:tdd-cycle"},
        "verify-clean . 3 printf 5": set(),
        "X=1 run_slice.sh red pytest; flake-runner 5 t": {
            "whetstone:tdd-cycle",
            "whetstone:flaky-test-audit",
        },
        "if true; then html-report a.md; fi": {"whetstone:html-report"},
        'bun "$p/skills/skill-smith/scripts/lint-skill-cli.ts" a': {
            "whetstone:skill-smith"
        },
        "rtk proxy bun $d/scripts/tiger-check-cli.ts": {"whetstone:tiger-style"},
        "if tiger-check; then echo ok; fi": {"whetstone:tiger-style"},
        "while ! run-slice red t; do sleep 1; done": {"whetstone:tdd-cycle"},
        "cat <<< hi; tiger-check": {"whetstone:tiger-style"},
    }
    mentions = [
        "which run-slice tiger-check lint-skill",
        "grep tiger-check file",
        'grep -E "lint-skill|tiger-check" notes.md',
        "grep -n \\\ntiger-check file",
        "python3 - <<'EOF'\ntiger-check\nEOF",
        'git commit -m "subject\ntiger-check ran clean"',
    ]
    for command, skills in runs.items():
        assert census.script_skills(command) == skills, command
    for command in mentions:
        assert census.script_skills(command) == set(), command


def test_every_mapped_script_names_a_plugin_skill() -> None:
    assert set(census.SCRIPT_SKILLS.values()) <= set(census.plugin_skills())


def test_every_plugin_skill_prints_including_a_zero() -> None:
    uses = census.skill_uses(
        [
            _skill("dossier:build"),
            {**_skill("dossier:build"), "isSidechain": True},
            _prompt("<command-name>/dossier:build</command-name>"),
            _bash("b1", "git add x && tiger-check"),
        ]
    )
    lines = census.skill_table(uses, ["dossier:build", "whetstone:tiger-style", "z:z"])
    rows = {line.split()[-1]: line.split()[:-1] for line in lines[1:]}
    assert rows == {
        "dossier:build": ["1", "1", "1", "0"],
        "whetstone:tiger-style": ["0", "0", "0", "1"],
        "z:z": ["0", "0", "0", "0"],
    }, lines


def test_a_typed_command_copied_into_another_file_counts_once() -> None:
    def typed(uuid: str) -> dict:
        return {**_prompt("<command-name>/dossier:build</command-name>"), "uuid": uuid}

    seen: set[str] = set()
    first = census.skill_uses([typed("u1")], seen)
    copy = census.skill_uses([typed("u1"), typed("u2")], seen)
    assert first["dossier:build"]["typed"] == 1
    assert copy["dossier:build"]["typed"] == 1
    used: set[str] = set()
    origin = census.opportunity_events([{**typed("u1"), "sessionId": "s1"}], "f", used)
    copied = census.opportunity_events([{**typed("u1"), "sessionId": "s2"}], "f", used)
    assert origin == {("s1", "dossier:build", "skill", "main")}
    assert copied == set()


def test_the_window_reads_record_timestamps_and_drops_undated_records() -> None:
    window = census.Window(census.since_date("2026-10-01"))
    kept = list(
        window.filter(
            [
                {"timestamp": "2026-09-30T23:59:59Z", "n": 1},
                {"timestamp": "2026-10-01T00:00:00Z", "n": 2},
                {"type": "user", "n": 3},
                {"type": "custom-title", "n": 4},
            ]
        )
    )
    assert [r["n"] for r in kept] == [2]
    assert window.undated == 1
    assert list(census.Window(None).filter([{"n": 3}])) == [{"n": 3}]


def test_a_bad_since_value_is_a_usage_error() -> None:
    assert census.main(["census.py", "skills", "--since", "last week"]) == 64
    assert census.main(["census.py", "skills", "--since", "20261001"]) == 64
    assert census.main(["census.py", "rows", "--since", "2026-10-01"]) == 64
    assert census.main(["census.py", "rows", "--since=2026-10-01"]) == 64


def test_opportunities_come_from_tight_detectors_and_fold_by_session() -> None:
    merge = "git -C repo merge main"
    conflict = "CONFLICT (content): Merge conflict in a.py"
    main = [
        _bash("m1", merge, sessionId="s1"),
        _output("m1", conflict, sessionId="s1"),
        _bash("m2", "cat notes.txt", sessionId="s1"),
        _output("m2", conflict, sessionId="s1"),
        _edit("/r/plugins/w/skills/x/SKILL.md", "body", sessionId="s1"),
    ]
    side = [
        _bash("m3", "git merge-base a b", sidechain=True, sessionId="s1"),
        _output("m3", conflict, sessionId="s1"),
        _edit(
            "/r/.scratchpad/dossier/w/DOSSIER.md",
            "| B2 | x | y | — | — |",
            sessionId="s2",
            isSidechain=True,
        ),
        _bash("m4", "lint-skill skills/x", sidechain=True, sessionId="s1"),
    ]
    other = [
        _edit("/r/a/DOSSIER.md", "| T2 | . | A | B2 |", "| T2 |", sessionId="s3"),
        _bash("m5", "git rebase main", sessionId="s3"),
        _output("m5", "Successfully rebased", sessionId="s3"),
        _bash("m1", merge, sessionId="s4"),
        _output("m1", conflict, sessionId="s4"),
        _bash("m6", f"cd r && {merge}", sessionId="s5"),
        _output("m6", conflict, sessionId="s5"),
        _write("/r/b/DOSSIER.md", "# w\n\n| B1 | x | y | — | — |\n", "s6"),
        _write("/r/.claude/skills/y/SKILL.md", "body", "s6"),
        _multi_edit("/r/c/DOSSIER.md", "| B4 | x | y | — | — |", "s7"),
    ]
    seen: set[str] = set()
    events = set()
    for stream in (main, side, other):
        events |= census.opportunity_events(stream, "fallback", seen)
    assert census.tally_opportunities(events) == {
        "whetstone:skill-smith": {
            "sessions": 2,
            "main": 2,
            "subagent only": 0,
            "used skill": 0,
            "used script": 1,
            "not used": 1,
        },
        "dossier:backprop": {
            "sessions": 2,
            "main": 1,
            "subagent only": 1,
            "used skill": 0,
            "used script": 0,
            "not used": 2,
        },
    }


def test_a_verify_hook_firing_is_the_verify_opportunity() -> None:
    warning = "⚠ verify[lang_eol_prose] nginx 1.25.1 → current: nginx 1.31."
    attachment = {
        "type": "hook_additional_context",
        "hookEvent": "PreToolUse",
        "content": [
            f"{warning}\nsilence a rule for this write: `# verify-skip: <ruleName>`"
        ],
    }
    fired = {"type": "attachment", "sessionId": "s1", "attachment": attachment}
    quoted = _output("g1", warning, sessionId="s2")
    other = {
        **fired,
        "sessionId": "s3",
        "attachment": {**attachment, "hookEvent": "PostToolUse"},
    }
    info = {
        **fired,
        "sessionId": "s4",
        "attachment": {
            **attachment,
            "content": ["ℹ verify[npm_outdated] left-pad 1.0.0 → current: 1.3.0"],
        },
    }
    stream = [fired, quoted, other, info]
    events = census.opportunity_events(stream, "fallback", set())
    assert events == {
        ("s1", "dossier:verify", "trigger", "main"),
        ("s4", "dossier:verify", "trigger", "main"),
    }


def test_the_not_used_sessions_are_listed_for_reading() -> None:
    events = {
        ("s2", "whetstone:tiger-style", "trigger", "main"),
        ("s1", "whetstone:tiger-style", "trigger", "subagent"),
        ("s3", "whetstone:tiger-style", "trigger", "main"),
        ("s3", "whetstone:tiger-style", "script", "main"),
        ("s4", "whetstone:skill-smith", "trigger", "main"),
    }
    assert census.unused_sessions(events, "whetstone:tiger-style") == ["s1", "s2"]


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
