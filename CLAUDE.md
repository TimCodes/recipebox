# Kitchen Notebook — working context

Personal meal-planning app: a recipe box, a weekly meal-plan grid, and an auto-generated
grocery list, plus three AI features (import a recipe, generate a recipe, generate a
week's plan).

Runs as a Docker Compose stack: one app container (Express serving the API and the built
React bundle) plus Postgres. Originally built on Replit; `DEREPLIT_PLAN.md` records that
migration and the reasoning behind each decision.

Docs: `README.md` (run/update/back up) · `PROJECT.md` (product + architecture decisions) ·
this file (engineering context, conventions, traps) · `.agents/memory/` (one fact per file,
indexed by `MEMORY.md` — read it, the entries there are all things that already cost a
debugging session).

## Commands

```bash
pnpm --filter @workspace/api-server run dev
```

```bash
pnpm --filter @workspace/meal-planner run dev
```

```bash
pnpm --filter @workspace/api-spec run codegen
```

```bash
pnpm run typecheck
```

- `pnpm run build` — typecheck, then build every package.
- `docker compose -f compose.dev.yaml up -d` — dev: Postgres only (host port 5442; 5432–5434
  are taken on this machine). API + Vite run on the host for HMR.
- `docker compose up --build -d` — prod: the whole stack in containers, one app image serving
  API + frontend. Open `http://localhost:${APP_PORT:-3000}`.
- `pnpm --filter @workspace/db run generate` — generate a migration after editing the schema.
- `pnpm --filter @workspace/db run migrate` — apply pending migrations manually. Normally
  unnecessary: the API server applies them on boot.
- `pnpm --filter @workspace/db run push` — **dev-only** schema push, no migration recorded.
  Never point this at a database holding real data.
- pnpm only. The root `preinstall` hard-fails any other package manager.

**There is no test suite** — no vitest/jest config, no `*.test.*` files anywhere. `pnpm run typecheck`
is the only automated check. Verify behavior by running the app.

## Environment variables

| Var | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `lib/db`, `drizzle.config.ts` | **required** — throws at import time if missing |
| `OPENAI_API_KEY` | `lib/openai` | **optional** — without it the app runs normally and only the three AI endpoints return 503 |
| `OPENAI_BASE_URL` | `lib/openai` | optional; any OpenAI-compatible endpoint. Blank = api.openai.com |
| `OPENAI_MODEL_INGEST` / `OPENAI_MODEL_RECIPE` / `OPENAI_MODEL_MEAL_PLAN` / `OPENAI_MODEL` | `lib/openai` | per-task model override; `OPENAI_MODEL` overrides all three |
| `PORT` | api-server | defaults `3000`. **This machine uses 3002** — 3000 is published by the `perceptacle-local-control-plane` kind cluster and 3001 is also taken |
| `WEB_PORT` | meal-planner vite config | defaults `5173` (was `PORT`, renamed so `.env` can be shared) |
| `BASE_PATH` | meal-planner vite config | defaults `/`; becomes vite `base` |
| `API_PROXY_TARGET` | meal-planner vite config | defaults `http://localhost:3000`; dev `/api` proxy target |
| `MIGRATIONS_DIR` | api-server | defaults to `lib/db/drizzle` relative to the bundled server; set explicitly in the image |
| `STATIC_DIR` | api-server | frontend build to serve; unset + absent = API-only mode (what dev uses) |
| `APP_PORT` | compose | host port for the app container (default 3000) |
| `LOG_LEVEL`, `NODE_ENV` | api-server | pino level; `pino-pretty` transport off in production |

Local values live in `.env` (gitignored, copied from `.env.example`). The API server loads it
via Node's `--env-file-if-exists`; the Vite config loads the same file explicitly with
`loadEnv`, so both read their settings from one place. Before that, Vite defaulted its proxy
to port 3000 while the API server was told to listen elsewhere, and the browser just reported
"Failed to fetch" with nothing useful in any log.

## Workspace map

pnpm workspaces (`artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts`), Node 24, TS 5.9,
TS project references from the root `tsconfig.json`.

```
lib/api-spec/openapi.yaml      ← SOURCE OF TRUTH for the whole API contract
lib/api-spec/orval.config.ts   ← generates both clients below
lib/api-client-react/          ← generated react-query hooks + TS types (@workspace/api-client-react)
  src/custom-fetch.ts          ← hand-written fetch mutator (baseUrl, auth-token hook, ApiError)
lib/api-zod/                   ← generated Zod request/response schemas (@workspace/api-zod)
lib/db/                        ← Drizzle schema + pool (@workspace/db)
lib/openai/                    ← lazy OpenAI client + per-task model selection (@workspace/openai)
artifacts/api-server/          ← Express 5 API, mounted at /api, esbuild → dist/index.mjs
artifacts/meal-planner/        ← React 19 + Vite + wouter + shadcn/ui, the actual product
scripts/                       ← pnpm enforcement guard + a stub
attached_assets/               ← source PDFs / generated images used during development
compose.dev.yaml               ← Postgres for local dev (host port 5442)
compose.yaml                   ← full prod stack: app image + Postgres
Dockerfile                     ← multi-stage, linux/amd64, single app image
```

## Serving model

One Express process serves both, replacing Replit's `router = "application"`:

- **dev** — Vite owns `/` with HMR and proxies `/api` to the API server on 3000. No build
  output exists, so `mountStatic` logs "serving API only" and does nothing.
- **prod** — `artifacts/api-server/src/static.ts` serves `artifacts/meal-planner/dist/public`.
  Hashed `/assets/*` are `immutable, max-age=1y`; `index.html` is `no-cache`; the SPA fallback
  returns `index.html` for any non-`/api` GET so wouter deep links survive a refresh.

Three ordering rules there are load-bearing:

1. `Cache-Control: no-store` is scoped to `/api`, **not** global. Global would make every
   content-hashed asset uncacheable — invisible, the app just gets slow.
2. The SPA fallback skips `/api`, and a JSON 404 handler sits after the API router, so a
   typo'd endpoint returns `{"error":"Not found"}` rather than an HTML document.
3. `mountStatic` runs after `app.use("/api", router)`, so the API can never be shadowed.

The fallback is a bare middleware, not `app.get("*")` — Express 5 uses path-to-regexp v8,
which rejects a bare `"*"` as a path.

## The one workflow that matters: contract-first codegen

The OpenAPI spec drives both the backend's validation and the frontend's data layer. Any API
change is a three-step loop, in this order:

1. Edit `lib/api-spec/openapi.yaml` (add path + `operationId` + schemas).
2. Run codegen — it regenerates `lib/api-client-react/src/generated/` and
   `lib/api-zod/src/generated/` with `clean: true` (both dirs are wiped and rewritten;
   never hand-edit anything under `generated/`), then runs `typecheck:libs`.
3. Write the route handler and the UI against the newly generated names.

Naming follows `operationId`: `listRecipes` →  `ListRecipesQueryParams` / `ListRecipesResponse`
in `@workspace/api-zod`, and `useListRecipes` / `getListRecipesQueryKey` in
`@workspace/api-client-react`.

Every route handler follows the same shape: `safeParse` params/query/body with the generated
schema → 400 with `{ error }` on failure → do the work → `Response.parse(...)` on the way out.
Keep new handlers to that shape.

## Migrations

Committed SQL lives in `lib/db/drizzle/`, generated by `drizzle-kit generate` from the
schema. `artifacts/api-server/src/index.ts` applies pending migrations on boot before
`listen`, and exits non-zero if that fails — the server never serves against a schema it
doesn't match. Drizzle records applied migrations in `drizzle.__drizzle_migrations`, so
repeated boots are a no-op.

Schema change workflow: edit `lib/db/src/schema/*.ts` → `pnpm --filter @workspace/db run
generate` → review the emitted SQL → commit schema and migration together. Restarting the
API server applies it.

The migrations directory is located relative to the bundled server by default; set
`MIGRATIONS_DIR` when the tree is laid out differently (containers).

**Baselining an existing database:** a database whose tables were created by the old
`drizzle-kit push` path has no `__drizzle_migrations` journal, so migration `0000` will try
to `CREATE TABLE` over existing tables and fail. To move such a database over, restore
data-only (`pg_dump --data-only`) into a freshly migrated database rather than restoring a
full schema+data dump.

## Data model (`lib/db/src/schema/`)

- **`recipes`** — ingredients are a `jsonb` array of `Ingredient` (`name`, `quantity`, `unit`,
  `category`) on the row itself; there is no ingredients table. `tags` is a `text[]`.
  `photoUrl` is a plain string (static files under `artifacts/meal-planner/public/images/`) —
  there is no upload/object-storage path.
- **`meal_plan_entries`** — `date` (`mode:"string"`), `mealSlot` enum
  (breakfast/lunch/dinner/snack), `recipeId` FK with `onDelete: cascade`. No uniqueness
  constraint on (date, slot) — duplicates are prevented in application code only.
- **`grocery_list_items`** — scoped by `weekStart` (`mode:"string"`), `source` is `auto` or
  `manual`, `recipeSources` is a denormalized `jsonb` snapshot of `{id, title}` so tags survive
  a source recipe being renamed or deleted.

No users table, no auth, no tenancy — the whole app is single-user and every query is unscoped.
Anything user-scoped is a schema-wide change.

## API surface (`artifacts/api-server/src/routes/`)

`recipes` (list/search, create, get, patch, delete, `GET /recipes/tags`, `POST /recipes/ingest`,
`POST /recipes/pdf-outline`, `POST /recipes/generate`), `meal-plan` (list by date range, create, patch, delete,
`POST /meal-plan/generate`), `grocery-list` (list, create manual, clear week,
`POST /grocery-list/generate`, patch, delete), `dashboard`, `healthz`.

Two behaviors worth knowing before touching them:

- **Recipe search is in-memory.** `GET /recipes` selects every row then filters in JS across
  title, tags, and ingredient names. Fine at personal scale, the first thing to change if the
  collection grows.
- **Grocery regeneration** (`lib/grocery.ts`) aggregates the week's planned recipes, summing
  quantities only when name (case-insensitive, trimmed) *and* unit match exactly — there is no
  unit conversion, and a missing quantity on either side collapses the total to `null`. It
  updates matching auto items in place (preserving `checked`), inserts new ones, deletes stale
  ones, and never touches `manual` items. It also ignores per-entry `servings` — quantities are
  not scaled.

## AI subsystem (`artifacts/api-server/src/lib/`)

All three AI endpoints call `getOpenAI().chat.completions.create` with a `strict: true`
`json_schema` response format. `RECIPE_OBJECT_SCHEMA` in `recipe-ingestion.ts` is the shared
recipe shape reused by generation — change it in one place.

**Model choice is per task**, resolved by `modelFor()` in `lib/openai/src/models.ts` —
`gpt-4o-mini` for `ingest`, `gpt-5.6-luna` for `recipe`/`mealPlan`, all env-overridable.
That file documents the measured benchmark behind those defaults. Two results worth knowing
before changing them:

- **The gpt-5 family are reasoning models.** At default effort `gpt-5-nano` spent 3,072
  reasoning tokens on mechanical transcription — 6.4× the cost and 10× the latency of
  `gpt-4o-mini`. Cheapest per token is not cheapest per task when output dominates.
- `gpt-5-nano` with `reasoning_effort: "minimal"` is cheaper still, but consistently merged
  `"salt and pepper"` into one ingredient. That breaks grocery aggregation, which matches on
  exact name — a merged ingredient never combines across recipes.

Real numbers: the full cookbook in `attached_assets/` yields 60 recipes for ~$0.04 and
**~130 seconds** — a 12-chunk fan-out at concurrency 4. That request duration is a real
constraint for any proxy or load balancer put in front of the API.

Every task depends on strict structured outputs. Swap in a model that doesn't support them
and the call fails loudly (the API rejects `response_format`) rather than returning
unparseable text — so a bad model choice surfaces immediately, not as corrupt data.

The client is **lazy** (`getOpenAI()`): a missing `OPENAI_API_KEY` fails only the AI routes,
with a 503, instead of preventing the server from booting at all.

- **`pdf-outline.ts`** — **zero-token** PDF recipe detection. Extracts per-page text and
  locates recipe boundaries and titles with heuristics only, so the user can pick a few
  recipes out of a cookbook before any model call. Measured on the 206-page cookbook in
  `attached_assets/`: 101 recipes detected (the book claims 101), 8/8 title recall on a spot
  check, 53% of recipes span more than one page. Titles anchor on the line above the
  serves/prep metadata line. **Always normalise text through `clean()` before matching** —
  PDF extraction leaves invisible zero-width and non-breaking characters that silently break
  anchored regexes. `endPage` runs to the page before the next recipe starts, because
  selecting a single page would truncate the majority of recipes.
- **`recipe-ingestion.ts`** — PDF text via `pdf-parse` v2, then chunked extraction
  (18k chars, ≤12 chunks, 4 concurrent, ≤60 recipes returned) merged across chunks, with
  user-facing `warnings[]` when a cap is hit.
- **`recipe-retrieval.ts`** — RAG grounding via **Postgres full-text search** computed live
  (`to_tsvector`/`websearch_to_tsquery`/`ts_rank`), not embeddings. This was originally forced
  by the Replit proxies having no embeddings API; with a direct OpenAI key that constraint is
  gone, so pgvector retrieval is now possible if ever wanted. Falls back to most-recently-updated
  recipes when the collection is small or the query matches nothing.
- **`recipe-generation.ts`** — recipe generation returns `inspiredByIds` (filtered against the
  real candidate set before it's trusted); meal-plan generation returns per-slot assignments,
  validates every returned slot against the requested set, drops duplicates and hallucinated
  recipe ids into `skippedSlots` with a reason, and supports `newRecipeKey` so one big-batch
  recipe reused across slots is created once.

**No AI endpoint writes to the DB.** All three return drafts; the client saves them through the
normal `POST /recipes` and `POST /meal-plan` paths (see the loop in
`artifacts/meal-planner/src/pages/meal-plan-generate.tsx`, which creates recipes then entries
sequentially and dedupes by `newRecipeKey`). Preserve that property when adding AI features —
it's what keeps validation and the review step honest.

## Frontend conventions (`artifacts/meal-planner/`)

- Routing is `wouter` (`App.tsx`); `/recipes/new`, `/recipes/import`, `/recipes/generate` are
  declared **before** `/recipes/:id` — order matters there.
- Data comes exclusively from generated hooks. Import from `@workspace/api-client-react`
  (package root only — the `exports` map has no deep paths, deep imports fail in Vite).
- react-query defaults: `retry: false`, `refetchOnWindowFocus: false`. After mutations, pages
  call `queryClient.invalidateQueries` with a generated `get*QueryKey(...)` helper; a few list
  screens use ad-hoc string keys (`['recipes', search, tag]`) — prefer the generated helpers in
  new code so invalidation lines up.
- shadcn/ui + Tailwind v4 (`@/` → `src/`, `@assets` → `attached_assets`). Feedback via
  `useToast` from `@/hooks/use-toast`. Errors from the API are unwrapped via the `data.error`
  shape (see `extractErrorMessage` in `recipe-import.tsx`).
- Week boundaries are Monday: `getWeekStart` in `src/lib/date-utils.ts` uses `weekStartsOn: 1`.
  Everything week-scoped keys off that `yyyy-MM-dd` string.
- No `data-testid` attributes anywhere.

## Landmines

These are all documented in `.agents/memory/` and each one has already cost a debugging session:

1. **Dates round-trip through `Date`.** Orval coerces `date`/`date-time` fields in bodies,
   queries, and params into JS `Date` objects, but the DB columns are `date(mode:"string")`.
   Route handlers must call `toDateString()` (`src/lib/date.ts`, UTC-based) before any write.
   On the frontend, API `date` fields serialize as full ISO strings — compare with
   `.slice(0, 10)` against `yyyy-MM-dd`, never `===`.
2. **ETags are disabled on purpose** (`app.ts`, plus `Cache-Control: no-store`). Express's weak
   ETags let a GET right after a mutation return 304, which `customFetch` treats as no-body and
   resolves as `null` — the UI silently shows stale data while the mutation reports success.
   Don't re-enable.
3. **`pdf-parse` / `pdfjs-dist` must stay in the esbuild `external` list** in
   `artifacts/api-server/build.mjs`, or the server crashes at import with
   `ReferenceError: DOMMatrix is not defined`.
4. **Orval's zod version is pinned explicitly** (`override.zod.version: 3`). Auto-detection
   misfires because `zod` is a `catalog:` reference, emitting v4-only syntax against v3.
5. **`pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`** (1-day supply-chain delay). Do not
   remove it; use `minimumReleaseAgeExclude` if a brand-new version is genuinely required.
6. `DashboardSummary` is not exported as a Zod schema — use `GetDashboardSummaryResponse`.

## Known gaps / likely next work

- No tests, no auth, no multi-user scoping. The app assumes a single trusted user; do not
  expose it publicly without authentication in front.
- No `(date, mealSlot)` DB constraint — duplicate slot entries are only prevented in app code.
- Grocery aggregation ignores `servings` and does no unit normalization ("1 cup" + "8 oz" stay
  separate lines).
- Recipe list search and the dashboard both load all recipes into memory.
- Photos are static-file URLs only; there's no upload path.

## Operations

- `./scripts/backup-db.sh` — timestamped dump of the local database to `backups/`, keeping
  the newest 14 of each kind. Emits a full dump and a data-only dump.
- `./scripts/restore-data.sh backups/<ts>-data.sql` — restore. Refuses a non-empty target
  unless `FORCE=1`, because a data-only dump carries explicit primary keys and would collide.
- The recovery drill has actually been run: destroy the volume, bring the stack up, restore —
  data returns and id sequences resume correctly rather than restarting at 1.
- Production logs are plain JSON on stdout (`docker compose logs app`); `pino-pretty` is
  dev-only.
- Update flow: `git pull && docker compose up --build -d`. Migrations apply on boot.

Note `compose.yaml` and `compose.dev.yaml` share the `recipebox_pgdata` volume — they are the
same Compose project. Convenient, but `down -v` on either wipes both.
