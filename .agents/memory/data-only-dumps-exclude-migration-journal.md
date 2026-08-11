---
name: Data-only dumps must exclude the migration journal
description: A data-only pg_dump that includes drizzle's __drizzle_migrations table aborts the entire restore on a duplicate key, so the backup looks fine but restores nothing.
---

Restoring into a database whose schema came from migrations requires a **data-only** dump —
see [[migration-baselining-existing-database]]. But a plain `pg_dump --data-only` also dumps
`drizzle.__drizzle_migrations`, and the target already has those rows, because migrations ran
at boot to create the schema in the first place.

The restore then fails with `duplicate key value violates unique constraint
"__drizzle_migrations_pkey"`. Since the load runs in one transaction, that single conflict
rolls back **everything** — the restore reports an error but the database is left empty.

Found by actually running the drill: destroy the volume, bring the stack back up, restore.
The backup files were correct and non-empty; the restore silently recovered nothing.

**Why:** the failure is in the recovery path, which is exactly the path nobody exercises until
they need it. A backup script that runs cleanly and writes plausible files gives real
confidence while being useless. Only a full destroy-and-restore drill surfaces it.

**How to apply:** pass `--exclude-schema=drizzle` (or the equivalent for whichever migration
tool is in use) when taking data-only dumps. Keep the journal in the *full* dump, which is
restored into an empty database where it is correct. Defensively strip the block at restore
time too, so dumps taken before the fix still work. Also: a data-only restore assumes an empty
target — check row counts up front and refuse with an explanation rather than emitting a
confusing `*_pkey` error. And verify the sequences came back: insert a row after restoring and
confirm the new id continues past the restored data instead of restarting at 1.
