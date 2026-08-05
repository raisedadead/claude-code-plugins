#!/usr/bin/env python3
"""Compute per-test flakiness from an N-run results file.

Input results.json maps test name -> {"runs": int, "fails": int}. A test is
flaky by definition of the number: 0 < fails < runs (mixed outcomes on the same
code). Deterministic — no model judgement in the flag. Writes a quarantine.json
of flaky tests and exits with the count of tests newly flaky since the baseline,
capped at 250, so a scheduled routine escalates only on a nonzero delta.

Exit 251 is a usage error, 252 a results or baseline file that is missing,
unparseable or wrongly shaped, and 253 a quarantine.json that could not be
written. None of the three is a count, and 251/252 write no quarantine.json, so
a sweep that never parsed cannot read as a clean one. A baseline path that does
not exist is the first-sweep case and counts as an empty baseline.

Run: compute_flakiness.py <results.json> [baseline-quarantine.json] [out-quarantine.json]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

EXIT_USAGE = 251
EXIT_BAD_INPUT = 252
EXIT_NO_ARTIFACT = 253
MAX_COUNT = 250

USAGE = (
    "usage: compute_flakiness.py <results.json> "
    "[baseline-quarantine.json] [out-quarantine.json]"
)


class InputError(Exception):
    """A results or baseline file that cannot be read as the object it must be."""


def compute_rates(results: dict) -> dict:
    rates: dict = {}
    for test, record in results.items():
        if not isinstance(record, dict):
            raise InputError(
                f"{test!r}: record is {type(record).__name__}, want {{runs, fails}}"
            )
        try:
            runs = int(record.get("runs", 0))
            fails = int(record.get("fails", 0))
        except (TypeError, ValueError) as exc:
            raise InputError(f"{test!r}: runs and fails must be integers") from exc
        rate = (fails / runs) if runs else 0.0
        rates[test] = {
            "runs": runs,
            "fails": fails,
            "rate": rate,
            "flaky": 0 < fails < runs,
        }
    return rates


def quarantine(rates: dict) -> dict:
    return {test: rec["rate"] for test, rec in rates.items() if rec["flaky"]}


def new_flags(current_q: dict, baseline_q: dict) -> list[str]:
    return sorted(set(current_q) - set(baseline_q))


def _load(path: str, *, missing_ok: bool = False) -> dict:
    target = Path(path)
    if missing_ok and not target.exists():
        return {}
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except OSError as exc:
        raise InputError(f"{path}: unreadable ({exc.strerror})") from exc
    except json.JSONDecodeError as exc:
        raise InputError(f"{path}: not JSON ({exc.msg}, line {exc.lineno})") from exc
    except UnicodeDecodeError as exc:
        raise InputError(f"{path}: not UTF-8 text ({exc.reason})") from exc
    if not isinstance(data, dict):
        raise InputError(f"{path}: top level is {type(data).__name__}, want an object")
    return data


def main() -> int:
    if len(sys.argv) < 2:
        print(USAGE, file=sys.stderr)
        return EXIT_USAGE

    try:
        results = _load(sys.argv[1])
        baseline = _load(sys.argv[2], missing_ok=True) if len(sys.argv) > 2 else {}
        rates = compute_rates(results)
    except InputError as exc:
        print(f"compute_flakiness: {exc}", file=sys.stderr)
        return EXIT_BAD_INPUT

    out_path = sys.argv[3] if len(sys.argv) > 3 else "quarantine.json"
    quarantined = quarantine(rates)

    for test in sorted(rates):
        rec = rates[test]
        flag = "FLAKY" if rec["flaky"] else "     "
        print(f"{flag} {rec['fails']}/{rec['runs']} {rec['rate']:.2f} {test}")

    try:
        Path(out_path).write_text(
            json.dumps(quarantined, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
    except OSError as exc:
        print(f"compute_flakiness: {out_path}: {exc.strerror}", file=sys.stderr)
        return EXIT_NO_ARTIFACT

    fresh = new_flags(quarantined, baseline)
    for test in fresh:
        print(f"NEW-FLAKY {test}", file=sys.stderr)

    return min(len(fresh), MAX_COUNT)


if __name__ == "__main__":
    sys.exit(main())
