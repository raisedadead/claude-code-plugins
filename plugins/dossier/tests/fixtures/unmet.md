# unmet-fixture

| field    | value          |
| -------- | -------------- |
| consumer | the test suite |

## done-when

| id  | command                       | expect |
| --- | ----------------------------- | ------ |
| 1   | `true`                        | exit 0 |
| 2   | `false`                       | exit 0 |
| 3   | `test "$(printf nope)" = yes` | exit 0 |
