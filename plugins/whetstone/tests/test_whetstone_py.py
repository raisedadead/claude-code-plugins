#!/usr/bin/env python3
"""Stdlib-only tests for the whetstone python helpers. Run directly or via pytest."""

from __future__ import annotations

import importlib.util
import sys
import tempfile
from pathlib import Path

PLUGIN = Path(__file__).resolve().parent.parent


def _load(mod_name: str, rel: str) -> object:
    path = PLUGIN / rel
    spec = importlib.util.spec_from_file_location(mod_name, path)
    assert spec and spec.loader, rel
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


lint_skill = _load("lint_skill", "skills/skill-smith/scripts/lint_skill.py")
compute_flakiness = _load(
    "compute_flakiness", "skills/flaky-test-audit/scripts/compute_flakiness.py"
)


def _write_skill(root: Path, name: str, frontmatter: str, body: str = "body\n") -> Path:
    d = root / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(f"---\n{frontmatter}\n---\n\n{body}", encoding="utf-8")
    return d / "SKILL.md"


def test_lint_clean() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        p = _write_skill(
            root,
            "good-skill",
            "name: good-skill\ndescription: Does a good thing. Use when the user asks to do good.",
        )
        assert lint_skill.lint(p) == [], lint_skill.lint(p)


def test_lint_yaml_colon_space_in_unquoted_description() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        p = _write_skill(
            root,
            "backprop",
            'name: backprop\ndescription: Traces a root cause. Invoke when the user says "bug: <description>".',
        )
        findings = lint_skill.lint(p)
        assert any("YAML-safe" in f and f.startswith("FAIL") for f in findings), (
            findings
        )


def test_lint_yaml_flow_indicator_in_unquoted_value() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        p = _write_skill(
            root,
            "ship",
            "name: ship\ndescription: Ships it. Use when the user asks to ship.\n"
            "argument-hint: [--preview] [--changelog <path>]",
        )
        findings = lint_skill.lint(p)
        assert any("YAML-safe" in f and f.startswith("FAIL") for f in findings), (
            findings
        )


def test_lint_yaml_quoted_values_do_not_false_positive() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        p = _write_skill(
            root,
            "quoted",
            "name: quoted\n"
            "description: 'Does it. Use when the user says \"bug: <x>\".'\n"
            "argument-hint: '[--preview] | --all'",
        )
        findings = lint_skill.lint(p)
        assert not any("YAML-safe" in f for f in findings), findings


def test_lint_yaml_plain_pipe_value_is_not_flagged() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        p = _write_skill(
            root,
            "build",
            "name: build\ndescription: Builds. Use when the user asks to build.\n"
            "argument-hint: <T-id> | --next | --auto",
        )
        findings = lint_skill.lint(p)
        assert not any("YAML-safe" in f for f in findings), findings


def test_lint_name_mismatch() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        p = _write_skill(
            root, "good-skill", "name: wrong-name\ndescription: Thing. Use when asked."
        )
        findings = lint_skill.lint(p)
        assert any("FAIL" in f and "name" in f for f in findings), findings


def test_lint_missing_trigger() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        p = _write_skill(
            root, "s", "name: s\ndescription: Does a thing with no trigger clause."
        )
        findings = lint_skill.lint(p)
        assert any("trigger" in f for f in findings), findings


def test_lint_bad_name_charset() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        p = _write_skill(
            root, "Bad_Name", "name: Bad_Name\ndescription: Thing. Use when asked."
        )
        findings = lint_skill.lint(p)
        assert any("name" in f for f in findings), findings


def test_lint_over_line_budget() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        big = "\n".join(f"line {i}" for i in range(600)) + "\n"
        p = _write_skill(
            root, "s", "name: s\ndescription: Thing. Use when asked.", body=big
        )
        findings = lint_skill.lint(p)
        assert any("500" in f for f in findings), findings


def test_lint_reference_too_deep() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        p = _write_skill(root, "s", "name: s\ndescription: Thing. Use when asked.")
        deep = root / "s" / "reference" / "nested"
        deep.mkdir(parents=True)
        (deep / "x.md").write_text("x", encoding="utf-8")
        findings = lint_skill.lint(p)
        assert any("deep" in f or "level" in f for f in findings), findings


def test_lint_firstperson_in_quotes_ok() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        p = _write_skill(
            root,
            "s",
            'name: s\ndescription: Correct a slip. Use when the user says "I asked you to X", "you forgot".',
        )
        findings = lint_skill.lint(p)
        assert not any("first-person" in f for f in findings), findings


def test_lint_firstperson_narration_warn() -> None:
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        p = _write_skill(
            root, "s", "name: s\ndescription: I help you fix things. Use when asked."
        )
        findings = lint_skill.lint(p)
        assert any("first-person" in f for f in findings), findings


def test_flakiness_rates() -> None:
    rates = compute_flakiness.compute_rates(
        {
            "t_pass": {"runs": 5, "fails": 0},
            "t_fail": {"runs": 5, "fails": 5},
            "t_flaky": {"runs": 5, "fails": 2},
        }
    )
    assert rates["t_pass"]["flaky"] is False, rates["t_pass"]
    assert rates["t_fail"]["flaky"] is False, rates["t_fail"]
    assert rates["t_flaky"]["flaky"] is True, rates["t_flaky"]
    assert abs(rates["t_flaky"]["rate"] - 0.4) < 1e-9, rates["t_flaky"]


def test_flakiness_quarantine_and_new() -> None:
    rates = compute_flakiness.compute_rates(
        {"a": {"runs": 4, "fails": 1}, "b": {"runs": 4, "fails": 0}}
    )
    q = compute_flakiness.quarantine(rates)
    assert set(q) == {"a"}, q
    assert compute_flakiness.new_flags(q, {}) == ["a"]
    assert compute_flakiness.new_flags(q, {"a": 0.25}) == []


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
