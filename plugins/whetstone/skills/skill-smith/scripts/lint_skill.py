#!/usr/bin/env python3
"""Deterministic SKILL.md linter.

Checks a skill's authoring hygiene against Anthropic's conventions: frontmatter
name matches the parent directory and uses the kebab charset, a non-empty
description with a trigger clause written in the third person, a body under the
line budget, and bundled reference/scripts files kept one level deep.

lint(path) returns a list of "FAIL …" / "WARN …" findings. main() prints them
and exits 1 if any FAIL is present (WARN alone still exits 0).

Run: python3 lint_skill.py <SKILL.md | skills-dir> [...].
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
TRIGGER_MARKERS = ("use when", "invoke when")
LINE_BUDGET = 500
LINE_WARN = 400
DESC_MAX = 1024


def _field(frontmatter: str, key: str) -> str:
    for line in frontmatter.splitlines():
        stripped = line.strip()
        if stripped.startswith(f"{key}:"):
            value = stripped[len(key) + 1 :].strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            return value
    return ""


def _split_frontmatter(text: str) -> tuple[str, str] | None:
    parts = text.split("---")
    if len(parts) < 3:
        return None
    return parts[1], "---".join(parts[2:])


def lint(skill_md: Path) -> list[str]:
    name_hint = skill_md.parent.name
    findings: list[str] = []

    text = skill_md.read_text(encoding="utf-8")
    split = _split_frontmatter(text)
    if split is None:
        findings.append(f"FAIL {name_hint}: no YAML frontmatter (--- … ---)")
        return findings
    frontmatter, body = split

    name = _field(frontmatter, "name")
    description = _field(frontmatter, "description")

    if not name:
        findings.append(f"FAIL {name_hint}: frontmatter has no name")
    else:
        if name != name_hint:
            findings.append(
                f"FAIL {name_hint}: name '{name}' does not match parent dir '{name_hint}'"
            )
        if not NAME_RE.match(name):
            findings.append(
                f"FAIL {name_hint}: name '{name}' breaks the kebab charset "
                "(lowercase/digits/hyphen, no leading/trailing/double hyphen)"
            )

    if not description:
        findings.append(f"FAIL {name_hint}: frontmatter has no description")
    else:
        if len(description) > DESC_MAX:
            findings.append(
                f"FAIL {name_hint}: description is {len(description)} chars (>{DESC_MAX})"
            )
        if not any(marker in description.lower() for marker in TRIGGER_MARKERS):
            findings.append(
                f"FAIL {name_hint}: description has no 'Use when' / 'Invoke when' trigger clause"
            )
        if re.search(r"\bI\b|\bI'", description):
            findings.append(
                f"WARN {name_hint}: description reads first-person ('I …'); skills are described in the third person"
            )

    body_lines = len(body.splitlines())
    if body_lines > LINE_BUDGET:
        findings.append(
            f"FAIL {name_hint}: body is {body_lines} lines (>{LINE_BUDGET})"
        )
    elif body_lines > LINE_WARN:
        findings.append(
            f"WARN {name_hint}: body is {body_lines} lines (nearing the {LINE_BUDGET} budget)"
        )

    skill_dir = skill_md.parent
    for child in skill_dir.rglob("*"):
        if not child.is_file():
            continue
        rel = child.relative_to(skill_dir)
        if any(part == "__pycache__" or part.startswith(".") for part in rel.parts):
            continue
        if len(rel.parts) > 2:
            findings.append(
                f"WARN {name_hint}: reference nested too deep ({rel}); keep references one level deep"
            )

    return findings


def lint_target(target: Path) -> list[str]:
    if target.is_dir():
        findings: list[str] = []
        for skill_md in sorted(target.rglob("SKILL.md")):
            findings.extend(lint(skill_md))
        return findings
    return lint(target)


def main() -> int:
    targets = [Path(a) for a in sys.argv[1:]] or [Path.cwd()]
    findings: list[str] = []
    for target in targets:
        findings.extend(lint_target(target))
    for finding in findings:
        print(finding)
    return 1 if any(f.startswith("FAIL") for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
