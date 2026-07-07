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
