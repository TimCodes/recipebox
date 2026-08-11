# De-Replit migration plan

Move Kitchen Notebook off Replit onto a self-hosted Docker stack: one app container
(Express serving both the API and the built React bundle) plus one Postgres container,
orchestrated with Docker Compose.

Status: **phases 1–6 complete** · **phase 0 closed as not-needed**. The app now runs entirely
in Docker: `docker compose up --build -d`. Remaining: phase 7 (ops/backups), phase 8 (docs).

---

## 1. Goals

1. Remove every Replit-specific dependency, config file, and environment assumption.
2. Run the whole app with `docker compose up` on any machine with Docker, including
   Windows (the current repo cannot build outside Linux — see §3.1).
3. Keep Postgres as the datastore, with a persistent volume and real migration files
   instead of `drizzle-kit push` against a live DB.
4. Preserve the existing context-document strategy for AI-assisted development
   (`CLAUDE.md` + `.agents/memory/` one-fact-per-file) — see §8.
5. No behavior change to the product. Same routes, same schema, same UX.

## 2. Decisions

**Locked:**

- **Single app container.** Express serves the built Vite bundle at `/` and the API at
  `/api`, in one process, one image. Postgres runs as a second container. No nginx, no
  Caddy, no CORS in production.
- **Postgres stays** as the datastore.

**Assumed** (say so if wrong, it changes Phase 7 only):

- **Scope is local Docker Compose.** Dev + prod compose files, volumes, healthchecks, and
  a backup/restore path. No registry push, no CI pipeline, no automated remote deploy.
  A "build a pushable image / add CI" phase can bolt on later without reworking anything
  below.

**Resolved:** the AI provider question in §6 — direct OpenAI, cheapest viable model per task.

## 3. What is actually coupled to Replit

Findings from an audit of the current tree. Each maps to a phase below.

### 3.1 The build only works on Linux x64 — the biggest single issue

`pnpm-workspace.yaml` contains an `overrides` block that deletes every non-`linux-x64`
native binary for esbuild, rollup, lightningcss, `@tailwindcss/oxide`, and
`@expo/ngrok-bin` — ~90 entries, commented *"replit uses linux-x64 only, we can exclude
all other platforms."*

Consequence: `pnpm install && pnpm run build` on Windows or an Apple-silicon Mac fails on
missing platform binaries. This is why all real work has had to happen inside Replit.

Two ways out, and the plan takes **both**:
- Drop the platform overrides so a normal host install works (needed for `pnpm run typecheck`
  and editor tooling on Windows).
- Pin all *image* builds to `linux/amd64` in the Dockerfile so container builds stay
  deterministic regardless of host.

### 3.2 Request routing

`.replit` declares `router = "application"`, which is what mounts the API at `/api` and
the frontend at `/`. There is **no `server.proxy` in `vite.config.ts`** — nothing in the
repo replaces that once Replit is gone. Both dev and prod need an explicit answer
(Phase 4).

### 3.3 Replit packages and config

| Item | Where | Action |
| --- | --- | --- |
| `@replit/vite-plugin-runtime-error-modal` | `meal-planner/vite.config.ts` (unconditional top-level import), `mockup-sandbox` | remove |
| `@replit/vite-plugin-cartographer`, `@replit/vite-plugin-dev-banner` | both vite configs, behind `process.env.REPL_ID` | remove |
| `@replit/connectors-sdk` | root `package.json` dependency | remove — **zero imports anywhere in the tree** |
| catalog entries for the three vite plugins | `pnpm-workspace.yaml` | remove |
| `minimumReleaseAgeExclude: ['@replit/*', 'stripe-replit-sync']` | `pnpm-workspace.yaml` | remove entries, **keep `minimumReleaseAge: 1440`** |
| `.replit`, `.replitignore` | root | delete |
| `.cache/`, `.local/` gitignore entries | `.gitignore` | delete |
| `scripts/post-merge.sh` | wired via `.replit` `[postMerge]` | delete (replaced by migrations on startup) |
| "built on Replit" meta description ×4 | `meal-planner/index.html` | rewrite |
| `// @replit` comments in `ui/badge.tsx`, `ui/button.tsx` | cosmetic, marks intentional shadcn deviations | leave alone |

### 3.4 The AI integration

`lib/integrations-openai-ai-server` constructs an OpenAI client from
`AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` — the Replit AI
Integrations proxy. It also ships unused `image/`, `audio/`, and `batch/` modules.

~~**The model id `gpt-5.6-terra` is a Replit-proxy model name.**~~ **CORRECTION:**
`gpt-5.6-terra` is a real OpenAI model (~$2.00/$12.00 per 1M tokens). The earlier claim that
it was proxy-only was wrong. Losing the proxy costs only the credentials and base URL, not
the model — which made §6 a much smaller decision than first assessed.

### 3.5 Database lifecycle

No migration files exist anywhere. `drizzle-kit push` is the only path, and
`scripts/post-merge.sh` runs it automatically after every merge. Against a container with
a persistent volume, `push` is a data-loss hazard on any destructive schema diff.

### 3.6 Environment assumptions

`PORT` and `BASE_PATH` throw at startup with no defaults (`api-server/src/index.ts`,
`meal-planner/vite.config.ts`) — Replit always injected them. Compose must supply them
explicitly, or they get sane defaults.

### 3.7 Dead weight

`artifacts/mockup-sandbox` is a Replit design scratchpad — a near-duplicate copy of the
entire `components/ui/*` tree plus its own vite config and Replit plugins. Nothing in the
product imports it. Deleting it removes ~4,500 lines and two Replit dependencies.

---

## 4. Target architecture

```
                    docker compose
  ┌──────────────────────────────────────────────┐
  │  app  (node:24-bookworm-slim, linux/amd64)   │
  │    Express :3000                             │
  │      GET /api/*   → routers (unchanged)      │
  │      GET /assets/*→ express.static(dist)     │
  │      GET /*       → index.html (SPA)         │
  │    runs drizzle migrations on boot           │
  └───────────────┬──────────────────────────────┘
                  │ DATABASE_URL
  ┌───────────────┴──────────────────────────────┐
  │  db  (postgres:17-bookworm)                  │
  │    volume: pgdata:/var/lib/postgresql/data   │
  └──────────────────────────────────────────────┘
```

Development keeps two processes on the host (Vite dev server with HMR + `tsx watch` API),
with Vite proxying `/api` to the API, and only Postgres in Docker. Production is the single
container above. Same code, different entry.

**Base image note:** `node:24-bookworm-slim` (glibc), not Alpine. `pdf-parse` → `pdfjs-dist`
→ optional `@napi-rs/canvas` is a native module; glibc avoids musl build variance.

**Runtime contents note:** the image cannot ship `dist/index.mjs` alone.
`artifacts/api-server/build.mjs` deliberately externalizes `pdf-parse` and `pdfjs-dist`
(bundling them crashes with `DOMMatrix is not defined`), and `esbuild-plugin-pino` emits
separate transport files. The runtime stage needs production `node_modules` **and** the
whole `dist/` directory.

---

## 5. Phases

Each phase is independently verifiable and independently committable. Order matters:
Phases 1–2 make the repo buildable off-Replit at all, which everything else depends on.

### Phase 0 — Safety net ⏭️ SKIPPED (deliberately)

**Decision (2026-08-11): the Replit data is disposable — no migration of it needed.** The
owner confirmed the recipes there can be thrown away, which removes the single highest
-severity risk in this plan. Nothing was restored; the new database starts empty.

Also found while attempting it: the Replit database is addressed as `helium/heliumdb`, an
internal hostname that resolves **only inside the Repl's network**. Verified it does not
resolve from a developer machine, so this dump could never have been pulled remotely — it
would have had to be taken from inside the Repl shell. Worth knowing if anything else is ever
recovered from that Repl.

What was kept, because it is still needed for phase 7 (ongoing backups of the *real* local
database):

- `scripts/dump-remote-db.sh` — pg_dump via the postgres:17 image, since there are no client
  tools on the host. URL passed through the environment, never as an argument.
- `scripts/restore-data.sh` — data-only restore into a migrated database, with FK triggers
  suppressed for the load.
- Tag `pre-dereplit` at the last pre-migration commit.

<details>
<summary>Original phase 0 plan</summary>

### Phase 0 — Safety net

- Tag the current state: `git tag pre-dereplit`.
- Dump the existing Replit Postgres to `backups/pre-dereplit.sql` via `pg_dump` — this is
  the only copy of any real recipe data. Restore path is verified in Phase 3.
- Confirm the app currently runs on Replit, so later breakage is attributable.

**Verify:** dump file is non-empty and `pg_restore --list` (or a `psql` dry parse) reads it.

</details>

### Phase 1 — Make the repo host-buildable

The unblocker for everything else.

- Delete the `overrides` platform-exclusion block from `pnpm-workspace.yaml`, keeping the
  two entries that are *not* platform-related: the `@esbuild-kit/esm-loader` → `tsx` alias
  and the `esbuild: "0.27.3"` pin.
- Remove the three `@replit/*` catalog entries and the `minimumReleaseAgeExclude` list.
  **Keep `minimumReleaseAge: 1440`** — it is a real supply-chain control, unrelated to Replit.
- Delete `artifacts/mockup-sandbox` entirely.
- Remove `@replit/connectors-sdk` from root `package.json`.
- Strip the Replit plugins from `meal-planner/vite.config.ts`; give `PORT` and `BASE_PATH`
  defaults (`5173`, `/`) instead of throwing.
- `pnpm install` to regenerate `pnpm-lock.yaml`.

**Verify:** `pnpm install && pnpm run typecheck && pnpm run build` succeeds **on Windows**.
That has not been possible before this phase.

### Phase 2 — Delete Replit scaffolding ✅ DONE

Outcome notes:

- Removed `.replit`, `.replitignore`, `scripts/post-merge.sh`, the Replit `.gitignore`
  entries, all three `@replit/vite-plugin-*` deps and their catalog entries, the unused
  `@replit/connectors-sdk` root dependency, and `minimumReleaseAgeExclude`.
  `minimumReleaseAge: 1440` kept.
- Deleted `artifacts/mockup-sandbox` (~4,500 lines).
- `index.html`: real title/description; **removed the Google Fonts `<link>` for Inter**,
  which no CSS ever referenced. The fonts actually in use (DM Sans, Fraunces) come from an
  `@import` at the top of `src/index.css` and are untouched.
- **Deviation from plan:** did *not* self-host the fonts. That is an offline-capability
  improvement unrelated to Replit, and swapping font delivery risks visible rendering
  changes. Left as an optional follow-up.
- The `// @replit` comments in `ui/badge.tsx` and `ui/button.tsx` stay — they mark
  deliberate shadcn deviations and removing them would lose that intent.

<details>
<summary>Original phase 2 plan</summary>

### Phase 2 — Delete Replit scaffolding

- Delete `.replit`, `.replitignore`, `scripts/post-merge.sh`.
- Clean the Replit lines out of `.gitignore`.
- Rewrite the four "built on Replit" meta tags in `index.html`; set a real `<title>`
  ("Kitchen Notebook", currently "Meal Planner" — the app's own UI says Kitchen Notebook).
- Decide on the Google Fonts `<link>` in `index.html`: it is the only external network
  dependency at runtime. Recommend self-hosting Inter via `@fontsource/inter` so the app
  works fully offline/air-gapped. Low effort, removes a third-party request.

**Verify:** `grep -ri replit --exclude-dir=node_modules .` returns only the intentional
`// @replit` shadcn comments and this plan document.

</details>

### Phase 3 — Postgres in Docker + real migrations ✅ DONE

Outcome notes (differences from the plan as written):

- Host port is **5442**, not 5432 — ports 5432, 5433 *and* 5434 were all occupied.
- Migrations run in-process on boot via `lib/db/src/migrate.ts` + `runMigrations()` called
  from `artifacts/api-server/src/index.ts`, not via a separate migration container. Boot
  fails loudly if migrations fail.
- Baseline is `lib/db/drizzle/0000_cynical_fallen_one.sql`, verified to apply cleanly to an
  empty volume and to be a no-op on restart.
- **New finding:** a database created by the old `push` path has no `__drizzle_migrations`
  journal, so `0000` fails against it with "table already exists". The Phase 0 dump must be
  restored **data-only** into a freshly migrated database. Documented in `CLAUDE.md`.
- Phase 0's dump of the live Replit database has **not** been taken — still outstanding
  before that data can be brought over.

<details>
<summary>Original phase 3 plan</summary>

### Phase 3 — Postgres in Docker + real migrations

- `compose.yaml` service `db`: `postgres:17-bookworm`, named volume `pgdata`, `POSTGRES_*`
  from `.env`, `healthcheck: pg_isready`, port published only in the dev compose override.
- Switch `lib/db` from `push` to generated migrations:
  - add `out: "./drizzle"` to `drizzle.config.ts`
  - `pnpm --filter @workspace/db exec drizzle-kit generate` → commit the baseline SQL,
    which becomes the first real record of the schema in version control
  - add a `migrate` script using `drizzle-orm/node-postgres/migrator`
  - keep `push` available for local throwaway iteration, documented as dev-only
- App container runs migrations on boot before `listen` (single-container, single-replica —
  no need for a separate migration job or advisory locking; revisit if that ever changes).
- Restore the Phase 0 dump into the new container and confirm the data survives.

**Verify:** `docker compose up db`, run migrations against an empty volume, confirm all
three tables + enums exist; then restore the dump and confirm recipe/meal-plan/grocery rows
read back through the API.

</details>

### Phase 4 — Routing: replace `router = "application"`

**Dev** — add to `meal-planner/vite.config.ts`:
```
server: { proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } } }
```
This is what makes `pnpm dev` work at all off-Replit. The generated client's baseUrl is
`/api` (set in `orval.config.ts`), so no client change is needed.

**Prod** — add static serving to the API server, after `app.use("/api", router)`:
- `express.static` over the built `dist/public`, with long-lived immutable caching for
  hashed `/assets/*` and `no-cache` for `index.html`
- SPA fallback: any non-`/api` GET that doesn't match a file returns `index.html`, so
  wouter deep links like `/recipes/12` survive a refresh
- the fallback must not shadow `/api` — unmatched API routes should still 404 as JSON

Note this interacts with the global `Cache-Control: no-store` middleware in `app.ts`
(there to keep Express ETags from serving stale API reads — see `CLAUDE.md` landmine #2).
That middleware must be scoped to `/api` only, or hashed static assets become uncacheable.
Getting this wrong is silent: the app works, it's just slow.

**Verify:** dev — HMR works and `/api/healthz` responds through the proxy. Prod — a hard
refresh on `/recipes/12` and `/grocery-list` renders instead of 404ing; `/api/healthz`
returns JSON; hashed assets come back with a long `max-age`.

### Phase 5 — Replace the AI integration ✅ DONE

Outcome notes:

- `lib/integrations-openai-ai-server` → `lib/openai` (`@workspace/openai`). Dead `image/`,
  `audio/` and `batch/` modules deleted with it.
- Client is now **lazy**. The old module threw at *import* when credentials were missing,
  which took down the whole API server — recipes, meal plan, grocery list included — because
  one optional feature was unconfigured. Now `OPENAI_API_KEY` is optional and only the three
  AI routes fail, with a 503 and an actionable message.
- Model selection is **per task**, not one global id (see §6).
- `.env` no longer needs placeholder AI credentials; that hack is gone.

<details>
<summary>Original phase 5 plan</summary>

### Phase 5 — Replace the AI integration

- New package `lib/openai` (or rewrite in place) exporting a client built from
  `OPENAI_API_KEY` and an **optional** `OPENAI_BASE_URL` — keeping the base URL
  configurable means any OpenAI-compatible endpoint (a local Ollama/LiteLLM proxy, Azure)
  still works without touching code.
- Drop the unused `image/`, `audio/`, and `batch/` modules — nothing imports them.
- Move the model id into config (`OPENAI_MODEL`, one place) instead of the three hard-coded
  `gpt-5.6-terra` literals in `recipe-ingestion.ts` and `recipe-generation.ts` (×2).
- Update the three call sites' imports and `tsconfig` project references.
- Resolve §6 before this phase can actually run.

**Verify:** all three AI paths end-to-end — import a recipe from the cookbook PDF in
`attached_assets/`, generate a recipe, generate a week's plan. Confirm strict `json_schema`
structured output still parses. Confirm the chunking path by importing the full cookbook,
not a single-page PDF.

</details>

### Phase 6 — Dockerfile + Compose

Multi-stage `Dockerfile`, `platform: linux/amd64`:
1. **deps** — corepack pnpm, `pnpm install --frozen-lockfile` (full workspace)
2. **build** — `pnpm run build`: typecheck, esbuild the API to `dist/`, Vite build the
   frontend to `artifacts/meal-planner/dist/public`
3. **runtime** — `pnpm install --prod --frozen-lockfile`, copy `api-server/dist/` (whole
   directory, per §4) and the frontend build; run as a non-root user; `HEALTHCHECK`
   against `/api/healthz` (the route already exists)

Compose files:
- `compose.yaml` — `app` + `db`, `app` `depends_on: db: condition: service_healthy`,
  restart policies, `.env`-driven
- `compose.dev.yaml` — Postgres only, port published for host access
- `.env.example` — every variable in §7, documented, committed; real `.env` gitignored
- `.dockerignore` — `node_modules`, `dist`, `.git`, `attached_assets`, `backups`

**Verify:** from a clean clone with an empty volume, `docker compose up --build` produces a
working app on `localhost:3000` — recipes CRUD, meal plan assign, grocery generate, and one
AI path. Then `docker compose down && up` and confirm data persisted.

### Phase 7 — Operations

- Backup script: `pg_dump` from the running container into `backups/`, plus a documented
  restore path (this is a personal recipe collection — losing it is the worst realistic
  failure mode, and it's the only irreplaceable state in the system).
- Log handling: `pino-pretty` transport is dev-only already; confirm production emits plain
  JSON to stdout for `docker logs`.
- Document the update flow: `git pull && docker compose up --build -d`.

### Phase 8 — Context documents

See §8. Do this last, describing what was actually built rather than what was planned.

---

## 6. ~~Open decision~~ — RESOLVED: direct OpenAI, cheapest viable models

**Decision: option A.** Direct OpenAI with the user's own key, and the lowest-cost model
that can do each job — ingestion especially, since it is the fan-out case.

**Correction to the original framing below:** this section claimed `gpt-5.6-terra` was a
Replit-only model id that would 404 against `api.openai.com`. That was wrong — it is a real
OpenAI model. Losing the proxy therefore cost only credentials and a base URL. The decision
turned out to be about *cost*, not *survival*.

Implemented in phase 5: per-task model selection (`lib/openai/src/models.ts`), defaulting to
`gpt-5-nano` for ingestion and `gpt-5.6-luna` for the two generation tasks — versus
`gpt-5.6-terra` (~$2.00/$12.00 per 1M) previously used for all three. That is roughly a **40×
reduction in input cost on the ingestion path**, which is also the path that fires up to 12
calls per cookbook.

Caveat carried into verification: the OpenAI docs confirm Structured Outputs from
`gpt-4o-2024-08-06` "and later" but do not explicitly enumerate the newest nano/mini tiers.
The defaults must be confirmed empirically against a real key before being trusted; a model
without strict `json_schema` support fails the request outright rather than corrupting data,
so the failure mode is safe.

<details>
<summary>Original options as written</summary>

**A. Direct OpenAI with your own API key.** Smallest diff — same SDK, same
`response_format: { type: "json_schema", strict: true }`, same code paths. Swap the base
URL and pick a real current model id. Costs money per call at your own rate.

**B. Anthropic / Claude.** Larger diff: no `response_format` json_schema equivalent —
structured output is done via tool-use with an input schema, so
`RECIPE_OBJECT_SCHEMA` and all three call sites need rework. Different SDK.

**C. Local model** via Ollama/LM Studio behind an OpenAI-compatible endpoint. Free and
private, but strict structured-output adherence is much weaker at small model sizes, and
the code depends on strict schema conformance to parse drafts. Would need real testing on
the cookbook PDF before trusting it.

**Recommendation: A**, with the base URL kept configurable so C remains a drop-in
experiment later. Either way the model id becomes `OPENAI_MODEL` in `.env` rather than a
literal in three files.

</details>

Also worth noting: `recipe-retrieval.ts` uses Postgres full-text search rather than
embeddings *because* the Replit proxies had no embeddings API (`.agents/memory/ai-integrations-no-embeddings.md`).
With a direct provider key that constraint disappears — pgvector-based semantic retrieval
becomes possible. **Out of scope here**, but the memory file should be updated in Phase 8
to record that the constraint was environmental and no longer applies.

## 7. Environment variables after migration

| Var | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | — | required; compose builds it from the `POSTGRES_*` values |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | — | compose only |
| `PORT` | `3000` | gains a default (currently throws) |
| `BASE_PATH` | `/` | gains a default (currently throws) |
| `OPENAI_API_KEY` | — | required for AI features |
| `OPENAI_BASE_URL` | OpenAI default | optional; set for a local/proxy endpoint |
| `OPENAI_MODEL` | TBD per §6 | replaces three hard-coded literals |
| `NODE_ENV` | `production` in image | |
| `LOG_LEVEL` | `info` | |

Removed: `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `REPL_ID`.

## 8. Context-document strategy (preserved)

The current two-tier setup stays exactly as it is — a living top-level doc plus an indexed,
one-fact-per-file memory directory. Only the Replit-branded surface changes:

- **`CLAUDE.md`** stays the engineering-facing doc, auto-loaded by Claude Code. Updated in
  Phase 8: new commands, Docker topology, revised env table, revised landmines.
- **`replit.md` → `PROJECT.md`.** Same product/architecture content, no Replit branding, no
  Replit-specific run instructions. Keep it separate from `CLAUDE.md` — it stays the
  product/decisions doc while `CLAUDE.md` stays the how-to-work-here doc. Symlinking or
  duplicating to `AGENTS.md` is optional if other agent tools get used.
- **`.agents/memory/`** keeps its exact format: `MEMORY.md` index of one-line pointers, one
  fact per file with `name`/`description` frontmatter and **Why:** / **How to apply:**
  bodies. Nothing about that format was Replit-specific.

Memory updates due in Phase 8:
- **Edit** `ai-integrations-no-embeddings.md` — mark the constraint as historical
  (Replit-proxy-specific), since a direct provider key lifts it.
- **Keep unchanged and still true:** `orval-date-coercion`, `orval-zod-codegen`,
  `express-etag-stale-api-reads`, `ai-extraction-chunking`.
- **Keep, with added Docker context:** `pdf-parse-esbuild-bundling` — the externalization
  requirement now also dictates that the runtime image ship `node_modules`, which is
  exactly the kind of non-obvious coupling that file exists to capture.
- **New:** the platform-overrides trap from §3.1 — a workspace config that silently makes
  a repo unbuildable off one specific host OS is a genuinely surprising failure mode and
  the single most valuable thing learned in this audit.
- **New:** the `no-store` vs. static-asset-caching interaction from Phase 4, if it bites.

## 9. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| ~~AI model id has no off-Replit equivalent~~ | ~~**High**~~ **RESOLVED** | The premise was wrong — `gpt-5.6-terra` is a real OpenAI model. Phase 5 shipped on direct OpenAI, ~18× cheaper than before |
| ~~Recipe data lost in migration~~ | ~~**High**~~ **RETIRED** | Owner confirmed the Replit data is disposable; nothing to lose. New database starts empty |
| ~~Regenerating `pnpm-lock.yaml` pulls different versions~~ | ~~Medium~~ **RESOLVED** | Diff was purely the re-added platform binaries; no dependency version changed |
| `pdf-parse` native deps behave differently in-container | Medium | glibc base image; PDF import is an explicit Phase 6 verification step |
| Full-cookbook import holds one HTTP request ~130s | Medium | Measured in phase 5. Constrains proxy/LB timeouts and container healthcheck intervals in phase 6 |
| SPA fallback shadows `/api`, or `no-store` kills asset caching | Low, but silent | Explicit Phase 4 verification of both |
| First-ever migration baseline drifts from the live DB | Medium | Generate the baseline from current schema, then diff against the restored dump |

## 10. Sequencing

Phases 1 → 2 → 3 → 4 → 6 are the critical path to "runs in Docker". Phase 5 can proceed in
parallel with 3/4 once §6 is decided; without it the app runs but the three AI features
return errors. Phases 7 and 8 land after the stack works.

Rough shape: Phase 1 is the riskiest (lockfile regeneration), Phase 4 the most
error-prone, Phase 6 the most iterative. Phases 2 and 8 are mechanical.
