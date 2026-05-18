#!/usr/bin/env python3
"""Verify-layer sweep — scan existing files for stale claims.

Same pattern registry as verify_hook.py, but applied to file contents on disk
(not tool_input). Used by ds:check.

Usage:
    verify_sweep.py <file> [<file>...]

Exits 0 always. Prints findings to stdout, one per line:
    <file>:<rule>: <claim> -> <truth>  [src: <url>]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from verify_patterns import VERIFY_PATTERNS
except Exception as exc:  # noqa: BLE001
    print(f"verify-sweep load error: {type(exc).__name__}: {exc}", file=sys.stderr)
    sys.exit(0)


def _scope_ok(scope: str, path: str) -> bool:
    if scope == "all":
        return True
    if scope == "yaml":
        return path.endswith((".yml", ".yaml"))
    if scope == "json":
        return path.endswith(".json")
    if scope == "md":
        return path.endswith(".md")
    return True


_SKIP_LINE = re.compile(r"#\s*verify-skip:\s*([\w,-]+)")


def _skip_set(content: str) -> set[str]:
    out: set[str] = set()
    for m in _SKIP_LINE.finditer(content):
        for name in m.group(1).split(","):
            name = name.strip()
            if name:
                out.add(name)
    return out


def scan(file_path: str) -> list[str]:
    p = Path(file_path)
    if not p.is_file():
        return []
    try:
        content = p.read_text(errors="replace")
    except OSError:
        return []
    skipped = _skip_set(content)
    out: list[str] = []
    seen: set[str] = set()
    for rule in VERIFY_PATTERNS:
        name = rule["ruleName"]
        if name in skipped:
            continue
        if not _scope_ok(rule.get("scope", "all"), file_path):
            continue
        pc = rule.get("path_check")
        if pc and not pc(file_path):
            continue
        try:
            pattern = re.compile(rule["regex"], rule.get("_flags", 0))
        except re.error:
            continue
        for m in pattern.finditer(content):
            try:
                args = [m.group(i) for i in rule["check_args"]]
            except IndexError:
                continue
            try:
                finding = rule["check"](*args)
            except Exception:  # noqa: BLE001
                finding = None
            if not finding:
                continue
            claim, truth, src = finding
            key = f"{name}:{claim}"
            if key in seen:
                continue
            seen.add(key)
            out.append(f"{file_path}:{name}: {claim} -> {truth}  [src: {src}]")
    return out


def main(argv: list[str]) -> int:
    findings: list[str] = []
    for f in argv[1:]:
        findings.extend(scan(f))
    for line in findings:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
