# stderr-only-fixture

A criterion whose only output goes to stderr. `stdout:` names stdout, so this must report UNMET — the runner once merged the two streams and called it MET, declaring a wave over on text the command never printed to stdout.

| field    | value          |
| -------- | -------------- |
| consumer | the test suite |

## done-when

| id  | command                 | expect       |
| --- | ----------------------- | ------------ |
| 1   | `sh -c 'echo oops >&2'` | stdout: oops |
