# Kitchen Notebook

A personal meal-planning app: a recipe box, a weekly meal-plan builder, and an
auto-generated grocery list — plus AI recipe import, recipe generation, and meal-plan
generation.

Self-hosted with Docker. One app container (Express serving the API and the built React
bundle) plus Postgres.

## Quick start

```bash
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env` if you want the AI features. Everything else has working
defaults, and the app runs fine without a key — only the AI routes return 503.

```bash
docker compose up --build -d
```

Open <http://localhost:3000>. Set `APP_PORT` in `.env` to use a different host port.

The database schema is created automatically: the app applies migrations on boot and exits
rather than serving against a schema it doesn't match.

## Development

Postgres in Docker, app and frontend on the host so you keep HMR:

```bash
docker compose -f compose.dev.yaml up -d
```

```bash
pnpm install
```

Then in two terminals:

```bash
pnpm --filter @workspace/api-server run dev
```

```bash
pnpm --filter @workspace/meal-planner run dev
```

The frontend runs on <http://localhost:5173> and proxies `/api` to the API server on 3000.

Requires Node 24 and pnpm 10. Other package managers are rejected by a `preinstall` guard.

## Common tasks

| Task | Command |
| --- | --- |
| Typecheck everything | `pnpm run typecheck` |
| Build everything | `pnpm run build` |
| Regenerate API client + Zod schemas | `pnpm --filter @workspace/api-spec run codegen` |
| Create a migration after a schema change | `pnpm --filter @workspace/db run generate` |
| Back up the database | `./scripts/backup-db.sh` |
| Restore a backup | `./scripts/restore-data.sh backups/<ts>-data.sql` |

There is no test suite. `pnpm run typecheck` is the only automated check.

## Updating

```bash
git pull && docker compose up --build -d
```

Migrations run automatically on boot. Take a backup first if the release changes the schema.

## Backups

`./scripts/backup-db.sh` writes two timestamped files to `backups/` (gitignored) and keeps
the newest 14 of each — override with `KEEP=30`.

- `<ts>-data.sql` — **use this for normal recovery.** Recreate the volume, let the app run
  migrations at boot, then `./scripts/restore-data.sh` it.
- `<ts>-full.sql` — schema + data, for restoring into a completely empty database without
  the app involved.

The data-only file is the right one for recovery because the schema already exists after
migrations; a full restore would collide with it. `restore-data.sh` refuses to run against a
non-empty database unless you pass `FORCE=1`.

Verified drill: destroy the volume, bring the stack back up, restore — recipes return and
id sequences resume correctly.

## Configuration

All settings live in `.env`; see `.env.example` for the full annotated list. The ones that
matter most:

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | optional; without it AI routes return 503 |
| `OPENAI_MODEL_INGEST` | `gpt-4o-mini` | per-task model, chosen by measurement |
| `APP_PORT` | `3000` | host port for the app |
| `POSTGRES_USER` / `_PASSWORD` / `_DB` | `recipebox` | change the password for anything exposed |

**This app has no authentication and no multi-user support.** It assumes a single trusted
user. Don't expose it to the internet without putting authentication in front of it.

## Documentation

- `PROJECT.md` — product behaviour and architecture decisions
- `CLAUDE.md` — engineering context: workflows, conventions, and the non-obvious traps
- `DEREPLIT_PLAN.md` — the migration from Replit to Docker, and why each choice was made
