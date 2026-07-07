#!/usr/bin/env python3
"""Deterministic trigger-phrase lint for the dossier skills.

Not a router simulation (real routing needs a live model — see evals/README.md).
This catches the class of authoring bug a static pass *can* catch deterministically:
two skills claiming the same trigger phrase (ambiguous routing), or a skill whose
description carries no explicit trigger clause at all.

Run: python3 eval_skill_routing.py [skills-dir]. Exit 1 on any finding.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"
TRIGGER_MARKERS = ("invoke when", "use when")


def _field(frontmatter: str, key: str) -> str:
    for line in frontmatter.splitlines():
        stripped = line.strip()
        if stripped.startswith(f"{key}:"):
            value = stripped[len(key) + 1 :].strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            return value
    return ""


def load_skill(md_path: Path) -> tuple[str, str] | None:
    text = md_path.read_text(encoding="utf-8")
    parts = text.split("---")
    if len(parts) < 3:
        return None
    frontmatter = parts[1]
    name = _field(frontmatter, "name")
    description = _field(frontmatter, "description")
    if not name or not description:
        return None
    return name, description


def has_trigger_clause(description: str) -> bool:
    low = description.lower()
    return any(marker in low for marker in TRIGGER_MARKERS)


def extract_trigger_phrases(description: str) -> list[str]:
    low = description.lower()
    idx = min((low.find(m) for m in TRIGGER_MARKERS if m in low), default=-1)
    tail = description[idx:] if idx != -1 else ""
    return [p.strip().lower() for p in re.findall(r'"([^"]+)"', tail) if p.strip()]


def lint(skills_dir: Path) -> list[str]:
    skills: list[tuple[str, str]] = []
    for child in sorted(skills_dir.iterdir()):
        skill_md = child / "SKILL.md"
        if skill_md.is_file():
            loaded = load_skill(skill_md)
            if loaded:
                skills.append(loaded)

    findings: list[str] = []
    for name, description in skills:
        if not has_trigger_clause(description):
            findings.append(f"FAIL {name}: description has no 'Invoke when' / 'Use when' trigger clause")

    phrase_owners: dict[str, list[str]] = {}
    for name, description in skills:
        for phrase in set(extract_trigger_phrases(description)):
            phrase_owners.setdefault(phrase, []).append(name)
    for phrase, owners in sorted(phrase_owners.items()):
        if len(owners) > 1:
            findings.append(
                f'FAIL trigger-phrase collision: "{phrase}" claimed by {", ".join(sorted(owners))}'
            )

    return findings


def main() -> int:
    skills_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else SKILLS_DIR
    findings = lint(skills_dir)
    for finding in findings:
        print(finding)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
