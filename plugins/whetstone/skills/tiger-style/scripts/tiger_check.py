#!/usr/bin/env python3
"""Check the column budget of lines a commit ADDS, reading the staged diff.

Exit codes:
  0  clean
  1  offences against a limit the repo declared  (BLOCK)
  2  offences against the built-in 100 fallback  (NAG, advisory)
  64 usage error — the path is not a git work tree

The limit is resolved per file: WHETSTONE_TIGER_COLS, else the .editorconfig
max_line_length of the nearest matching section, else 100 as a nag-only default.
A declared limit blocks; the fallback never does.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

FALLBACK_COLS = 100
OFF = -1
CLEAN, BLOCK, NAG, USAGE = 0, 1, 2, 64

SKIP_SUFFIXES = frozenset(
    {
        ".md",
        ".markdown",
        ".rst",
        ".txt",
        ".json",
        ".jsonl",
        ".csv",
        ".tsv",
        ".svg",
        ".lock",
        ".snap",
    }
)
SKIP_NAMES = frozenset({"go.sum", "yarn.lock", "poetry.lock", "Cargo.lock"})

_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def _run_git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], cwd=root, capture_output=True, text=True, check=False
    )


def _is_work_tree(root: Path) -> bool:
    if not root.is_dir():
        return False
    probe = _run_git(root, "rev-parse", "--is-inside-work-tree")
    return probe.returncode == 0 and probe.stdout.strip() == "true"


def _staged_added_lines(root: Path) -> list[tuple[str, int, str]]:
    """Return (path, line-number, text) for every line the index ADDS.

    Reads `--cached`, never `HEAD`: `git diff HEAD` is empty when a change
    consists only of staged-new files, which silently disarms the check.
    """
    diff = _run_git(
        root, "diff", "--cached", "--unified=0", "--no-color", "--no-ext-diff", "-M"
    )
    if diff.returncode != 0:
        return []
    added: list[tuple[str, int, str]] = []
    path = ""
    lineno = 0
    for raw in diff.stdout.splitlines():
        if raw.startswith("+++ "):
            target = raw[4:].strip()
            path = "" if target == "/dev/null" else target[2:]
            continue
        hunk = _HUNK.match(raw)
        if hunk:
            lineno = int(hunk.group(1))
            continue
        if path and raw.startswith("+"):
            added.append((path, lineno, raw[1:]))
            lineno += 1
    return added


def _expand_braces(pattern: str) -> list[str]:
    match = re.search(r"\{([^{}]*)\}", pattern)
    if not match:
        return [pattern]
    head, tail = pattern[: match.start()], pattern[match.end() :]
    out: list[str] = []
    for choice in match.group(1).split(","):
        out.extend(_expand_braces(head + choice + tail))
    return out


def _glob_to_regex(pattern: str) -> str:
    out, i = [], 0
    while i < len(pattern):
        char = pattern[i]
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif char == "*":
            out.append("[^/]*")
            i += 1
        elif char == "?":
            out.append("[^/]")
            i += 1
        elif char == "[":
            close = pattern.find("]", i + 1)
            if close == -1:
                out.append(re.escape(char))
                i += 1
            else:
                out.append("[" + pattern[i + 1 : close] + "]")
                i = close + 1
        else:
            out.append(re.escape(char))
            i += 1
    body = "".join(out)
    if "/" not in pattern:
        body = "(?:.*/)?" + body
    return "^" + body + "$"


def _sections(text: str) -> list[tuple[str, dict[str, str]]]:
    found: list[tuple[str, dict[str, str]]] = []
    preamble: dict[str, str] = {}
    current = preamble
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line[0] in "#;":
            continue
        if line.startswith("[") and line.endswith("]"):
            current = {}
            found.append((line[1:-1], current))
        elif "=" in line:
            key, _, value = line.partition("=")
            current[key.strip().lower()] = value.strip()
    found.insert(0, ("", preamble))
    return found


def _config_chain(root: Path, rel: str) -> list[Path]:
    """.editorconfig files from the file's directory up to the repo root."""
    chain: list[Path] = []
    current = (root / rel).parent.resolve()
    stop = root.resolve()
    while True:
        candidate = current / ".editorconfig"
        if candidate.is_file():
            chain.append(candidate)
            preamble = _sections(
                candidate.read_text(encoding="utf-8", errors="replace")
            )
            if preamble[0][1].get("root", "").lower() == "true":
                break
        if current == stop or current.parent == current:
            break
        current = current.parent
    return chain


def _editorconfig_limit(root: Path, rel: str) -> int | None:
    """max_line_length for rel, OFF when declared off, None when undeclared."""
    limit: int | None = None
    for config in reversed(_config_chain(root, rel)):
        base = config.parent.resolve()
        try:
            scoped = str((root / rel).resolve().relative_to(base))
        except ValueError:
            continue
        text = config.read_text(encoding="utf-8", errors="replace")
        for glob, values in _sections(text):
            if not glob or "max_line_length" not in values:
                continue
            if not any(
                re.match(_glob_to_regex(alt), scoped) for alt in _expand_braces(glob)
            ):
                continue
            raw = values["max_line_length"].lower()
            if raw == "off":
                limit = OFF
            elif raw.isdigit():
                limit = int(raw)
    return limit


def _env_limit() -> int | None:
    raw = os.environ.get("WHETSTONE_TIGER_COLS", "").strip()
    return int(raw) if raw.isdigit() else None


def _skipped(rel: str) -> bool:
    path = Path(rel)
    return path.suffix.lower() in SKIP_SUFFIXES or path.name in SKIP_NAMES


def _offences(root: Path) -> tuple[list[str], int]:
    """Return every offence line, plus how many broke a limit the repo DECLARED.

    The two are counted apart on purpose: a fallback offence is advisory and must
    never be swept into a BLOCK count just because some other file declared one.
    """
    env = _env_limit()
    reported: list[str] = []
    declared_count = 0
    resolved: dict[str, int | None] = {}
    for rel, lineno, text in _staged_added_lines(root):
        if _skipped(rel):
            continue
        if rel not in resolved:
            resolved[rel] = env if env is not None else _editorconfig_limit(root, rel)
        limit = resolved[rel]
        if limit == OFF:
            continue
        declared = limit is not None
        effective = limit if declared else FALLBACK_COLS
        width = len(text.rstrip("\r\n"))
        if width <= effective:
            continue
        declared_count += 1 if declared else 0
        reported.append(f"{rel}:{lineno}: {width} cols (limit {effective})")
    return reported, declared_count


def main(argv: list[str]) -> int:
    root = Path(argv[1] if len(argv) > 1 else ".")
    if not _is_work_tree(root):
        print(f"tiger_check: not a git work tree: {root}", file=sys.stderr)
        return USAGE
    reported, declared_count = _offences(root)
    for entry in reported:
        print(entry)
    if not reported:
        print("TIGER: CLEAN")
        return CLEAN
    if declared_count:
        print(f"TIGER: BLOCK {declared_count}")
        return BLOCK
    print(f"TIGER: NAG {len(reported)}")
    return NAG


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
