---
name: close
description: Close a dossier after its work is shipped or stopped. Invoke when the user says "ds:close" or "close the dossier", or when every row is done, waiting or deferred.
argument-hint: '"<one line>"'
---

# ds:close

1. Settle each open row first: `ds done <id>`, `ds set <id> later "until <YYYY-MM-DD>"`, or `ds set <id> drop "<reason>"`.
2. Write one line that says what the dossier delivered.
3. `ds close "<that line>"`. It refuses open rows. It moves the rows that wait or are deferred to `OPEN-WORK.md` with the same IDs, writes the line, moves the folder to `_archive/` and prints triage.
4. Settle each row that the triage lists.
