---
name: pdf-parse esbuild bundling breaks at runtime
description: pdf-parse (wraps pdfjs-dist) must be externalized in esbuild server bundles or it crashes with "DOMMatrix is not defined" in Node.
---

`pdf-parse` v2 wraps `pdfjs-dist`, which expects browser canvas globals (`DOMMatrix`, `ImageData`, `Path2D`) normally polyfilled via the optional native `@napi-rs/canvas` dependency. When an esbuild single-file bundle (e.g. an API server's `build.mjs`) tries to bundle `pdf-parse`/`pdfjs-dist` directly instead of leaving them as real `node_modules` imports, the native `@napi-rs/canvas` resolution breaks and the polyfill silently no-ops — the process then crashes at import time with `ReferenceError: DOMMatrix is not defined`, even for plain text extraction that never touches canvas/image features.

**Why:** esbuild bundling defeats pdfjs-dist's own runtime environment detection and native-module loading path.

**How to apply:** add `pdf-parse`, `pdfjs-dist`, and `@napi-rs/canvas` to the esbuild `external` list for any server that bundles with esbuild (see `external: [...]` array in an artifact's `build.mjs`) before using `pdf-parse` for PDF text extraction.

**Container corollary (verified 2026-08-11):** because these packages are externalized rather
than bundled, they must exist as *real* `node_modules` in the runtime image. A Docker image
that copies only `dist/index.mjs` will fail at import. With pnpm this means copying both the
root `node_modules` (which holds the real packages under `.pnpm`) and the consuming package's
own `node_modules` link farm, since pnpm's tree is symlinks. Confirmed working: a full
cookbook PDF ingested inside the container with no `DOMMatrix` error.
