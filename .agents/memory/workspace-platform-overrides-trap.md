---
name: Workspace config can silently make a repo unbuildable off one OS
description: pnpm overrides that null out non-host platform binaries look like a harmless size optimisation but block every other developer machine.
---

`pnpm-workspace.yaml` in this repo carried ~90 `overrides` entries setting every non-`linux-x64`
platform binary to `"-"` for esbuild, rollup, lightningcss, `@tailwindcss/oxide` and
`@expo/ngrok-bin`, commented *"replit uses linux-x64 only, we can exclude all other platforms."*

The effect is that `pnpm install && pnpm run build` cannot work on Windows or Apple silicon:
the platform binary the host actually needs has been deleted from resolution. The failure looks
like a broken toolchain — a missing esbuild binary — not like a config decision made on purpose
somewhere else in the repo.

**Why:** this is the kind of setting a hosted platform adds to shrink images, where it is
correct because only one architecture ever runs. It becomes a hard blocker the moment anyone
develops locally, and nothing about the error message points at `pnpm-workspace.yaml`. It also
hides: the repo looks fine until someone tries a host build.

**How to apply:** when a project "can only be built in <hosted environment>", check the package
manager config for platform exclusions before assuming the toolchain or the OS is at fault. When
removing them, keep genuinely unrelated overrides (security pins, transitive-dependency aliases)
and re-run the full typecheck plus build. Removing the exclusions regenerated the lockfile here
with **no dependency version changes at all** — the entire diff was re-added platform binaries,
so the change is far lower risk than a large lockfile diff suggests. If deterministic image
builds are also wanted, pin the platform in the Dockerfile (`FROM --platform=linux/amd64`)
rather than by deleting binaries from the dependency tree.
