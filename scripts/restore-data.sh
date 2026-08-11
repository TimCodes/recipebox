#!/usr/bin/env bash
# Restores a data-only dump into the local (migrated) database.
#
#   ./scripts/restore-data.sh backups/replit-20260811-data.sql
#
# The target must already have its schema — i.e. migrations have run. That is the whole point
# of using a data-only dump: a database created by the old `drizzle-kit push` path has no
# __drizzle_migrations journal, so restoring a full schema+data dump would leave a database
# that migration 0000 then fails against ("table already exists").
#
# Foreign keys are suppressed for the duration of the load. pg_dump --data-only emits tables
# in alphabetical order, so meal_plan_entries arrives before the recipes rows it references;
# session_replication_role = replica sidesteps the ordering problem entirely rather than
# depending on dump order. The sequence setval statements at the end of the dump are what
# stop freshly inserted rows from colliding with restored ids.
set -euo pipefail

cd "$(dirname "$0")/.."

DUMP="${1:?usage: restore-data.sh <path-to-data-only-dump.sql>}"
DB_USER="${POSTGRES_USER:-recipebox}"
DB_NAME="${POSTGRES_DB:-recipebox}"

[[ -f "$DUMP" ]] || { echo "No such dump: $DUMP" >&2; exit 1; }

# The db container is named differently depending on which stack is up: compose.yaml gives it
# the generated name (recipebox-db-1), compose.dev.yaml pins it to recipebox-postgres. Resolve
# it rather than assuming, so a restore does not fail at the worst possible moment.
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
  exit 1
fi

# A data-only restore assumes an empty target: the dump carries explicit primary keys, so
# restoring over existing rows collides on *_pkey. Check up front and say so plainly, rather
# than letting psql emit a duplicate-key error that reads like a corrupt dump.
EXISTING="$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atc \
  "select coalesce((select count(*) from recipes),0)
        + coalesce((select count(*) from meal_plan_entries),0)
        + coalesce((select count(*) from grocery_list_items),0);" 2>/dev/null || echo 0)"

if [[ "${EXISTING:-0}" -gt 0 ]]; then
  if [[ "${FORCE:-0}" != "1" ]]; then
    echo "Target already holds $EXISTING row(s). A data-only restore needs an empty database." >&2
    echo "Either recreate the volume (docker compose down -v && docker compose up -d)," >&2
    echo "or re-run with FORCE=1 to TRUNCATE the three tables first." >&2
    exit 1
  fi
  echo "FORCE=1 — truncating $EXISTING existing row(s) first."
  docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -q -c \
    "truncate grocery_list_items, meal_plan_entries, recipes restart identity cascade;"
fi

echo "Restoring $DUMP into $CONTAINER/$DB_NAME ..."

# Strip any drizzle.__drizzle_migrations COPY block. Dumps taken before the
# --exclude-schema=drizzle fix contain the migration journal, whose rows already exist in a
# migrated target; the duplicate key aborts the transaction and rolls back the entire restore,
# so you end up with nothing while the command looks like it merely warned.
strip_migrations() {
  awk '
    /^COPY drizzle\.__drizzle_migrations/ { skipping = 1; next }
    skipping && /^\\\.$/                  { skipping = 0; next }
    !skipping                             { print }
  ' "$1"
}

{
  echo "BEGIN;"
  echo "SET session_replication_role = replica;"
  strip_migrations "$DUMP"
  echo "SET session_replication_role = DEFAULT;"
  echo "COMMIT;"
} | docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -q

echo "Row counts after restore:"
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atc "
  select '  recipes:            ' || count(*) from recipes
  union all select '  meal_plan_entries:  ' || count(*) from meal_plan_entries
  union all select '  grocery_list_items: ' || count(*) from grocery_list_items;"
