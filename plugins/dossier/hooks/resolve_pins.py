#!/usr/bin/env python3
"""resolve_pins.py — proactive latest-version + EOL resolver.

Resolves the CURRENT latest version (and EOL/LTS status) for the libraries a
task will introduce, BEFORE coding, so the model pins the right version the
first time instead of recalling a stale one from training. Reuses verify_lib's
registry map + the 24h `.scratchpad/.verify-cache/` (shared with the reactive
verify hook). Stdlib only. Python 3.10+.

Specs (one or more args):
    <ecosystem>:<pkg>   e.g. npm:react  pypi:fastapi  crates:serde  go:github.com/gin-gonic/gin
    eol:<slug>          e.g. eol:go  eol:nodejs  eol:postgresql

Output: one JSON object per line on stdout. Offline / unknown => {"latest": null,
"offline": true}; the caller records `pin=offline` and proceeds (never blocks).

A `go:` spec without a `/vN` suffix names the v0/v1 module path, so the resolver
walks the higher majors too and answers from the highest that resolves — `src`
carries the module path the version came from. A probe the proxy left unanswered
puts a `warning` on the object: the version is then a floor, not the ceiling.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from verify_lib import latest_eol, latest_version_detail
except Exception as exc:  # noqa: BLE001
    print(json.dumps({"error": f"load: {type(exc).__name__}: {exc}"}))
    sys.exit(0)


def resolve(spec: str) -> dict:
    spec = spec.strip()
    if spec.startswith("eol:"):
        slug = spec[4:]
        res = latest_eol(slug)
        if not res:
            return {"spec": spec, "latest": None, "offline": True}
        series, exact, src = res
        return {"spec": spec, "series": series, "latest": exact, "src": src}
    if ":" in spec:
        eco, pkg = spec.split(":", 1)
        res = latest_version_detail(eco, pkg)
        if not res:
            return {"spec": spec, "latest": None, "offline": True}
        latest, src, warning = res
        out = {"spec": spec, "latest": latest, "src": src}
        if warning:
            out["warning"] = warning
        return out
    return {"spec": spec, "error": "bad spec (want <ecosystem>:<pkg> or eol:<slug>)"}


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: resolve_pins.py <ecosystem>:<pkg> | eol:<slug> ...", file=sys.stderr)
        return 2
    for spec in argv:
        print(json.dumps(resolve(spec)))
    return 0


if __name__ == "__main__":
    if sys.version_info < (3, 10):
        sys.exit(0)
    sys.exit(main(sys.argv[1:]))
