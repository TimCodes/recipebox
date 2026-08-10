---
name: Express default ETag breaks JSON API reads after mutations
description: Why a POST-then-GET can silently show stale data in the UI even though the server did the right thing.
---

Express enables weak ETags by default on every `res.json()`/`res.send()`. For a dynamic
JSON API (not cacheable content), this lets the browser's conditional-GET machinery
return `304 Not Modified` for a `GET` that immediately follows a `POST`/`PATCH`/`DELETE`
to the same resource — even though the underlying data changed. If the generated fetch
client treats `304` as a "no body" status (returning `null` for the parsed data instead
of erroring), the UI silently receives `null` instead of the fresh list and never
updates, while the toast/mutation itself reports success. This has no visible server
error — the giveaway is `201`/`204` immediately followed by repeated `304`s on the
corresponding list `GET` in the workflow logs.

**Why:** ETags/conditional GET are meant for cacheable resources (static assets, rarely
changing documents), not for API endpoints backing live app state — but Express turns
them on globally with no opt-in required, so this bites unless explicitly disabled.

**How to apply:** For any Express-based JSON API service, disable ETags and disable
caching globally: `app.set("etag", false)` plus a middleware that sets
`Cache-Control: no-store` on every response. Do this once at app setup, not per-route.
If debugging a "mutation succeeds but the list/UI doesn't refresh" report, check workflow
logs for a `304` on the list `GET` right after the mutation's `201`/`200` before assuming
a frontend cache-key/invalidation bug.
