#!/usr/bin/env python3
"""Stdlib-only tests for the dossier python hooks.

Run directly (`python3 test_python.py`) or under pytest. No third-party deps.
Covers the catastrophic-failure invariants of the roll + verify subsystem:
round-trip fidelity, transcript reconstruction, offline-safety, regex compile.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import eval_skill_routing
import invariant_guard
import marker_guard
import roll_lib
import verify_hook
import verify_lib


def test_tlr_round_trip() -> None:
    tasks = [
        {
            "id": "1",
            "subject": "Fix |sort| bug",
            "description": "INDEX regen\nsort flag wrong",
            "activeForm": "Fixing sort",
            "status": "completed",
            "blockedBy": [],
        },
        {
            "id": "2",
            "subject": "Wire client",
            "description": "Wire client",
            "activeForm": "Wire client",
            "status": "in_progress",
            "blockedBy": ["1"],
        },
        {
            "id": "3",
            "subject": "Rollout",
            "description": "Rollout",
            "activeForm": "Rollout",
            "status": "pending",
            "blockedBy": [],
        },
    ]
    body = roll_lib.render_tlr(tasks, "sess-1", "explicit", "2026-07-01-foo")
    assert "doss: 2026-07-01-foo" in body, body
    hdr = roll_lib.parse_tlr_header(body)
    assert hdr.get("doss") == "2026-07-01-foo", hdr
    assert hdr.get("sid") == "sess-1", hdr
    assert "doss: —" in roll_lib.render_tlr(tasks, "s", "explicit"), "omitted doss renders —"
    parsed = roll_lib.parse_tlr(body)
    assert len(parsed) == 3, f"expected 3 rows, got {len(parsed)}"
    assert parsed[0]["subject"] == "Fix |sort| bug", parsed[0]["subject"]
    assert parsed[0]["status"] == "completed", parsed[0]["status"]
    assert parsed[1]["status"] == "in_progress" and parsed[1]["blockedBy"] == ["1"], (
        parsed[1]
    )
    assert parsed[2]["status"] == "pending", parsed[2]
    assert parsed[1]["description"] == "Wire client", parsed[1]["description"]


def test_live_slug_from_index() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        sp = Path(d) / ".scratchpad"
        sp.mkdir()
        (sp / "INDEX.md").write_text(
            "# .scratchpad index\n\n"
            "| date | slug | state | P | T | B | mtime | §Z |\n"
            "|------|------|-------|---|---|---|-------|-----|\n"
            "| 2026-07-01 | alpha | drift! | P1/1 | 0/0 | 0 | — | — |\n"
            "| 2026-06-30 | beta | live | P1/1 | 0/0 | 0 | — | — |\n"
        )
        assert roll_lib.live_slug_from_index(Path(d)) == "2026-06-30-beta"
    with tempfile.TemporaryDirectory() as d2:
        assert roll_lib.live_slug_from_index(Path(d2)) == ""


def test_parse_transcript() -> None:
    events = [
        {
            "sessionId": "s1",
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "name": "TaskCreate",
                        "id": "tu1",
                        "input": {
                            "subject": "A",
                            "description": "A",
                            "activeForm": "Doing A",
                        },
                    }
                ]
            },
        },
        {
            "message": {
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "tu1",
                        "content": "Task #1 created successfully: A",
                    }
                ]
            }
        },
        {
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "name": "TaskCreate",
                        "id": "tu2",
                        "input": {
                            "subject": "B",
                            "description": "B",
                            "activeForm": "Doing B",
                        },
                    }
                ]
            }
        },
        {
            "message": {
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "tu2",
                        "content": "Task #2 created successfully: B",
                    }
                ]
            }
        },
        {
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "name": "TaskUpdate",
                        "id": "tu3",
                        "input": {"taskId": "1", "status": "completed"},
                    }
                ]
            }
        },
        {
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "name": "TaskUpdate",
                        "id": "tu4",
                        "input": {"taskId": "2", "status": "deleted"},
                    }
                ]
            }
        },
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


def test_verify_cache_only_no_network() -> None:
    import os
    import urllib.request

    orig_urlopen = urllib.request.urlopen
    orig_cwd = os.getcwd()

    def _boom(*_a, **_k):
        raise AssertionError("cache-only mode must not hit the network")

    with tempfile.TemporaryDirectory() as d:
        os.chdir(d)
        os.environ["DOSSIER_VERIFY_CACHE_ONLY"] = "1"
        urllib.request.urlopen = _boom  # type: ignore[assignment]
        try:
            assert verify_lib.http_cached("https://example.invalid/cold") is None
        finally:
            urllib.request.urlopen = orig_urlopen  # type: ignore[assignment]
            os.environ.pop("DOSSIER_VERIFY_CACHE_ONLY", None)
            os.chdir(orig_cwd)


def test_verify_hook_skips_non_dossier_repo() -> None:
    with tempfile.TemporaryDirectory() as d:
        rc, out = _drive(
            verify_hook,
            {
                "tool_name": "Edit",
                "cwd": d,
                "tool_input": {
                    "file_path": "action.yml",
                    "new_string": "uses: actions/checkout@v3",
                },
            },
        )
        assert rc == 0 and out == "", (rc, out)


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


def _drive(mod: object, payload: dict) -> tuple[int, str]:
    buf = io.StringIO()
    saved = sys.stdin
    sys.stdin = io.StringIO(json.dumps(payload))
    try:
        with contextlib.redirect_stdout(buf):
            rc = mod.main()  # type: ignore[attr-defined]
    finally:
        sys.stdin = saved
    return rc, buf.getvalue()


def _load_hyphen(modname: str, filename: str) -> object:
    path = Path(__file__).resolve().parent / filename
    spec = importlib.util.spec_from_file_location(modname, path)
    assert spec and spec.loader, filename
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_marker_guard_narrowed_to_audit_ids() -> None:
    assert marker_guard.find_marker(["# Step 1: dump the database"]) is None
    assert marker_guard.find_marker(["// Phase 1: validate"]) is None
    assert marker_guard.find_marker(["# Stage 3: integration"]) is None
    assert marker_guard.find_marker(["// V11 (Phase 3 / A7): note"]) is None
    assert marker_guard.find_marker(["// PH3-B7: known-bug guard"]) is not None


def test_marker_guard_advises_never_blocks() -> None:
    rc, out = _drive(
        marker_guard,
        {
            "tool_name": "Write",
            "tool_input": {"file_path": "src/foo.ts", "content": "// PH3-B7: guard"},
        },
    )
    assert rc == 0, rc
    hso = json.loads(out)["hookSpecificOutput"]
    assert hso["hookEventName"] == "PreToolUse", hso
    assert isinstance(hso["additionalContext"], str) and hso["additionalContext"]
    rc2, out2 = _drive(
        marker_guard,
        {
            "tool_name": "Write",
            "tool_input": {
                "file_path": "k8s/backup-cronjob.yaml",
                "content": "          # Step 1: dump",
            },
        },
    )
    assert rc2 == 0 and out2.strip() == "", out2


def test_marker_guard_skips_non_dossier_repo() -> None:
    with tempfile.TemporaryDirectory() as d:
        rc, out = _drive(
            marker_guard,
            {
                "tool_name": "Edit",
                "cwd": d,
                "tool_input": {"file_path": "src/foo.ts", "new_string": "// PH3-B7: guard"},
            },
        )
        assert rc == 0 and out == "", (rc, out)


def test_precompact_output_schema_safe() -> None:
    """SessionEnd/PreCompact emit no hookSpecificOutput (absent from the CC 2.1.x output union)."""
    pr = _load_hyphen("precompact_roll", "precompact-roll.py")
    events = [
        {
            "sessionId": "s9",
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "name": "TaskCreate",
                        "id": "x1",
                        "input": {
                            "subject": "A",
                            "description": "A",
                            "activeForm": "Doing A",
                        },
                    }
                ]
            },
        },
        {
            "message": {
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "x1",
                        "content": "Task #1 created successfully: A",
                    }
                ]
            }
        },
    ]
    with tempfile.TemporaryDirectory() as d:
        dp = Path(d)
        tpath = dp / "t.jsonl"
        tpath.write_text("\n".join(json.dumps(e) for e in events) + "\n")
        payload = {
            "transcript_path": str(tpath),
            "session_id": "s9",
            "hook_event_name": "SessionEnd",
        }
        cwd = Path.cwd()
        os.chdir(dp)
        try:
            rc, out = _drive(pr, payload)
        finally:
            os.chdir(cwd)
        rolls = list((dp / ".scratchpad" / ".tasklist-roll").glob("*.tlr"))
    assert rc == 0, rc
    assert rolls, "tlr side-effect must be written"
    obj = json.loads(out)
    assert "hookSpecificOutput" not in obj, obj
    assert set(obj) <= {
        "systemMessage",
        "continue",
        "suppressOutput",
        "stopReason",
        "decision",
        "reason",
        "terminalSequence",
    }, obj
    assert "systemMessage" in obj, obj


def _write_skill(root: Path, name: str, description: str) -> None:
    d = root / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n---\n\nbody\n",
        encoding="utf-8",
    )


def test_eval_routing_clean() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _write_skill(root, "alpha", 'Do alpha. Invoke when the user says "alpha", "a1".')
        _write_skill(root, "beta", 'Do beta. Invoke when the user says "beta", "b1".')
        assert eval_skill_routing.lint(root) == [], eval_skill_routing.lint(root)


def test_eval_routing_collision() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _write_skill(root, "alpha", 'Alpha. Invoke when the user says "shared", "a1".')
        _write_skill(root, "beta", 'Beta. Invoke when the user says "shared", "b1".')
        findings = eval_skill_routing.lint(root)
        assert any("collision" in f and "shared" in f for f in findings), findings
        assert any("alpha" in f and "beta" in f for f in findings), findings


def test_eval_routing_missing_clause() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _write_skill(root, "gamma", "Does gamma things with no trigger clause.")
        findings = eval_skill_routing.lint(root)
        assert any("gamma" in f and "trigger clause" in f for f in findings), findings


def test_eval_routing_real_skills_clean() -> None:
    findings = eval_skill_routing.lint(eval_skill_routing.SKILLS_DIR)
    assert findings == [], f"real skill descriptions must not collide: {findings}"


def _invariant_registry(root: Path, entries: list[dict]) -> None:
    reg = root / ".scratchpad" / "dossier"
    reg.mkdir(parents=True)
    (reg / ".invariant-guards.json").write_text(json.dumps(entries), encoding="utf-8")


def _drive_in(mod: object, payload: dict, cwd: Path) -> tuple[int, str]:
    old = Path.cwd()
    os.chdir(cwd)
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            return _drive(mod, payload)
    finally:
        os.chdir(old)


_GUARD_ENTRY = {"id": "V1", "pattern": r"eval\(", "message": "no eval", "paths": ["src/*.py"]}


def _write_payload(path: str, content: str) -> dict:
    return {"tool_name": "Write", "tool_input": {"file_path": path, "content": content}}


def test_invariant_guard_blocks_registered_pattern() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _invariant_registry(root, [_GUARD_ENTRY])
        rc, _ = _drive_in(invariant_guard, _write_payload("src/app.py", "x = eval(y)"), root)
        assert rc == 2, rc


def test_invariant_guard_allows_non_match() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _invariant_registry(root, [_GUARD_ENTRY])
        rc, _ = _drive_in(invariant_guard, _write_payload("src/app.py", "x = safe(y)"), root)
        assert rc == 0, rc


def test_invariant_guard_out_of_scope_path() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _invariant_registry(root, [_GUARD_ENTRY])
        rc, _ = _drive_in(invariant_guard, _write_payload("other/app.py", "x = eval(y)"), root)
        assert rc == 0, rc


def test_invariant_guard_dossier_pass_through() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _invariant_registry(root, [{"id": "V1", "pattern": r"eval\(", "message": "no eval"}])
        rc, _ = _drive_in(
            invariant_guard,
            _write_payload(".scratchpad/dossier/x/DOSSIER.md", "eval("),
            root,
        )
        assert rc == 0, rc


def test_invariant_guard_no_registry_failopen() -> None:
    with tempfile.TemporaryDirectory() as d:
        rc, _ = _drive_in(invariant_guard, _write_payload("src/app.py", "eval("), Path(d))
        assert rc == 0, rc


def test_invariant_guard_malformed_registry_failopen() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        reg = root / ".scratchpad" / "dossier"
        reg.mkdir(parents=True)
        (reg / ".invariant-guards.json").write_text("{not json", encoding="utf-8")
        rc, _ = _drive_in(invariant_guard, _write_payload("src/app.py", "eval("), root)
        assert rc == 0, rc


def test_invariant_guard_off_env() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _invariant_registry(root, [{"id": "V1", "pattern": r"eval\(", "message": "no eval"}])
        os.environ["DOSSIER_INVARIANT_GUARD"] = "off"
        try:
            rc, _ = _drive_in(invariant_guard, _write_payload("src/app.py", "eval("), root)
        finally:
            os.environ.pop("DOSSIER_INVARIANT_GUARD", None)
        assert rc == 0, rc


def test_invariant_guard_skips_non_dossier_repo() -> None:
    with tempfile.TemporaryDirectory() as dossier_root, tempfile.TemporaryDirectory() as bare_root:
        _invariant_registry(Path(dossier_root), [_GUARD_ENTRY])
        payload = _write_payload("src/app.py", "x = eval(y)")
        payload["cwd"] = bare_root
        rc, out = _drive_in(invariant_guard, payload, Path(dossier_root))
        assert rc == 0 and out == "", (rc, out)


def _run() -> int:
    tests = [
        v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)
    ]
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
