# syntax=docker/dockerfile:1
#
# Single application image: Express serves the API at /api and the built React bundle at /,
# in one process. Postgres is a separate container (see compose.yaml).
#
# Pinned to linux/amd64. Host builds are now possible (phase 1 removed the platform
# overrides), but pinning keeps image builds byte-identical regardless of who builds them.
#
# bookworm-slim, NOT alpine: pdf-parse -> pdfjs-dist -> optional native @napi-rs/canvas.
# glibc avoids musl build variance on that dependency chain.

# ---------------------------------------------------------------------------
FROM --platform=linux/amd64 node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# Pinned rather than corepack-latest: the lockfile is pnpm 10, and corepack's bundled
# signing keys are stale on some Node builds.
RUN npm install -g pnpm@10 --no-fund --no-audit
WORKDIR /app

# ---------------------------------------------------------------------------
# Full install (dev deps included — the build needs esbuild, vite, tsc).
FROM base AS build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json tsconfig.json ./
COPY scripts/enforce-pnpm.mjs ./scripts/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/db/package.json ./lib/db/
COPY lib/openai/package.json ./lib/openai/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/meal-planner/package.json ./artifacts/meal-planner/
COPY scripts/package.json ./scripts/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# ---------------------------------------------------------------------------
# Production dependency tree, resolved separately so dev deps never reach the runtime image.
FROM base AS prod-deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY scripts/enforce-pnpm.mjs ./scripts/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/db/package.json ./lib/db/
COPY lib/openai/package.json ./lib/openai/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/meal-planner/package.json ./artifacts/meal-planner/
COPY scripts/package.json ./scripts/
RUN pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
FROM --platform=linux/amd64 node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    MIGRATIONS_DIR=/app/lib/db/drizzle \
    STATIC_DIR=/app/artifacts/meal-planner/dist/public
WORKDIR /app

# The server bundle cannot ship alone. build.mjs deliberately externalizes pdf-parse and
# pdfjs-dist (bundling them crashes with "DOMMatrix is not defined"), so those must exist as
# real node_modules at runtime. pnpm's tree is symlinks into node_modules/.pnpm, so both the
# root store and the package-level link farm have to come across for resolution to work.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules

# Whole dist directory, not just index.mjs: esbuild-plugin-pino emits separate transport
# files (pino-worker.mjs, pino-file.mjs, thread-stream-worker.mjs) loaded at runtime.
COPY --from=build --chown=node:node /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=build --chown=node:node /app/artifacts/meal-planner/dist/public ./artifacts/meal-planner/dist/public

# Migration SQL is read from disk at boot; esbuild does not bundle .sql.
COPY --from=build --chown=node:node /app/lib/db/drizzle ./lib/db/drizzle

USER node
EXPOSE 3000

# Node 24 has global fetch, so no curl needed in the image.
# start-period covers migrations running before the server listens.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
