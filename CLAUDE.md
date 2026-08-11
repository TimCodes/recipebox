# Kitchen Notebook — working context

Personal meal-planning app built on Replit: a recipe box, a weekly meal-plan grid, and an
auto-generated grocery list, plus three AI features (import a recipe, generate a recipe,
generate a week's plan).

`replit.md` is the product/architecture doc maintained for the Replit agent — read it too.
This file is the engineering-facing companion: how the pieces fit, what the workflows are,
and where the traps are.

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
- `pnpm --filter @workspace/db run push` — push Drizzle schema to Postgres (dev only; there
  are no migration files, `drizzle-kit push` is the only path).
- pnpm only. The root `preinstall` hard-fails any other package manager.
- `scripts/post-merge.sh` (wired via `.replit` `[postMerge]`) runs `pnpm install --frozen-lockfile`
  then a db push after every merge.

**There is no test suite** — no vitest/jest config, no `*.test.*` files anywhere. `pnpm run typecheck`
is the only automated check. Verify behavior by running the app.

## Environment variables

| Var | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `lib/db`, `drizzle.config.ts` | throws at import time if missing |
| `PORT` | api-server, vite | both throw if missing/invalid — no defaults |
| `BASE_PATH` | meal-planner vite config | throws if missing; becomes vite `base` |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY` | `lib/integrations-openai-ai-server` | Replit AI Integrations proxy; throws at import if missing |
| `LOG_LEVEL`, `NODE_ENV` | api-server | pino level; `pino-pretty` transport off in production |

Every one of these throws on module load rather than defaulting, so a missing var shows up as an
immediate crash, not a subtle misbehavior.

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
lib/integrations-openai-ai-server/  ← OpenAI SDK pointed at the Replit proxy
artifacts/api-server/          ← Express 5 API, mounted at /api, esbuild → dist/index.mjs
artifacts/meal-planner/        ← React 19 + Vite + wouter + shadcn/ui, the actual product
artifacts/mockup-sandbox/      ← Replit design scratchpad, NOT part of the product
scripts/                       ← post-merge hook + a stub
attached_assets/               ← source PDFs / generated images used during development
```

`artifacts/mockup-sandbox` carries a near-duplicate copy of `components/ui/*`. When editing
shadcn primitives, only `artifacts/meal-planner/src/components/ui/` affects the app.

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
`POST /recipes/generate`), `meal-plan` (list by date range, create, patch, delete,
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

All three AI endpoints use `openai.chat.completions.create` with model `gpt-5.6-terra` and a
`strict: true` `json_schema` response format. `RECIPE_OBJECT_SCHEMA` in `recipe-ingestion.ts` is
the shared recipe shape reused by generation — change it in one place.

- **`recipe-ingestion.ts`** — PDF text via `pdf-parse` v2, then chunked extraction
  (18k chars, ≤12 chunks, 4 concurrent, ≤60 recipes returned) merged across chunks, with
  user-facing `warnings[]` when a cap is hit.
- **`recipe-retrieval.ts`** — RAG grounding via **Postgres full-text search** computed live
  (`to_tsvector`/`websearch_to_tsquery`/`ts_rank`), not embeddings. The Replit AI Integrations
  proxies expose no embeddings API. Falls back to most-recently-updated recipes when the
  collection is small or the query matches nothing.
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

- No tests, no auth, no multi-user scoping.
- No `(date, mealSlot)` DB constraint — duplicate slot entries are only prevented in app code.
- Grocery aggregation ignores `servings` and does no unit normalization ("1 cup" + "8 oz" stay
  separate lines).
- Recipe list search and the dashboard both load all recipes into memory.
- Photos are static-file URLs only; there's no upload path.
