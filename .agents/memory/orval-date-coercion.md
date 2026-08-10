---
name: Orval date coercion for query/path params
description: Adding 'date' to orval's coerce.query/coerce.param turns generated Zod-validated date fields into native JS Date objects, with downstream consequences for string-mode date DB columns.
---

When an OpenAPI spec has `date`/`date-time` format fields in query params or
path params (e.g. `startDate`, `endDate`, `weekStart`), Orval's generated Zod
schemas validate them as strict `zod.date()` by default — which rejects the
actual incoming query string values (plain strings, not Date objects).

**Why:** the fix is to add `'date'` to both `coerce.query` and `coerce.param`
in `orval.config.ts`'s zod-client override config, so the generated schema
coerces the incoming string into a `Date` object instead of rejecting it.

**How to apply:** once this coercion is enabled, it applies uniformly —
*every* date/datetime field parsed by generated Zod schemas (request body,
query params, path params) resolves to a native `Date` object, not a string.
If the backend writes that value into a Drizzle column declared with
`date(mode: "string")`, you must explicitly convert `Date -> "YYYY-MM-DD"`
string (a small UTC-safe formatter helper) before the DB write, or Drizzle's
insert/update will receive the wrong type.
