# Changelog mapping tables

Type→bump rows are Conventional Commits / SemVer spec text except where a row is marked convention. Type→category is CONVENTION layered on keep-a-changelog — the spec never mandates it; a behavior-visible `refactor` landing in Changed vs omitted is a judgment call, label it as such.

## Conventional-commit type → semver bump (spec)

| type                                                  | bump                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| any type + `!` or `BREAKING CHANGE:`                  | MAJOR                                                       |
| `feat`                                                | MINOR                                                       |
| `fix`                                                 | PATCH                                                       |
| `perf`                                                | PATCH — convention (semantic-release preset), NOT spec text |
| `docs` `chore` `build` `ci` `style` `test` `refactor` | none                                                        |

Highest-precedence type present wins: MAJOR > MINOR > PATCH > none.

## Conventional-commit type → keep-a-changelog category (convention)

| type / signal                              | category   |
| ------------------------------------------ | ---------- |
| `feat`                                     | Added      |
| `fix`                                      | Fixed      |
| `perf`, behavior-visible `refactor`        | Changed    |
| removal-flavored (`remove`, `drop`)        | Removed    |
| deprecation-flavored                       | Deprecated |
| CVE / vulnerability                        | Security   |
| `docs` `chore` `build` `ci` `style` `test` | omitted    |

Empty categories are omitted from the written section (matches both in-repo CHANGELOG.md files).
