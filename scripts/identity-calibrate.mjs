import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { captureNodeCli, resolveWorkspacePnpmCli } from "./lib/package-manager.mjs";

let pnpmCli;
try {
  pnpmCli = resolveWorkspacePnpmCli();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}

if (pnpmCli !== undefined) {
  const result = captureNodeCli(
    "pnpm",
    pnpmCli,
    ["--filter", "@gitmog/scoring", "exec", "vitest", "run", "tests/identity-calibration.test.ts"],
    {
      cwd: process.cwd(),
      env: { ...process.env, GITMOG_IDENTITY_REPORT: "1" },
      encoding: "utf8",
    },
  );
  if (result.code !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    process.exitCode = result.code;
  } else {
    process.stdout.write(
      readFileSync(resolve("docs/calibration/identity-calibration.txt"), "utf8"),
    );
  }
}
