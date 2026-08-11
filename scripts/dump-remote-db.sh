#!/usr/bin/env bash
# Dumps a remote Postgres (e.g. the old Replit database) to backups/.
#
#   SOURCE_DATABASE_URL=postgres://... ./scripts/dump-remote-db.sh [label]
#
# Reads the URL from the environment, or from SOURCE_DATABASE_URL in .env. The URL is passed
# to the container through the environment, never as a command argument, so it does not land
# in shell history or a process listing.
#
# There is no pg_dump on the host, so this runs the client from the postgres:17 image.
#
# NOTE: this only works for an externally reachable database. Replit's built-in Postgres is
# addressed as `helium/heliumdb`, an internal hostname that resolves only inside the Repl's
# own network — it cannot be reached from a developer machine. For that database the dump has
# to be taken from inside the Repl shell instead:
#
#   pg_dump "$DATABASE_URL" --no-owner --no-privileges --data-only > kitchen-notebook-data.sql
#
# then download the file and hand it to scripts/restore-data.sh.
#
# Produces two files:
#   <label>-full.sql  schema + data. Archival copy — restore this into an EMPTY database if
#                     you ever need the original exactly as it was.
#   <label>-data.sql  data only. This is the one to restore into a migrated database, because
#                     migration 0000 already creates the schema (see CLAUDE.md, "Baselining
#                     an existing database").
set -euo pipefail

cd "$(dirname "$0")/.."

LABEL="${1:-replit-$(date +%Y%m%d-%H%M%S)}"
IMAGE="postgres:17-bookworm"
OUT_DIR="backups"

if [[ -z "${SOURCE_DATABASE_URL:-}" && -f .env ]]; then
  SOURCE_DATABASE_URL="$(sed -n 's/^SOURCE_DATABASE_URL=//p' .env | head -1)"
fi

if [[ -z "${SOURCE_DATABASE_URL:-}" ]]; then
  echo "SOURCE_DATABASE_URL is not set (env or .env). Nothing to dump." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "Testing connection..."
if ! docker run --rm -e PGURL="$SOURCE_DATABASE_URL" "$IMAGE" \
     psql "\$PGURL" -Atc 'select 1' >/dev/null 2>&1; then
  # Retry with the URL expanded inside the container shell, so special characters in the
  # password are not mangled by the outer shell.
  docker run --rm -e PGURL="$SOURCE_DATABASE_URL" "$IMAGE" \
    sh -c 'psql "$PGURL" -Atc "select 1"' >/dev/null
fi
echo "  connected."

echo "Row counts at source:"
docker run --rm -e PGURL="$SOURCE_DATABASE_URL" "$IMAGE" sh -c '
  psql "$PGURL" -Atc "
    select ''  recipes:            '' || count(*) from recipes
    union all select ''  meal_plan_entries:  '' || count(*) from meal_plan_entries
    union all select ''  grocery_list_items: '' || count(*) from grocery_list_items;"'

echo "Dumping schema + data -> $OUT_DIR/$LABEL-full.sql"
docker run --rm -e PGURL="$SOURCE_DATABASE_URL" "$IMAGE" \
  sh -c 'pg_dump "$PGURL" --no-owner --no-privileges' > "$OUT_DIR/$LABEL-full.sql"

echo "Dumping data only      -> $OUT_DIR/$LABEL-data.sql"
docker run --rm -e PGURL="$SOURCE_DATABASE_URL" "$IMAGE" \
  sh -c 'pg_dump "$PGURL" --no-owner --no-privileges --data-only' > "$OUT_DIR/$LABEL-data.sql"

echo
echo "Done:"
ls -lh "$OUT_DIR/$LABEL-full.sql" "$OUT_DIR/$LABEL-data.sql" | awk '{print "  " $5 "\t" $9}'
