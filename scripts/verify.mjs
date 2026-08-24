#!/usr/bin/env node
// Keep the merge gate runnable when pnpm itself is not on PATH. Every phase is
// dispatched through the pinned workspace-local pnpm JavaScript entry point.
import { fail, heading, step } from "./lib/log.mjs";
import {
  describeNodeCliFailure,
  resolveWorkspacePnpmCli,
  runNodeCliInherit,
} from "./lib/package-manager.mjs";

let pnpmCli;
try {
  pnpmCli = resolveWorkspacePnpmCli();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

heading("Git Mog public verify");
for (const script of ["format:check", "lint", "typecheck", "test", "build", "package:acceptance"]) {
  step(`pnpm run ${script}`);
  const result = runNodeCliInherit("pnpm", pnpmCli, ["run", script]);
  if (result.code !== 0) {
    fail(`${script} failed. ${describeNodeCliFailure("pnpm", pnpmCli, result)}`);
    process.exit(result.code);
  }
}

heading("Verification complete.");
