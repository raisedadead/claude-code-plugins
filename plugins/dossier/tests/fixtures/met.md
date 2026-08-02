# met-fixture

| field    | value        |
| -------- | ------------ |
| consumer | the test suite |

## done-when

| id  | command                          | expect            |
| --- | -------------------------------- | ----------------- |
| 1   | `true`                           | exit 0            |
| 2   | `false`                          | exit 1            |
| 3   | `printf hello`                   | stdout: hello     |
| 4   | `printf ''`                      | stdout: (nothing) |
| 5   | `printf 'a' \| cat`              | stdout: a         |
