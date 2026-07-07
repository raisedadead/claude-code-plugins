# Framework adapters

Two ways to produce the `results.json` that `compute_flakiness.py` consumes: `{ "<test>": {"runs": N, "fails": F}, … }`.

## A. Loop `flake_runner.sh` over a single test (framework-agnostic)

Works anywhere you can address one test by name. `flake_runner.sh` runs the command N times and records `{runs, fails}` under `FLAKE_TEST_NAME`.

| Framework | Single-test command                   |
| --------- | ------------------------------------- |
| vitest    | `vitest run -t "<test name>"`         |
| jest      | `jest -t "<test name>"`               |
| pytest    | `pytest "path::TestClass::test_name"` |
| go        | `go test -run '^TestName$' ./pkg`     |
| cargo     | `cargo test <test_name> -- --exact`   |

```bash
for id in "${suspect_ids[@]}"; do
  FLAKE_TEST_NAME="$id" flake_runner.sh 10 "run-$id.json" <cmd-for-$id>
done
```

Then merge the per-id JSON objects into one `results.json` (a `jq -s add run-*.json` does it).

## B. Aggregate a framework's JSON reporter across N runs

When you want the whole suite's per-test rates in one pass, run the suite N times with a machine-readable reporter and count per-test failures across runs:

| Framework | Per-run report               | Failure signal                     |
| --------- | ---------------------------- | ---------------------------------- |
| vitest    | `vitest run --reporter=json` | `testResults[].status == "failed"` |
| jest      | `jest --json`                | same shape as vitest               |
| pytest    | `pytest --junit-xml=out.xml` | `<testcase>` with a `<failure>`    |
| go        | `go test -json ./...`        | `{"Action":"fail","Test":…}`       |

Sum failures per test name across the N run reports into `{runs, fails}`. The rule is the same regardless of source: `0 < fails < runs` is flaky.

## Note

Keep N high enough to surface intermittent failures (10 is a reasonable floor). A test that fails 1 in 50 needs more runs to catch than one that fails 1 in 3 — `compute_flakiness.py` reports the observed rate, not the true one, so treat a `rate` near 0 with few runs as "not yet characterized," not "clean."
