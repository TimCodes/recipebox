import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { logger } from "./lib/logger";

/**
 * Serves the built frontend alongside the API, replacing what Replit's
 * `router = "application"` used to do.
 *
 * Only used in production/container mode. In development the Vite dev server owns `/` and
 * proxies `/api` here, so there is no build output to serve and this is a no-op.
 */

/** Vite writes to `artifacts/meal-planner/dist/public`; the bundled server runs from `artifacts/api-server/dist`. */
const DEFAULT_STATIC_DIR = fileURLToPath(
  new URL("../../meal-planner/dist/public", import.meta.url),
);

export function resolveStaticDir(): string {
  return process.env["STATIC_DIR"] ?? DEFAULT_STATIC_DIR;
}

export function mountStatic(app: Express): void {
  const staticDir = resolveStaticDir();

  if (!existsSync(staticDir)) {
    logger.info({ staticDir }, "No frontend build found — serving API only");
    return;
  }

  const indexHtml = path.join(staticDir, "index.html");

  // Vite content-hashes everything under /assets, so those filenames change whenever their
  // contents do and can be cached indefinitely.
  app.use(
    "/assets",
    express.static(path.join(staticDir, "assets"), {
      immutable: true,
      maxAge: "1y",
      index: false,
    }),
  );

  // Everything else in the build (favicon, robots.txt, seeded recipe images). Not hashed, so
  // it gets revalidated rather than cached hard.
  app.use(
    express.static(staticDir, {
      index: false,
      maxAge: "1h",
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html")) res.set("Cache-Control", "no-cache");
      },
    }),
  );

  // SPA fallback. wouter routes like /recipes/12 and /grocery-list exist only client-side, so
  // a hard refresh or a pasted deep link must still return index.html.
  //
  // Written as a bare middleware rather than app.get("*") deliberately: Express 5 uses
  // path-to-regexp v8, which rejects a bare "*" as a path.
  //
  // /api is excluded so an unmatched API route still 404s as JSON instead of being handed an
  // HTML document — otherwise a typo'd endpoint returns 200 text/html and the client fails
  // somewhere far less obvious.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();
    res.set("Cache-Control", "no-cache");
    res.sendFile(indexHtml);
  });

  logger.info({ staticDir }, "Serving frontend build");
}
