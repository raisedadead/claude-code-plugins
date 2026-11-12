# met-fixture

| field    | value        |
| -------- | ------------ |
| consumer | the test suite |

## done-when

| id  | command                            | expect |
| --- | ---------------------------------- | ------ |
| 1   | `true`                             | exit 0 |
| 2   | `false`                            | exit 1 |
| 3   | `test "$(printf hello)" = hello`   | exit 0 |
| 4   | `test -z "$(printf '')"`           | exit 0 |
| 5   | `printf 'a' \| grep -q a`          | exit 0 |
