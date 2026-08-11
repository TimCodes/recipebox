#!/usr/bin/env bash
# Backs up the local (containerized) database to backups/.
#
#   ./scripts/backup-db.sh              # timestamped backup, prunes to the newest 14
#   KEEP=30 ./scripts/backup-db.sh      # keep more
#
# This is the one that matters now. The Replit data was disposable (see DEREPLIT_PLAN.md
# phase 0), so from here the local database holds the only copy of the recipe collection.
#
# Writes two files per run:
#   <ts>-full.sql   schema + data. Restore into an EMPTY database if you need the whole thing
#                   back without the app running.
#   <ts>-data.sql   data only. This is the one to use for normal recovery: recreate the
#                   volume, let the app run migrations at boot, then ./scripts/restore-data.sh
#                   this file. See CLAUDE.md, "Baselining an existing database", for why the
#                   full dump is the wrong tool there.
set -euo pipefail

cd "$(dirname "$0")/.."

KEEP="${KEEP:-14}"
DB_USER="${POSTGRES_USER:-recipebox}"
DB_NAME="${POSTGRES_DB:-recipebox}"
OUT_DIR="backups"
TS="$(date +%Y%m%d-%H%M%S)"

# Prefer whichever compose stack is up; fall back to the dev container name.
CONTAINER="${PG_CONTAINER:-}"
if [[ -z "$CONTAINER" ]]; then
  CONTAINER="$(docker compose ps -q db 2>/dev/null || true)"
fi
if [[ -z "$CONTAINER" ]]; then
  CONTAINER="$(docker compose -f compose.dev.yaml ps -q db 2>/dev/null || true)"
fi
if [[ -z "$CONTAINER" ]]; then
  CONTAINER="recipebox-postgres"
fi

if ! docker exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
  echo "Database container '$CONTAINER' is not running or not ready." >&2
  echo "Start it with: docker compose up -d db" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
  > "$OUT_DIR/$TS-full.sql"
# --exclude-schema=drizzle is essential. Without it the data-only dump carries the
# __drizzle_migrations journal rows, which already exist in any migrated target — the insert
# then fails on a duplicate key and rolls back the WHOLE restore, silently leaving you with
# nothing restored. The full dump keeps that schema, since it restores into an empty database.
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges --data-only \
  --exclude-schema=drizzle > "$OUT_DIR/$TS-data.sql"

# A dump that silently produced nothing is worse than no dump, because it looks like a backup.
for f in "$OUT_DIR/$TS-full.sql" "$OUT_DIR/$TS-data.sql"; do
  if [[ ! -s "$f" ]]; then
    echo "Dump $f is empty — refusing to treat this as a successful backup." >&2
    exit 1
  fi
done

echo "Backed up:"
ls -lh "$OUT_DIR/$TS-full.sql" "$OUT_DIR/$TS-data.sql" | awk '{print "  " $5 "\t" $9}'

echo "Row counts captured:"
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atc "
  select '  recipes:            ' || count(*) from recipes
  union all select '  meal_plan_entries:  ' || count(*) from meal_plan_entries
  union all select '  grocery_list_items: ' || count(*) from grocery_list_items;"

# Retention. Counted per suffix so a pair is never half-pruned.
for suffix in full data; do
  mapfile -t old < <(ls -1t "$OUT_DIR"/*-"$suffix".sql 2>/dev/null | tail -n +$((KEEP + 1)) || true)
  for f in "${old[@]:-}"; do
    [[ -n "$f" ]] && rm -f "$f" && echo "  pruned $(basename "$f")"
  done
done
