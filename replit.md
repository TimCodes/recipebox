# Kitchen Notebook

A personal meal-planning app: a recipe box, a weekly meal plan builder, and an auto-generated grocery list.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/meal-planner run dev` — run the web frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec (run this after editing `lib/api-spec/openapi.yaml`)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, mounted under `/api` (artifact `artifacts/api-server`)
- Frontend: React + Vite, mounted at `/` (artifact `artifacts/meal-planner`)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod, `drizzle-zod`
- API codegen: Orval (react-query hooks + Zod schemas generated from `lib/api-spec/openapi.yaml`)
- Build: esbuild (CJS bundle) for the API server

## Where things live

- `lib/api-spec/openapi.yaml` — source-of-truth API contract (recipes, meal-plan, grocery-list, dashboard)
- `lib/api-spec/orval.config.ts` — codegen config
- `lib/api-client-react/src/generated/` — generated react-query hooks + TS types (import from `@workspace/api-client-react`, not deep `/src/generated/...` paths — the package only exports its root)
- `lib/api-zod/src/generated/` — generated Zod schemas for request/response validation
- `lib/db/src/schema/` — Drizzle schema: `recipes.ts`, `meal-plan-entries.ts`, `grocery-list-items.ts`
- `artifacts/api-server/src/routes/` — Express route handlers (recipes, meal-plan, grocery-list, dashboard)
- `artifacts/api-server/src/lib/` — `date.ts` (Date → "YYYY-MM-DD" string helper), `recipe-summary.ts`, `grocery.ts` (grocery list regeneration logic)
- `artifacts/meal-planner/src/pages/` — dashboard, recipes-list, recipe-detail, recipe-form, meal-plan, grocery-list
- `artifacts/meal-planner/public/images/` — seeded recipe photos (generated images, referenced by `photoUrl` as `/images/*.jpg`)

## Architecture decisions

- Recipe ingredients are stored as a JSON array on the `recipes` row (no separate ingredients table). Grocery list aggregation only sums ingredients across the week's planned recipes when name (case-insensitive) and unit match exactly — no unit conversion.
- No object storage / file upload for recipe photos — `photoUrl` is just a string field; seed data points at static files served from `artifacts/meal-planner/public/images/`.
- Grocery list "auto" items are fully regenerated from the week's meal plan on each `/grocery-list/generate` call (stale auto items deleted, `checked` state preserved when name+unit still match); "manual" items are left untouched.
- Dates (`date`, `weekStart`, `startDate`/`endDate` query params) are stored as Drizzle `date(mode:"string")` columns but generated Zod schemas coerce them to JS `Date` objects — route handlers must convert back to `"YYYY-MM-DD"` via `toDateString()` before writing to the DB.
- Recipe ingestion (`POST /recipes/ingest`) accepts PDF as base64 JSON (not multipart) to keep the Orval-generated typed client working. It never writes to the DB directly — it only returns draft(s) for the client to review/edit and then save through the normal `POST /recipes` path.
- PDF text is extracted server-side with `pdf-parse` (v2, wraps `pdfjs-dist`); structured recipe extraction runs via a `gpt-5.6-terra` chat completion with a strict `json_schema` response format (see `artifacts/api-server/src/lib/recipe-ingestion.ts`).
- AI recipe/meal-plan generation (`POST /recipes/generate`, `POST /meal-plan/generate`) is RAG-grounded in the user's own recipe collection, but retrieval uses **Postgres full-text search** (`to_tsvector`/`websearch_to_tsquery`/`ts_rank`, computed live — see `artifacts/api-server/src/lib/recipe-retrieval.ts`), not vector embeddings — neither the OpenAI nor Gemini Replit AI Integrations proxies expose an embeddings API. Since it's computed live from the current rows, retrieval can never drift out of sync with creates/edits/deletes. Like ingestion, neither generate endpoint writes to the DB directly; the client saves/assigns only after the user reviews the draft.

## Product

- **Dashboard** (`/`) — this week's meal count, recipe count, grocery progress, today's planned meals, recently added recipes.
- **Recipe Box** (`/recipes`, `/recipes/:id`, `/recipes/new`) — searchable/taggable recipe collection with full CRUD.
- **Meal Plan** (`/meal-plan`) — weekly grid (breakfast/lunch/dinner slots × 7 days), assign recipes per slot, week navigation.
- **Grocery List** (`/grocery-list`) — categorized checklist, auto-synced from the week's meal plan or manually appended, per-item checked state.
- **Import Recipe** (`/recipes/import`) — paste raw recipe text or upload a PDF; AI extracts one or more structured recipe drafts (splitting multi-recipe documents) for review/edit before saving each via the normal create-recipe path. Ingested recipes are never persisted directly — they always go through the same validation/save flow as manually created ones.
- **Generate Recipe with AI** (`/recipes/generate`) — describe a dish/prompt; AI proposes one new recipe grounded in the user's existing collection (shown as "Inspired by" chips when relevant), as an editable draft saved through the normal create-recipe path.
- **Generate Meal Plan with AI** (`/meal-plan/generate`) — pick which meal slots to plan (defaults to dinner) and describe the week; AI fills each empty slot with either an existing recipe or a newly generated one (reusing one big-batch recipe across multiple slots when asked), shown as a removable-card review grid before the user accepts and the plan + any new recipes are saved. Already-planned slots are skipped with a clear reason shown to the user.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always import from `@workspace/api-client-react` (the package root) — deep imports like `@workspace/api-client-react/src/generated/api.schemas` are not in its `exports` map and will fail to resolve in Vite.
- API response `date` fields serialize as full ISO datetime strings (e.g. `"2026-08-10T00:00:00.000Z"`). When comparing against a `"yyyy-MM-dd"` string in the frontend, use `.slice(0, 10)` (or parse both sides) rather than `===`.
- `DashboardSummary` is not a Zod export from `@workspace/api-zod` — use `GetDashboardSummaryResponse` for response validation in the dashboard route.
- After changing `lib/api-spec/openapi.yaml`, always re-run `pnpm --filter @workspace/api-spec run codegen` before touching frontend or backend code that consumes the new shape.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
