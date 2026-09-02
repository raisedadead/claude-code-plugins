#!/usr/bin/env python3
"""Stdlib-only tests for the dossier python hooks.

Run directly (`python3 test_python.py`) or under pytest. No third-party deps.
Covers the catastrophic-failure invariants of the roll + verify subsystem:
round-trip fidelity, transcript reconstruction, offline-safety, regex compile.
"""

from __future__ import annotations

import contextlib
import hashlib
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
import verify_sweep


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
    assert "doss: —" in roll_lib.render_tlr(tasks, "s", "explicit"), (
        "omitted doss renders —"
    )
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


def _serve_status(code: int, body: bytes = b"{}"):
    """A localhost server that answers `code` once per request. Returns (url, counter, stop)."""
    import http.server
    import threading

    hits = {"n": 0}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            hits["n"] += 1
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):  # noqa: A002
            return

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/x.json"
    return url, hits, server.shutdown


def test_http_status_404_is_missing_and_is_cached() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        cwd = os.getcwd()
        os.chdir(tmp)
        url, hits, stop = _serve_status(404)
        try:
            assert verify_lib.http_cached_status(url) == ("missing", None)
            assert verify_lib.http_cached_status(url) == ("missing", None)
            assert hits["n"] == 1, f"a 404 must be cached, not re-fetched; requests={hits['n']}"
        finally:
            stop()
            os.chdir(cwd)


def test_http_status_500_is_offline_and_is_not_cached() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        cwd = os.getcwd()
        os.chdir(tmp)
        url, hits, stop = _serve_status(500)
        try:
            out = io.StringIO()
            with contextlib.redirect_stderr(out):
                assert verify_lib.http_cached_status(url) == ("offline", None)
                assert verify_lib.http_cached_status(url) == ("offline", None)
            assert hits["n"] == 2, f"a 5xx says nothing about existence, so it must re-fetch; requests={hits['n']}"
        finally:
            stop()
            os.chdir(cwd)


def test_go_walk_warns_at_the_probe_ceiling() -> None:
    versions = {"m/big": "v1.0.0"}
    versions.update({f"m/big/v{n}": f"v{n}.0.0" for n in range(2, verify_lib.GO_MAJOR_PROBE_MAX + 1)})
    proxy = _FakeProxy(versions)
    res = _with_proxy(proxy, lambda: verify_lib.latest_version_detail("go", "m/big"))
    assert res is not None
    assert res[0] == f"v{verify_lib.GO_MAJOR_PROBE_MAX}.0.0", res
    assert res[2] and f"/v{verify_lib.GO_MAJOR_PROBE_MAX}" in res[2], (
        f"an answer that sits on the ceiling must say so, got {res[2]}"
    )


def _with_payload(payload: dict, fn):
    original = verify_lib.http_cached
    verify_lib.http_cached = lambda *a, **k: payload  # type: ignore[assignment]
    try:
        return fn()
    finally:
        verify_lib.http_cached = original  # type: ignore[assignment]


def test_crates_answers_the_highest_stable_not_the_newest_publish() -> None:
    payload = {"crate": {"newest_version": "0.8.8", "max_stable_version": "0.10.2"}}
    res = _with_payload(payload, lambda: verify_lib.latest_version("crates", "rand"))
    assert res and res[0] == "0.10.2", f"a backported patch publishes last without being latest, got {res}"


def test_crates_falls_back_when_no_stable_release_exists() -> None:
    payload = {"crate": {"newest_version": "1.0.0-alpha.4", "max_stable_version": None}}
    res = _with_payload(payload, lambda: verify_lib.latest_version("crates", "newcrate"))
    assert res and res[0] == "1.0.0-alpha.4", f"a crate with no stable release still resolves, got {res}"


def test_hex_answers_the_latest_stable_release() -> None:
    payload = {"latest_stable_version": "1.4.5", "releases": [{"version": "1.5.0-alpha.2"}]}
    res = _with_payload(payload, lambda: verify_lib.latest_version("hex", "jason"))
    assert res and res[0] == "1.4.5", f"an alpha publish must not read as the current release, got {res}"


def test_hex_falls_back_when_only_pre_releases_exist() -> None:
    payload = {"releases": [{"version": "0.1.0-rc.1"}]}
    res = _with_payload(payload, lambda: verify_lib.latest_version("hex", "fresh"))
    assert res and res[0] == "0.1.0-rc.1", f"a package with no stable release still resolves, got {res}"


class _FakeProxy:
    """Stands in for proxy.golang.org. Records every module path asked for."""

    def __init__(self, versions: dict[str, str], offline: tuple[str, ...] = ()) -> None:
        self.versions = versions
        self.offline = offline
        self.asked: list[str] = []

    def __call__(self, url: str, *a, **k):
        module = url.removeprefix("https://proxy.golang.org/").removesuffix("/@latest")
        self.asked.append(module)
        if module in self.offline:
            return "offline", None
        if module in self.versions:
            return "ok", {"Version": self.versions[module]}
        return "missing", None


def _with_proxy(proxy: _FakeProxy, fn):
    original = verify_lib.http_cached_status
    verify_lib.http_cached_status = proxy  # type: ignore[assignment]
    try:
        return fn()
    finally:
        verify_lib.http_cached_status = original  # type: ignore[assignment]


def test_go_walk_finds_higher_major() -> None:
    proxy = _FakeProxy({"m/chezmoi": "v1.8.11", "m/chezmoi/v2": "v2.72.0"})
    res = _with_proxy(proxy, lambda: verify_lib.latest_version_detail("go", "m/chezmoi"))
    assert res is not None, "walk returned nothing"
    version, src, warning = res
    assert version == "v2.72.0", f"unversioned path must answer from the highest major, got {version}"
    assert src.endswith("/m/chezmoi/v2/@latest"), src
    assert warning is None, f"every major answered, so no warning is due: {warning}"


def test_go_walk_crosses_a_missing_major() -> None:
    proxy = _FakeProxy({"m/lib": "v1.0.0", "m/lib/v3": "v3.1.0"})
    res = _with_proxy(proxy, lambda: verify_lib.latest_version_detail("go", "m/lib"))
    assert res and res[0] == "v3.1.0", f"a module that skipped /v2 must still resolve v3, got {res}"


def test_go_walk_warns_on_an_unanswered_probe() -> None:
    proxy = _FakeProxy({"m/lib": "v1.0.0", "m/lib/v2": "v2.0.0"}, offline=("m/lib/v5",))
    res = _with_proxy(proxy, lambda: verify_lib.latest_version_detail("go", "m/lib"))
    assert res is not None
    assert res[0] == "v2.0.0", res
    assert res[2] and "/v5" in res[2], f"an unanswered probe above the answer must warn, got {res[2]}"


def test_go_explicit_major_is_answered_as_asked() -> None:
    proxy = _FakeProxy({"m/lib/v2": "v2.9.0", "m/lib/v3": "v3.0.0"})
    res = _with_proxy(proxy, lambda: verify_lib.latest_version_detail("go", "m/lib/v2"))
    assert res and res[0] == "v2.9.0", f"a path naming its major is answered as asked, got {res}"
    assert proxy.asked == ["m/lib/v2"], f"no walk is due for an explicit major, asked: {proxy.asked}"


def test_go_reactive_check_does_not_walk() -> None:
    proxy = _FakeProxy({"m/lib": "v1.0.0", "m/lib/v2": "v2.0.0"})
    res = _with_proxy(proxy, lambda: verify_lib.latest_version("go", "m/lib"))
    assert res and res[0] == "v1.0.0", f"latest_version answers the exact path, got {res}"
    assert proxy.asked == ["m/lib"], f"the edit-hook path must stay one request, asked: {proxy.asked}"


def test_go_walk_offline_is_not_a_version() -> None:
    proxy = _FakeProxy({}, offline=("m/lib",))
    res = _with_proxy(proxy, lambda: verify_lib.latest_version_detail("go", "m/lib"))
    assert res is None, f"an unreachable proxy must resolve to nothing, got {res}"
    assert proxy.asked == ["m/lib"], f"an unreachable base must not start a walk, asked: {proxy.asked}"


def test_http_cached_status_splits_missing_from_offline() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        cwd = os.getcwd()
        os.chdir(tmp)
        try:
            os.environ["DOSSIER_VERIFY_CACHE_ONLY"] = "1"
            status, data = verify_lib.http_cached_status("https://example.invalid/x.json")
            assert (status, data) == ("offline", None), (status, data)
            del os.environ["DOSSIER_VERIFY_CACHE_ONLY"]
            url = "https://example.invalid/miss.json"
            key = hashlib.sha1(url.encode()).hexdigest()
            cache = verify_lib.cache_dir() / f"{key}.json"
            cache.write_text(json.dumps({"fetched_at": 9e9, "data": None}))
            assert verify_lib.http_cached_status(url) == ("missing", None), "a cached 404 must replay as missing"
            assert verify_lib.http_cached(url) is None, "http_cached still answers None for a miss"
        finally:
            os.environ.pop("DOSSIER_VERIFY_CACHE_ONLY", None)
            os.chdir(cwd)


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
                "tool_input": {
                    "file_path": "src/foo.ts",
                    "new_string": "// PH3-B7: guard",
                },
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
        _write_skill(
            root, "alpha", 'Do alpha. Invoke when the user says "alpha", "a1".'
        )
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
        os.environ.pop("DOSSIER_SCRATCHPAD_ROOT", None)


_GUARD_ENTRY = {
    "id": "V1",
    "pattern": r"eval\(",
    "message": "no eval",
    "paths": ["src/*.py"],
}


def _write_payload(path: str, content: str) -> dict:
    return {"tool_name": "Write", "tool_input": {"file_path": path, "content": content}}


def test_invariant_guard_blocks_registered_pattern() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _invariant_registry(root, [_GUARD_ENTRY])
        rc, _ = _drive_in(
            invariant_guard, _write_payload("src/app.py", "x = eval(y)"), root
        )
        assert rc == 2, rc


def test_invariant_guard_allows_non_match() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _invariant_registry(root, [_GUARD_ENTRY])
        rc, _ = _drive_in(
            invariant_guard, _write_payload("src/app.py", "x = safe(y)"), root
        )
        assert rc == 0, rc


def test_invariant_guard_out_of_scope_path() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _invariant_registry(root, [_GUARD_ENTRY])
        rc, _ = _drive_in(
            invariant_guard, _write_payload("other/app.py", "x = eval(y)"), root
        )
        assert rc == 0, rc


def test_invariant_guard_dossier_pass_through() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _invariant_registry(
            root, [{"id": "V1", "pattern": r"eval\(", "message": "no eval"}]
        )
        rc, _ = _drive_in(
            invariant_guard,
            _write_payload(".scratchpad/dossier/x/DOSSIER.md", "eval("),
            root,
        )
        assert rc == 0, rc


def test_invariant_guard_no_registry_failopen() -> None:
    with tempfile.TemporaryDirectory() as d:
        rc, _ = _drive_in(
            invariant_guard, _write_payload("src/app.py", "eval("), Path(d)
        )
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
        _invariant_registry(
            root, [{"id": "V1", "pattern": r"eval\(", "message": "no eval"}]
        )
        os.environ["DOSSIER_INVARIANT_GUARD"] = "off"
        try:
            rc, _ = _drive_in(
                invariant_guard, _write_payload("src/app.py", "eval("), root
            )
        finally:
            os.environ.pop("DOSSIER_INVARIANT_GUARD", None)
        assert rc == 0, rc


def test_invariant_guard_stays_silent_where_no_registry_exists() -> None:
    with tempfile.TemporaryDirectory() as bare_root:
        payload = _write_payload("src/app.py", "x = eval(y)")
        payload["cwd"] = bare_root
        rc, out = _drive_in(invariant_guard, payload, Path(bare_root))
        assert rc == 0 and out == "", (rc, out)


def test_invariant_guard_leaves_no_artifact_outside_scratchpad() -> None:
    with tempfile.TemporaryDirectory() as root:
        (Path(root) / ".scratchpad" / "dossier").mkdir(parents=True)
        reg = Path(root) / ".dossier"
        reg.mkdir(parents=True)
        (reg / "invariant-guards.json").write_text(
            json.dumps([_GUARD_ENTRY]), encoding="utf-8"
        )
        payload = _write_payload("src/app.py", "x = eval(y)")
        payload["cwd"] = root
        rc, out = _drive_in(invariant_guard, payload, Path(root))
        assert rc == 0 and out == "", (rc, out)


def test_invariant_guard_skips_a_project_with_no_dossier_tree() -> None:
    with (
        tempfile.TemporaryDirectory() as dossier_root,
        tempfile.TemporaryDirectory() as bare_root,
    ):
        _invariant_registry(Path(dossier_root), [_GUARD_ENTRY])
        payload = _write_payload("src/app.py", "x = eval(y)")
        payload["cwd"] = bare_root
        rc, out = _drive_in(invariant_guard, payload, Path(dossier_root))
        assert rc == 0 and out == "", (rc, out)


_PROBE_RULE = {
    "ruleName": "probe-freshness",
    "regex": r"PROBE-([A-Z0-9]+)",
    "check_args": [1],
    "check": lambda token: (f"probe {token}", "superseded", "https://example.invalid"),
    "icon": "!",
    "scope": "all",
}


@contextlib.contextmanager
def _only_probe_rule(rules: list | None = None):
    import verify_patterns

    active = [_PROBE_RULE] if rules is None else rules
    saved_registry = verify_patterns.VERIFY_PATTERNS
    saved_sweep = verify_sweep.VERIFY_PATTERNS
    verify_patterns.VERIFY_PATTERNS = active
    verify_sweep.VERIFY_PATTERNS = active
    try:
        yield
    finally:
        verify_patterns.VERIFY_PATTERNS = saved_registry
        verify_sweep.VERIFY_PATTERNS = saved_sweep


def _probe_hits(hook_stdout: str) -> int:
    if not hook_stdout:
        return 0
    ctx = json.loads(hook_stdout)["hookSpecificOutput"]["additionalContext"]
    return sum(1 for line in ctx.splitlines() if "probe ABC" in line)


def _dossier_workspace(root: str) -> Path:
    ws = Path(root)
    (ws / ".scratchpad" / "dossier").mkdir(parents=True, exist_ok=True)
    return ws


def _verify_payload(ws: Path, body: str, file_path: str = "app.py") -> dict:
    return {
        "tool_name": "Write",
        "cwd": str(ws),
        "tool_input": {"file_path": file_path, "content": body},
    }


def test_verify_hook_emits_reminder_when_a_rule_fires() -> None:
    with tempfile.TemporaryDirectory() as d:
        ws = _dossier_workspace(d)
        with _only_probe_rule():
            rc, out = _drive_in(
                verify_hook, _verify_payload(ws, "x = 'PROBE-ABC'\n"), ws
            )
        assert rc == 0, rc
        assert "additionalContext" in out, out
        assert "probe ABC" in out, out


def test_verify_hook_stays_silent_on_benign_content() -> None:
    with tempfile.TemporaryDirectory() as d:
        ws = _dossier_workspace(d)
        with _only_probe_rule():
            rc, out = _drive_in(verify_hook, _verify_payload(ws, "x = 1\n"), ws)
        assert rc == 0 and out == "", (rc, out)


def test_verify_hook_dedups_a_repeated_finding() -> None:
    with tempfile.TemporaryDirectory() as d:
        ws = _dossier_workspace(d)
        payload = _verify_payload(ws, "x = 'PROBE-ABC'\n")
        with _only_probe_rule():
            _, first = _drive_in(verify_hook, payload, ws)
            _, second = _drive_in(verify_hook, payload, ws)
        assert "additionalContext" in first, first
        assert second == "", second


def test_verify_hook_honours_an_inline_skip_marker() -> None:
    with tempfile.TemporaryDirectory() as d:
        ws = _dossier_workspace(d)
        body = "x = 'PROBE-ABC'  # verify-skip: probe-freshness\n"
        with _only_probe_rule():
            rc, out = _drive_in(verify_hook, _verify_payload(ws, body), ws)
        assert rc == 0 and out == "", (rc, out)


def test_verify_hook_skip_marker_covers_matches_above_it() -> None:
    with tempfile.TemporaryDirectory() as d:
        ws = _dossier_workspace(d)
        body = "x = 'PROBE-ABC'\n# verify-skip: probe-freshness\ny = 'PROBE-ABC'\n"
        with _only_probe_rule():
            rc, out = _drive_in(verify_hook, _verify_payload(ws, body), ws)
        assert rc == 0 and out == "", (rc, out)


def test_verify_hook_dedups_a_repeat_inside_one_call() -> None:
    with tempfile.TemporaryDirectory() as d:
        ws = _dossier_workspace(d)
        body = "a = 'PROBE-ABC'\nb = 'PROBE-ABC'\nc = 'PROBE-ABC'\n"
        with _only_probe_rule():
            _, out = _drive_in(verify_hook, _verify_payload(ws, body), ws)
        assert _probe_hits(out) == 1, out


def test_verify_hook_keeps_distinct_findings_from_one_call() -> None:
    with tempfile.TemporaryDirectory() as d:
        ws = _dossier_workspace(d)
        body = "a = 'PROBE-ABC'\nb = 'PROBE-XYZ'\n"
        with _only_probe_rule():
            _, out = _drive_in(verify_hook, _verify_payload(ws, body), ws)
        ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"]
        assert "probe ABC" in ctx and "probe XYZ" in ctx, ctx


def test_verify_sweep_reports_a_stale_claim_on_disk() -> None:
    with tempfile.TemporaryDirectory() as d:
        target = Path(d) / "app.py"
        target.write_text("x = 'PROBE-ABC'\n", encoding="utf-8")
        with _only_probe_rule():
            findings = verify_sweep.scan(str(target))
        assert len(findings) == 1, findings
        assert "probe ABC" in findings[0], findings


def test_verify_sweep_stays_silent_on_benign_content() -> None:
    with tempfile.TemporaryDirectory() as d:
        target = Path(d) / "app.py"
        target.write_text("x = 1\n", encoding="utf-8")
        with _only_probe_rule():
            findings = verify_sweep.scan(str(target))
        assert findings == [], findings


def test_verify_sweep_honours_an_inline_skip_marker() -> None:
    with tempfile.TemporaryDirectory() as d:
        target = Path(d) / "app.py"
        target.write_text(
            "x = 'PROBE-ABC'\n# verify-skip: probe-freshness\n", encoding="utf-8"
        )
        with _only_probe_rule():
            findings = verify_sweep.scan(str(target))
        assert findings == [], findings


def test_verify_sweep_scopes_a_yaml_rule_off_a_python_file() -> None:
    yaml_only = dict(_PROBE_RULE, scope="yaml")
    with tempfile.TemporaryDirectory() as d:
        py_file = Path(d) / "app.py"
        py_file.write_text("x = 'PROBE-ABC'\n", encoding="utf-8")
        yaml_file = Path(d) / "app.yaml"
        yaml_file.write_text("x: PROBE-ABC\n", encoding="utf-8")
        with _only_probe_rule([yaml_only]):
            assert verify_sweep.scan(str(py_file)) == [], py_file
            assert len(verify_sweep.scan(str(yaml_file))) == 1, yaml_file


def test_verify_sweep_ignores_a_missing_file() -> None:
    with tempfile.TemporaryDirectory() as d:
        with _only_probe_rule():
            assert verify_sweep.scan(str(Path(d) / "absent.py")) == []


def test_verify_sweep_and_hook_agree_on_a_repeated_claim() -> None:
    body = "a = 'PROBE-ABC'\nb = 'PROBE-ABC'\nc = 'PROBE-ABC'\n"
    with tempfile.TemporaryDirectory() as d:
        ws = _dossier_workspace(d)
        target = ws / "app.py"
        target.write_text(body, encoding="utf-8")
        with _only_probe_rule():
            _, out = _drive_in(verify_hook, _verify_payload(ws, body), ws)
            findings = verify_sweep.scan(str(target))
        assert _probe_hits(out) == len(findings), (out, findings)


def test_tlr_header_carries_every_documented_trigger() -> None:
    for trig in ("explicit", "precompact", "sessionend"):
        body = roll_lib.render_tlr([], "sess-9", trig)
        assert roll_lib.parse_tlr_header(body).get("trig") == trig, body


def test_verify_lib_ships_no_unreferenced_check_helper() -> None:
    import re

    hooks_dir = Path(__file__).resolve().parent
    lib_src = (hooks_dir / "verify_lib.py").read_text(encoding="utf-8")
    defined = re.findall(r"^def (check_\w+)", lib_src, re.MULTILINE)
    assert defined, "verify_lib.py defines no check_* helper"
    sources = [
        p.read_text(encoding="utf-8")
        for p in sorted(hooks_dir.glob("*.py"))
        if p.name != Path(__file__).name
    ]
    orphans = [
        name
        for name in defined
        if sum(len(re.findall(rf"\b{name}\b", src)) for src in sources) < 2
    ]
    assert not orphans, f"unreferenced verify_lib helpers: {orphans}"


def test_verify_hook_caches_under_the_payload_cwd() -> None:
    with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as other:
        ws, elsewhere = _dossier_workspace(d), Path(other)
        with _only_probe_rule():
            rc, _ = _drive_in(verify_hook, _verify_payload(ws, "x = 1\n"), elsewhere)
        assert rc == 0, rc
        assert (ws / ".scratchpad" / ".verify-cache").is_dir(), "payload cwd"
        assert not (elsewhere / ".scratchpad").exists(), "process cwd stays clean"


def test_verify_hook_caches_under_the_process_cwd_without_a_payload_cwd() -> None:
    with tempfile.TemporaryDirectory() as d:
        ws = _dossier_workspace(d)
        payload = _verify_payload(ws, "x = 1\n")
        del payload["cwd"]
        with _only_probe_rule():
            rc, _ = _drive_in(verify_hook, payload, ws)
        assert rc == 0, rc
        assert (ws / ".scratchpad" / ".verify-cache").is_dir(), "cwd fallback"


def _roll_payload(root: Path, cwd: Path | None) -> dict:
    events = [
        {
            "sessionId": "s7",
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "name": "TaskCreate",
                        "id": "r1",
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
                        "tool_use_id": "r1",
                        "content": "Task #1 created successfully: A",
                    }
                ]
            }
        },
    ]
    tpath = root / "t.jsonl"
    tpath.write_text("\n".join(json.dumps(e) for e in events) + "\n")
    payload = {
        "transcript_path": str(tpath),
        "session_id": "s7",
        "hook_event_name": "SessionEnd",
    }
    if cwd is not None:
        payload["cwd"] = str(cwd)
    return payload


def test_precompact_rolls_under_the_payload_cwd() -> None:
    pr = _load_hyphen("precompact_roll_cwd", "precompact-roll.py")
    with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as other:
        ws, elsewhere = Path(d), Path(other)
        rc, _ = _drive_in(pr, _roll_payload(ws, ws), elsewhere)
        assert rc == 0, rc
        assert list((ws / ".scratchpad" / ".tasklist-roll").glob("*.tlr")), (
            "roll follows payload cwd"
        )
        assert not (elsewhere / ".scratchpad").exists(), "process cwd stays clean"


def test_precompact_rolls_under_the_process_cwd_without_a_payload_cwd() -> None:
    pr = _load_hyphen("precompact_roll_nocwd", "precompact-roll.py")
    with tempfile.TemporaryDirectory() as d:
        ws = Path(d)
        rc, _ = _drive_in(pr, _roll_payload(ws, None), ws)
        assert rc == 0, rc
        assert list((ws / ".scratchpad" / ".tasklist-roll").glob("*.tlr")), (
            "cwd is the fallback root"
        )


def test_precompact_ignores_a_payload_cwd_that_is_not_a_directory() -> None:
    pr = _load_hyphen("precompact_roll_gone", "precompact-roll.py")
    with tempfile.TemporaryDirectory() as d:
        ws = Path(d)
        gone = ws / "removed-worktree"
        payload = _roll_payload(ws, gone)
        rc, _ = _drive_in(pr, payload, ws)
        assert rc == 0, rc
        assert not gone.exists(), "a removed worktree must not be resurrected"
        assert list((ws / ".scratchpad" / ".tasklist-roll").glob("*.tlr")), (
            "the roll falls back to the process cwd"
        )


def test_precompact_exits_zero_when_the_root_cannot_be_written() -> None:
    pr = _load_hyphen("precompact_roll_ro", "precompact-roll.py")
    with tempfile.TemporaryDirectory() as d:
        ws = Path(d)
        payload = _roll_payload(ws, ws)
        locked = ws / "locked"
        locked.mkdir()
        payload["cwd"] = str(locked)
        locked.chmod(0o500)
        try:
            rc, _ = _drive_in(pr, payload, ws)
        finally:
            locked.chmod(0o700)
        assert rc == 0, "the hook always exits 0, whatever the root does"
        assert not (locked / ".scratchpad").exists(), "an unwritable root stays untouched"


def test_precompact_exits_zero_when_the_process_cwd_is_gone() -> None:
    pr = _load_hyphen("precompact_roll_nocwd_gone", "precompact-roll.py")
    with tempfile.TemporaryDirectory() as d:
        ws = Path(d)
        payload = _roll_payload(ws, ws / "removed-worktree")
        vanished = ws / "vanished"
        vanished.mkdir()
        old = Path.cwd()
        os.chdir(vanished)
        try:
            vanished.rmdir()
            with contextlib.redirect_stderr(io.StringIO()):
                rc, _ = _drive(pr, payload)
        finally:
            os.chdir(old)
            os.environ.pop("DOSSIER_SCRATCHPAD_ROOT", None)
        assert rc == 0, "a removed process cwd must not raise out of the hook"


def test_invariant_guard_reads_the_registry_from_the_payload_cwd() -> None:
    with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as other:
        ws = Path(d)
        _invariant_registry(ws, [_GUARD_ENTRY])
        payload = _write_payload("src/app.py", "x = eval(y)")
        payload["cwd"] = str(ws)
        rc, _ = _drive_in(invariant_guard, payload, Path(other))
        assert rc == 2, "the guard must fire from a subdirectory too"


def test_invariant_guard_stays_open_when_the_payload_cwd_holds_no_registry() -> None:
    with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as other:
        ws = Path(d)
        (ws / ".scratchpad" / "dossier").mkdir(parents=True)
        payload = _write_payload("src/app.py", "x = eval(y)")
        payload["cwd"] = str(ws)
        rc, _ = _drive_in(invariant_guard, payload, Path(other))
        assert rc == 0, "no registry stays fail-open"


def _run() -> int:
    os.environ.pop("DOSSIER_SCRATCHPAD_ROOT", None)
    wanted = ""
    argv = sys.argv[1:]
    if "-k" in argv:
        index = argv.index("-k")
        if index + 1 == len(argv):
            print("-k needs a substring", file=sys.stderr)
            return 1
        wanted = argv[index + 1]
    tests = [
        v
        for k, v in sorted(globals().items())
        if k.startswith("test_") and callable(v) and (not wanted or wanted in k)
    ]
    if wanted and not tests:
        print(f"no test matched {wanted!r}", file=sys.stderr)
        return 1
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
