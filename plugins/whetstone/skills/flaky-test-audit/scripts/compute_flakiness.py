#!/usr/bin/env python3
"""Compute per-test flakiness from an N-run results file.

Input results.json maps test name -> {"runs": int, "fails": int}. A test is
flaky by definition of the number: 0 < fails < runs (mixed outcomes on the same
code). Deterministic — no model judgement in the flag. Writes a quarantine.json
of flaky tests and exits with the count of tests newly flaky since the baseline,
so a scheduled routine escalates only on a nonzero delta.

Run: compute_flakiness.py <results.json> [baseline-quarantine.json] [out-quarantine.json]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def compute_rates(results: dict) -> dict:
    rates: dict = {}
    for test, record in results.items():
        runs = int(record.get("runs", 0))
        fails = int(record.get("fails", 0))
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


def _load(path: str) -> dict:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def main() -> int:
    if len(sys.argv) < 2:
        print(
            "usage: compute_flakiness.py <results.json> [baseline-quarantine.json] [out-quarantine.json]",
            file=sys.stderr,
        )
        return 2

    results = _load(sys.argv[1])
    baseline = _load(sys.argv[2]) if len(sys.argv) > 2 else {}
    out_path = sys.argv[3] if len(sys.argv) > 3 else "quarantine.json"

    rates = compute_rates(results)
    quarantined = quarantine(rates)

    for test in sorted(rates):
        rec = rates[test]
        flag = "FLAKY" if rec["flaky"] else "     "
        print(f"{flag} {rec['fails']}/{rec['runs']} {rec['rate']:.2f} {test}")

    Path(out_path).write_text(
        json.dumps(quarantined, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    fresh = new_flags(quarantined, baseline)
    for test in fresh:
        print(f"NEW-FLAKY {test}", file=sys.stderr)

    return min(len(fresh), 255)


if __name__ == "__main__":
    sys.exit(main())
