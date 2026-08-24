#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tarballArgument = process.argv[2];
const reportArgument = process.argv[3];
if (tarballArgument === undefined || reportArgument === undefined) {
  throw new Error("Usage: ci-accept-artifact.mjs <tarball> <report.json>");
}

const stdout = execFileSync(
  process.execPath,
  [
    resolve(root, "scripts", "accept-platform.mjs"),
    "--tarball",
    resolve(tarballArgument),
    "--fixture-network",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      GITHUB_TOKEN: "",
      GH_TOKEN: "",
      NODE_AUTH_TOKEN: "",
      NPM_TOKEN: "",
      NO_COLOR: "1",
    },
    encoding: "utf8",
    maxBuffer: 48 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  },
);
const report = JSON.parse(stdout);
writeFileSync(resolve(reportArgument), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
  `Accepted ${String(report.tarball?.name)} on ${String(report.platform)} with ${String(report.checks?.length ?? 0)} checks.\n`,
);
