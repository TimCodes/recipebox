import { fileURLToPath } from "node:url";
import { runMigrations } from "@workspace/db/migrate";
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"] ?? "3000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Committed migration SQL lives in `lib/db/drizzle`. The bundled server runs from
 * `artifacts/api-server/dist/index.mjs`, so the default walks back up to the repo root.
 * In a container the tree is laid out differently — set MIGRATIONS_DIR explicitly there.
 */
const migrationsDir =
  process.env["MIGRATIONS_DIR"] ??
  fileURLToPath(new URL("../../../lib/db/drizzle", import.meta.url));

async function main(): Promise<void> {
  logger.info({ migrationsDir }, "Applying database migrations");
  await runMigrations(migrationsDir);
  logger.info("Migrations up to date");

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

main().catch((err) => {
  // Boot with an out-of-date or unreachable database is never recoverable — fail loudly
  // rather than serving requests against a schema that doesn't match the code.
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
