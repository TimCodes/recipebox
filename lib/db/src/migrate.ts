import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./index";

/**
 * Applies any pending migrations from `migrationsFolder` (the committed `lib/db/drizzle`
 * directory). Drizzle tracks what has already run in its own `__drizzle_migrations` table
 * and takes a lock while applying, so this is safe to call unconditionally on every boot.
 *
 * This replaces `drizzle-kit push`, which diffs the schema against a live database and
 * applies the result directly — fine against a throwaway dev DB, a data-loss hazard against
 * a volume holding real recipes.
 */
export async function runMigrations(migrationsFolder: string): Promise<void> {
  await migrate(db, { migrationsFolder });
}
