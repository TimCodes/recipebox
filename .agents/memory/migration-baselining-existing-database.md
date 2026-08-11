---
name: A database built by drizzle-kit push cannot accept migration 0000
description: Switching a live database from push-based schema sync to real migrations needs baselining, or the first migration fails with "table already exists".
---

`drizzle-kit push` diffs the schema against a live database and applies the result directly.
It records nothing: there is no `__drizzle_migrations` journal and no migration files in
version control.

Generating a baseline migration from that schema and running it against the same database
therefore fails — migration `0000` tries to `CREATE TABLE` tables that already exist. The
migration tool has no way to know the schema is already current, because push left no trace.

**Why:** this only bites at the moment of switching from push to migrations, which is exactly
when a database contains data worth keeping. It is easy to assume "generate a baseline and
run it" will just work, and to discover otherwise while attempting a data migration.

**How to apply:** do not restore a full schema+data dump into a database you then want to
migrate. Instead: create the database empty, let migrations build the schema, then restore
**data only** (see [[data-only-dumps-exclude-migration-journal]]). Alternatively, mark the
baseline as already applied by inserting its journal row by hand — but the empty-plus-data-only
route is easier to verify, because you can prove the schema matches the migrations exactly.
Keep `push` afterwards only for throwaway local iteration, and say so where the script lives,
since against a volume holding real data it is a data-loss hazard on any destructive diff.
