// Cross-platform replacement for the original `sh -c '...'` preinstall guard, which
// could not run on Windows (no `sh` on PATH when pnpm shells out via cmd.exe).
// Same two jobs: drop stray lockfiles from other package managers, and refuse to
// install under anything but pnpm.
import { rmSync } from "node:fs";

for (const stray of ["package-lock.json", "yarn.lock"]) {
  rmSync(stray, { force: true });
}

if (!/^pnpm\//.test(process.env.npm_config_user_agent ?? "")) {
  console.error("Use pnpm instead");
  process.exit(1);
}
