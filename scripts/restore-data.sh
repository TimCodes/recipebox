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
CONTAINER="${PG_CONTAINER:-recipebox-postgres}"
DB_USER="${POSTGRES_USER:-recipebox}"
DB_NAME="${POSTGRES_DB:-recipebox}"

[[ -f "$DUMP" ]] || { echo "No such dump: $DUMP" >&2; exit 1; }

echo "Restoring $DUMP into $CONTAINER/$DB_NAME ..."

{
  echo "BEGIN;"
  echo "SET session_replication_role = replica;"
  cat "$DUMP"
  echo "SET session_replication_role = DEFAULT;"
  echo "COMMIT;"
} | docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -q

echo "Row counts after restore:"
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atc "
  select '  recipes:            ' || count(*) from recipes
  union all select '  meal_plan_entries:  ' || count(*) from meal_plan_entries
  union all select '  grocery_list_items: ' || count(*) from grocery_list_items;"
