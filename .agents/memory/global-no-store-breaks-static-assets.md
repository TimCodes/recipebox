---
name: A global no-store becomes a silent performance bug when the API starts serving static files
description: Cache headers set app-wide for a JSON API quietly defeat content-hashed asset caching once the same process serves a frontend build.
---

This API sets `Cache-Control: no-store` on every response, for a good reason — see
[[express-etag-stale-api-reads]]: conditional GETs were returning 304 after mutations and the
generated fetch client resolved that as `null`.

That middleware was registered globally, which was correct while the process only served JSON.
When the same Express app took over serving the built frontend (replacing Replit's router),
the global header started applying to every content-hashed JS/CSS asset too — making a bundle
designed for permanent caching re-download on every single page load.

**Why:** this failure is invisible. Nothing errors, no log line appears, every test passes, and
the app is functionally perfect — just slower for every user, forever. It is only findable by
inspecting response headers or noticing transfer sizes, neither of which anyone does unless
they already suspect a problem.

**How to apply:** scope cache-control middleware to the API path prefix (`app.use("/api", ...)`)
rather than the app root, and let the static handler set its own headers — `immutable` with a
long `max-age` for content-hashed assets, `no-cache` for `index.html` so a new deploy is picked
up immediately. More generally: whenever one process starts serving a second *kind* of content,
re-examine every app-wide middleware, because "applies to everything" silently changed meaning.
Two related traps in the same change: a SPA catch-all must exclude the API prefix or an
unmatched endpoint returns an HTML document where the client expects JSON; and in Express 5
(path-to-regexp v8) a bare `"*"` is rejected as a path, so the catch-all has to be a plain
middleware.
