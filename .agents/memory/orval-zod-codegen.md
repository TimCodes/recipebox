---
name: Orval zod codegen with catalog: versions
description: Orval's automatic zod-version detection can misfire when a package.json dependency uses a pnpm catalog reference, producing invalid zod syntax against the installed zod version.
---

Orval's zod-client output auto-detects whether to emit zod v3 or v4 syntax by
inspecting the installed zod version. If the package that declares the `zod`
dependency uses a pnpm catalog reference (e.g. `"zod": "catalog:"`) instead of
a concrete semver string, that auto-detection can misfire and emit v4-only
syntax (e.g. `zod.int()`) even though the installed zod is v3.

**Why:** the version string Orval reads for detection isn't a parseable
semver when it's a catalog reference, so its heuristic falls through to the
wrong branch.

**How to apply:** if a monorepo's generated Zod client fails to build or
produces syntax errors after `orval` codegen, and the zod-consuming package
uses `"zod": "catalog:"`, add an explicit `override.zod.version: 3` (or
whatever the actual installed major version is) in the `orval.config.ts`
`zod` client config, rather than relying on auto-detection. Re-run codegen
after the change.
