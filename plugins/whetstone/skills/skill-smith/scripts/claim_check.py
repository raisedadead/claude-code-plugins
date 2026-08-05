#!/usr/bin/env python3
"""Flag sentences that claim runtime enforcement without naming anything checkable.

Exit codes:
  0  every claim is backed or labelled  (CLEAN)
  1  at least one is neither            (FLAGGED)
  64 usage error — no paths, or a path that does not exist

Read the `CLAIMS:` line before the exit code. A missing interpreter exits 1 or 2
by itself, which collides with FLAGGED, so a number alone cannot separate a
verdict from a crash.

This decides SHAPE, never fact. A sentence saying a hook blocks something passes
when it also names an exit code, or when it labels itself advisory. Whether the
exit code is the real one is a question for a reader; F25's class is only half
mechanical and this is that half.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

CLEAN, FLAGGED, USAGE = 0, 1, 64

CLAIM = re.compile(
    r"(?:`[^`]+`"
    r"|\b(?:the|this)\s+(?:runner|hook|script|gate|check(?:er)?|guard|linter)\b)"
    r"\s+(?:\w[\w-]*\s+){0,3}?"
    r"(?:hard-)?(?:blocks|enforces|gates|denies|prevents|refuses)\b"
    r"(?!\s+\w+ed\b)",
    re.I,
)
BACKED = re.compile(
    r"\bexits?\s+\d+\b|\bexit\s+cod\w*\b|\breturn(?:s|ing)?\s+exit\b"
    r"|\bnon-zero\b|\bexit-code\b|https?://|#\d{2,}",
    re.I,
)
LABELLED = re.compile(
    r"\badvisory\b|\bmodel[\s-]judge?ment\b|\bopt-in\b|\bnag\b"
    r"|\bnon-blocking\b|\bnever blocks\b|\bblocks nothing\b|\bdoes not block\b"
    r"|\bnot a gate\b"
    r"|\bcode\s*[—–-]\s*`[^`]+`",
    re.I,
)

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def _units(text: str) -> list[tuple[int, str]]:
    """Line-numbered sentences. A markdown row is its own unit.

    Splitting the whole file on sentence ends would let a backed clause in one
    table row vouch for an unbacked claim in the next.
    """
    found: list[tuple[int, str]] = []
    for number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("|"):
            found.append((number, stripped))
            continue
        for piece in _SENTENCE_END.split(stripped):
            if piece.strip():
                found.append((number, piece.strip()))
    return found


def _is_claim(unit: str) -> bool:
    """A claim is a named thing followed by a finite enforcement verb.

    Matching the bare verbs flagged 113 lines, nearly all of them nouns and
    adjectives: "doubt gate", "env-gated backstops", "the three write-time
    gates". A lint that flags honest prose gets deleted, and then it catches
    nothing — so the subject has to name shipped machinery and the verb has
    to be finite and follow it. Machinery is a backticked name, or the/this
    plus one singular noun from a closed list — runner, hook, script, gate,
    check, checker, guard, linter: F25's third recurrence shipped as "the
    runner enforces" with no backticks in reach. Plurals, other nouns ("the
    plugin", "the wrapper") and passives still pass unexamined; the list
    grows per recurrence, never speculatively. The determiner stays
    restricted to the/this because indefinite subjects are how honest
    generalisations read — "a gate that blocks on a signal it cannot back"
    claims nothing about any shipped gate.

    A past participle after the verb marks it as a noun — "`tool_use` blocks
    counted by" is a count of blocks, not a claim that anything blocks. This
    trades a miss ("blocks unverified writes") for a false positive, which is
    the right way round: a lint that flags honest prose gets deleted.
    """
    return bool(CLAIM.search(unit))


def _is_backed(unit: str) -> bool:
    """An exit code, a citation, or a label that names what the thing is.

    The label has to be the label. A bare `judgement`/`judgment` alternative
    once exempted every sentence containing the noun, whatever it asserted —
    "the hook blocks a bad judgment call" passed, "the hook blocks a bad
    write" was flagged. `model[\\s-]judge?ment` takes both spellings and both
    joiners, and launders nothing else.
    """
    return bool(BACKED.search(unit)) or bool(LABELLED.search(unit))


def _scan(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    flagged: list[str] = []
    for number, unit in _units(text):
        if _is_claim(unit) and not _is_backed(unit):
            shown = unit if len(unit) <= 110 else unit[:107] + "..."
            flagged.append(f"{path}:{number}: {shown}")
    return flagged


def main(argv: list[str]) -> int:
    options = [a for a in argv[1:] if a.startswith("-")]
    if options:
        for option in options:
            print(f"claim_check: unknown option: {option}", file=sys.stderr)
        return USAGE
    paths = [Path(a) for a in argv[1:]]
    if not paths:
        print("claim_check: usage: claim_check.py <path>...", file=sys.stderr)
        return USAGE

    missing = [p for p in paths if not p.is_file()]
    if missing:
        for p in missing:
            print(f"claim_check: no such file: {p}", file=sys.stderr)
        return USAGE

    flagged: list[str] = []
    for path in paths:
        flagged.extend(_scan(path))

    for entry in flagged:
        print(entry)
    if flagged:
        print(f"CLAIMS: FLAGGED {len(flagged)}")
        return FLAGGED
    print(f"CLAIMS: CLEAN {len(paths)} file{'' if len(paths) == 1 else 's'}")
    return CLEAN


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
