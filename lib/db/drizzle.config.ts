import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Must stay a forward-slash relative path (resolved against this package's directory).
  // path.join(__dirname, ...) yields backslashes on Windows, which drizzle-kit's schema
  // glob silently fails to match — "No schema files found for path config".
  schema: "./src/schema/index.ts",
  // Generated migration SQL lives here and is committed. It is the versioned record of the
  // schema — `push` is dev-only convenience, migrations are what actually run everywhere else.
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
