#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKPROP="$SCRIPT_DIR/../skills/backprop/SKILL.md"
ADAPTERS="$SCRIPT_DIR/../ADAPTERS.md"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

grep -q 'flake_runner.sh' "$BACKPROP" || fail "backprop must run flake triage on failing-test bugs"
grep -q 'results.json' "$BACKPROP" || fail "invocation must include the results.json positional"
grep -q 'fails/runs' "$BACKPROP" || fail "rate must be defined as fails/runs from results.json"
grep -qE 'rate.*1\.0.*always fails|1\.0 = always fails' "$BACKPROP" || fail "rate=1.0 must map to deterministic failure"
grep -qE 'rate.*0\.0.*(not reproduced|always passes)' "$BACKPROP" || fail "rate=0.0 must map to not-reproduced"
grep -q 'whetstone:flaky-test-audit' "$BACKPROP" || fail "flaky path must point at the quarantine skill"
grep -q 'DOSSIER_FLAKE_RUNNER' "$BACKPROP" || fail "explicit script-path override must be documented"
grep -q 'flake-triage=skipped' "$BACKPROP" || fail "absent whetstone must skip silently with §S note"
grep -qE 'flake=<rate>|flake=' "$BACKPROP" || fail "step 4.5 must log a resumable §S event"
sed -n '/| Last event/,/step 4 (re-scope)/p;/resume/Ip' "$BACKPROP" | grep -q 'flake=' || grep -A8 '| Last event' "$BACKPROP" | grep -q 'flake=' || fail "resume table must carry the flake event row"
grep -qi 'observed' "$BACKPROP" || fail "N-run determinism must be labeled observed, not proven"
grep -q 'flake_runner' "$ADAPTERS" || fail "ADAPTERS must document the flake-triage route"

grep -q 'test_flake_triage.sh' "$SCRIPT_DIR/../../../.github/workflows/ci.yml" || fail "ci must run this test"

printf 'ok\n'
