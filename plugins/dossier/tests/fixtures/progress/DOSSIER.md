# single-worker

`2026-10-08` · `live` · `P1/1`

## Tasks

| id  | state | who | task                                                   | needs        | cite          | verify                   |
| --- | ----- | --- | ------------------------------------------------------ | ------------ | ------------- | ------------------------ |
| T1  | x     | H   | Move the account to Workers Paid                       | —            | operator      | plan shows Paid          |
| T2  | x     | A   | Single-app skeleton                                    | —            | 1daefca       | `pnpm check` exit 0      |
| T3  | .     | A   | Sign-in spike                                          | T2           | —             | §S records PASS or FAIL  |
| T4  | x     | A   | New content model                                      | T2           | 41d21c9       | hook tests pass          |
| T5  | x     | A   | Plugin blocks                                          | T4           | 67bd1af       | render tests             |
| T6  | x     | A   | Pages render live; `test -d apps/cms \|\| echo absent` | T4, T5       | a25542d       | e2e exit 0               |
| T7  | x     | A   | Main-domain safety                                     | T6           | f7c9539       | one test per rule        |
| T8  | .     | H   | Create GitHub teams and the App                        | T3           | —             | teams listed             |
| T9  | .     | A   | GitHub App login                                       | T3, T8       | —             | unit tests               |
| T10 | x     | A   | Admin UI options                                       | T6           | 9d5733e       | Edit pill shows          |
| T11 | ~     | A   | Add-only model script                                  | T4           | —             | dry run lists additions  |
| T12 | .     | A   | Re-runnable migration script                           | T11          | —             | run twice, no duplicates |
| T13 | .     | H   | Turn off the Deploy Hook; run the migration on live    | T1, T11, T12 | —             | live counts match        |
| T14 | x     | A   | Measure render time                                    | T7           | §S 2026-10-09 | §S records the numbers   |
| T15 | x     | A   | Docs                                                   | T7, T10      | 9b1fd5e       | format check exit 0      |
| T16 | .     | H   | Cutover                                                | T1, T13, T14 | —             | live check all PASS      |
| T17 | .     | A   | Remove the old collections                             | T16+7d       | —             | schema list clean        |
| T18 | .     | H   | Delete the old Worker                                  | T16+30d      | —             | deployments list fails   |
| T19 | .     | A   | Open the follow-up admin dossier                       | T16          | —             | ds:status lists it       |

## Status

2026-10-09 02:34 ds:build T15 DONE → x cite=9b1fd5e
