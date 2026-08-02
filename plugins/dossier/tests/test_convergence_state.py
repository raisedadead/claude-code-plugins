#!/usr/bin/env python3
"""Stdlib-only tests for convergence_state.py. Run directly or via pytest.

This hook fires on every user prompt in every repo where the plugin is
installed. Most of these tests are about staying silent and exiting 0 when it
has nothing to say, because the cost of a wrong answer is paid by someone who
never asked for it.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

PLUGIN = Path(__file__).resolve().parent.parent
HOOK = PLUGIN / "hooks" / "convergence_state.py"

CONTRACT = "\n".join(
    [
        "# demo-wave",
        "",
        "| field    | value     |",
        "| -------- | --------- |",
        "| consumer | the tests |",
        "| budget   | 4 commits |",
        "",
        "## done-when",
        "",
        "| id  | command | expect |",
        "| --- | ------- | ------ |",
        "| 1   | `true`  | exit 0 |",
        "| 2   | `false` | exit 1 |",
        "",
    ]
)


def _run(payload: object, timeout: float = 10.0) -> subprocess.CompletedProcess[str]:
    raw = payload if isinstance(payload, str) else json.dumps(payload)
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=raw,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", *args],
        cwd=repo,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _live_ledger(root: Path, slug: str) -> None:
    wave = root / ".scratchpad" / "dossier" / f"2026-08-01-{slug}"
    wave.mkdir(parents=True, exist_ok=True)
    (wave / "DOSSIER.md").write_text(
        "\n".join([f"# {slug}", "", "`2026-08-01` · `live` · `P1/1`", ""]),
        encoding="utf-8",
    )


def _repo_with_contract(root: Path) -> None:
    _git(root, "init", "-q", "-b", "main")
    _git(root, "config", "user.email", "t@example.com")
    _git(root, "config", "user.name", "t")
    (root / ".dossier").mkdir()
    (root / ".dossier" / "2026-08-01-demo-wave.md").write_text(
        CONTRACT, encoding="utf-8"
    )
    _live_ledger(root, "demo-wave")
    _git(root, "add", ".")
    _git(root, "commit", "-q", "-m", "chore: contract")


def test_a_repo_with_no_contract_says_nothing() -> None:
    with tempfile.TemporaryDirectory() as t:
        result = _run({"cwd": t})
        assert result.returncode == 0, result.stderr
        assert result.stdout == "", result.stdout


def test_a_repo_with_a_contract_names_the_wave() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        _repo_with_contract(root)
        result = _run({"cwd": str(root)})
        assert result.returncode == 0, result.stderr
        assert "demo-wave" in result.stdout, result.stdout


def test_it_reports_criteria_count_without_running_them() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        _repo_with_contract(root)
        result = _run({"cwd": str(root)})
        assert "2 criteria" in result.stdout, result.stdout


def test_it_reports_budget_usage() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        _repo_with_contract(root)
        result = _run({"cwd": str(root)})
        assert "of 4" in result.stdout, result.stdout


def test_malformed_stdin_never_breaks_the_prompt() -> None:
    result = _run("this is not json")
    assert result.returncode == 0, result.stderr
    assert result.stdout == "", result.stdout


def test_empty_stdin_never_breaks_the_prompt() -> None:
    result = _run("")
    assert result.returncode == 0, result.stderr
    assert result.stdout == "", result.stdout


def test_a_missing_cwd_never_breaks_the_prompt() -> None:
    result = _run({"cwd": "/nonexistent/path/for/a/test"})
    assert result.returncode == 0, result.stderr
    assert result.stdout == "", result.stdout


def test_a_contract_outside_a_git_repo_still_reports() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        (root / ".dossier").mkdir()
        (root / ".dossier" / "x-demo-wave.md").write_text(CONTRACT, encoding="utf-8")
        _live_ledger(root, "demo-wave")
        result = _run({"cwd": str(root)})
        assert result.returncode == 0, result.stderr
        assert "demo-wave" in result.stdout, result.stdout


def test_an_unreadable_contract_never_breaks_the_prompt() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        (root / ".dossier").mkdir()
        (root / ".dossier" / "broken.md").write_text("nothing here\n", encoding="utf-8")
        _live_ledger(root, "broken")
        result = _run({"cwd": str(root)})
        assert result.returncode == 0, result.stderr


def test_it_reports_the_layer_mix_of_recent_work() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        _repo_with_contract(root)
        (root / "a.py").write_text("x = 1\n", encoding="utf-8")
        (root / "README.md").write_text("hi\n", encoding="utf-8")
        _git(root, "add", "a.py", "README.md")
        _git(root, "commit", "-q", "-m", "feat: work")
        result = _run({"cwd": str(root)})
        assert "runtime" in result.stdout, result.stdout
        assert "docs" in result.stdout, result.stdout


def test_a_contractless_live_wave_is_named() -> None:
    """A wave with no definition of done is where the loop is needed most."""
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        _git(root, "init", "-q", "-b", "main")
        _git(root, "config", "user.email", "t@example.com")
        _git(root, "config", "user.name", "t")
        wave = root / ".scratchpad" / "dossier" / "2026-08-01-demo"
        wave.mkdir(parents=True)
        (wave / "DOSSIER.md").write_text(
            "\n".join(["# demo", "", "`2026-08-01` · `live` · `P1/1`", ""]),
            encoding="utf-8",
        )
        result = _run({"cwd": str(root)})
        assert result.returncode == 0, result.stderr
        assert "demo" in result.stdout, result.stdout
        assert "no contract" in result.stdout, result.stdout


def test_a_contractless_archived_wave_is_not_named() -> None:
    """Closed waves are not missing anything."""
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        wave = root / ".scratchpad" / "dossier" / "_archive" / "2026-07-01-old"
        wave.mkdir(parents=True)
        (wave / "DOSSIER.md").write_text(
            "\n".join(["# old", "", "`2026-07-01` · `done` · `P1/1`", ""]),
            encoding="utf-8",
        )
        result = _run({"cwd": str(root)})
        assert result.returncode == 0, result.stderr
        assert result.stdout == "", result.stdout


def test_the_live_wave_is_reported_not_the_alphabetical_last() -> None:
    """Two contracts, one live wave. Sorting picked the closed one."""
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        _git(root, "init", "-q", "-b", "main")
        _git(root, "config", "user.email", "t@example.com")
        _git(root, "config", "user.name", "t")
        (root / ".dossier").mkdir()
        (root / ".dossier" / "2026-08-01-aaa-live.md").write_text(
            CONTRACT.replace("demo-wave", "aaa-live"), encoding="utf-8"
        )
        (root / ".dossier" / "2026-08-01-zzz-closed.md").write_text(
            CONTRACT.replace("demo-wave", "zzz-closed"), encoding="utf-8"
        )
        wave = root / ".scratchpad" / "dossier" / "2026-08-01-aaa-live"
        wave.mkdir(parents=True)
        (wave / "DOSSIER.md").write_text(
            "\n".join(["# aaa-live", "", "`2026-08-01` · `live` · `P1/1`", ""]),
            encoding="utf-8",
        )
        _git(root, "add", ".")
        _git(root, "commit", "-q", "-m", "chore: two contracts")
        result = _run({"cwd": str(root)})
        assert "aaa-live" in result.stdout, result.stdout
        assert "zzz-closed" not in result.stdout, result.stdout


def test_a_same_slug_successor_reports_the_live_wave() -> None:
    """Two contracts share the slug `rails`; the report keys on the live wave's
    directory name, never on a title both waves carry."""
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        (root / ".dossier").mkdir()
        old = CONTRACT.replace("demo-wave", "rails")
        new = CONTRACT.replace("demo-wave", "rails").replace(
            "| 2   | `false` | exit 1 |",
            "| 2   | `false` | exit 1 |\n| 3   | `true`  | exit 0 |",
        )
        (root / ".dossier" / "2026-08-01-rails.md").write_text(old, encoding="utf-8")
        (root / ".dossier" / "2026-08-05-rails.md").write_text(new, encoding="utf-8")
        wave = root / ".scratchpad" / "dossier" / "2026-08-05-rails"
        wave.mkdir(parents=True)
        (wave / "DOSSIER.md").write_text(
            "\n".join(["# rails", "", "`2026-08-05` · `live` · `P1/1`", ""]),
            encoding="utf-8",
        )
        result = _run({"cwd": str(root)})
        assert "3 criteria" in result.stdout, result.stdout
        assert "2 criteria" not in result.stdout, result.stdout


def test_a_wave_dir_contract_is_reported() -> None:
    """A repo that never opted into tracked contracts still gets the report."""
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        wave = root / ".scratchpad" / "dossier" / "2026-08-01-solo"
        wave.mkdir(parents=True)
        (wave / "DOSSIER.md").write_text(
            "\n".join(["# solo", "", "`2026-08-01` · `live` · `P1/1`", ""]),
            encoding="utf-8",
        )
        (wave / "CONTRACT.md").write_text(CONTRACT, encoding="utf-8")
        result = _run({"cwd": str(root)})
        assert result.returncode == 0, result.stderr
        assert "2 criteria" in result.stdout, result.stdout
        assert "no contract" not in result.stdout, result.stdout


def test_no_live_wave_means_silence() -> None:
    """A closed wave's contract is not prompt noise."""
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        (root / ".dossier").mkdir()
        (root / ".dossier" / "2026-08-01-done.md").write_text(
            CONTRACT, encoding="utf-8"
        )
        result = _run({"cwd": str(root)})
        assert result.returncode == 0, result.stderr
        assert result.stdout == "", result.stdout


def test_it_finishes_fast_enough_to_sit_on_every_prompt() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        _repo_with_contract(root)
        result = _run({"cwd": str(root)}, timeout=5.0)
        assert "demo-wave" in result.stdout, result.stdout


def _main() -> int:
    wanted = ""
    argv = sys.argv[1:]
    if "-k" in argv:
        wanted = argv[argv.index("-k") + 1]
    failures = 0
    selected = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        if wanted and wanted not in name:
            continue
        selected += 1
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
    if wanted and not selected:
        print(f"no test matched {wanted!r}", file=sys.stderr)
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
