#!/usr/bin/env node
// Turborepo resolves the declared package manager by name when it launches a
// workspace task. Keep that lookup inside the repository-owned tooling prefix
// while invoking both Turbo and pnpm themselves through fixed JavaScript CLIs.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { prependPath } from "./lib/exec.mjs";
import {
  describeNodeCliFailure,
  resolveWorkspacePnpmCli,
  runNodeCliInherit,
} from "./lib/package-manager.mjs";
import { paths } from "./lib/paths.mjs";

try {
  resolveWorkspacePnpmCli();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

const turboCli = join(paths.nodeModules, "turbo", "bin", "turbo");
if (!existsSync(turboCli)) {
  process.stderr.write(
    `Could not resolve turbo JavaScript CLI at ${turboCli} on ${process.platform}. ` +
      "Underlying error code: ENOENT. Run node scripts/bootstrap.mjs.\n",
  );
  process.exit(1);
}

const turboArguments = process.argv.slice(2);
if (turboArguments[0] === "run") {
  turboArguments.push(`--cache-dir=${join(paths.root, ".turbo", "cache")}`);
}

const result = runNodeCliInherit("turbo", turboCli, ["--cwd", paths.root, ...turboArguments], {
  env: prependPath(paths.toolingPnpmBinDir),
});
if (result.code !== 0) {
  process.stderr.write(`${describeNodeCliFailure("turbo", turboCli, result)}\n`);
}
process.exit(result.code);
