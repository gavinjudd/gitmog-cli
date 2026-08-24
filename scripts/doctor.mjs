#!/usr/bin/env node
import { existsSync, statfsSync } from "node:fs";
import { arch, platform, release } from "node:os";

import { capture } from "./lib/exec.mjs";
import { checkLine, heading, info, style } from "./lib/log.mjs";
import { nodeCliVersion } from "./lib/package-manager.mjs";
import { paths } from "./lib/paths.mjs";
import { pinnedPnpmVersion, readNodeVersion, readRootPackageJson } from "./lib/versions.mjs";

const HELP = `gitmog public-upstream doctor

  pnpm run doctor [--json] [--help]

Reports the public contributor toolchain without reading environment values.
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const checks = [];
const add = (status, label, detail, remedy) => checks.push({ status, label, detail, remedy });
add("INFO", "Platform", `${platform()} ${release()} ${arch()}`);

const expectedNode = readNodeVersion();
add(
  process.versions.node === expectedNode ? "PASS" : "FAIL",
  "Node version",
  `expected ${expectedNode}, found ${process.versions.node}`,
  `Activate Node ${expectedNode}; .node-version is authoritative.`,
);

const expectedPnpm = pinnedPnpmVersion();
const actualPnpm = existsSync(paths.toolingPnpmCli)
  ? nodeCliVersion("pnpm", paths.toolingPnpmCli)
  : undefined;
add(
  actualPnpm === expectedPnpm ? "PASS" : "FAIL",
  "pnpm version",
  `expected ${expectedPnpm}, found ${actualPnpm ?? "none"}`,
  "Run node scripts/bootstrap.mjs.",
);

const git = capture("git", ["--version"]);
add(git.code === 0 ? "PASS" : "FAIL", "Git available", git.stdout, "Install Git.");
add(
  existsSync(paths.lockfile) ? "PASS" : "FAIL",
  "Frozen lockfile",
  existsSync(paths.lockfile) ? "present" : "missing",
  "Run bootstrap without --ci once and commit the reviewed lockfile.",
);
add(
  existsSync(paths.nodeModules) ? "PASS" : "FAIL",
  "Dependencies installed",
  existsSync(paths.nodeModules) ? "present" : "missing",
  "Run node scripts/bootstrap.mjs.",
);

const rootManifest = readRootPackageJson();
add(
  rootManifest.repository?.url === "https://github.com/gavinjudd/gitmog-cli.git" ? "PASS" : "FAIL",
  "Public upstream metadata",
  "gavinjudd/gitmog-cli",
  "Restore the authoritative public repository URL.",
);

try {
  const disk = statfsSync(paths.root);
  const freeGb = (disk.bavail * disk.bsize) / 1024 ** 3;
  add(freeGb < 2 ? "WARN" : "INFO", "Free disk space", `${freeGb.toFixed(1)} GB`);
} catch {
  add("INFO", "Free disk space", "unavailable");
}

const failures = checks.filter((check) => check.status === "FAIL");
if (args.includes("--json")) {
  console.log(
    JSON.stringify(
      { ok: failures.length === 0, checks: checks.map(({ remedy: _remedy, ...check }) => check) },
      null,
      2,
    ),
  );
} else {
  heading("Git Mog public-upstream doctor");
  for (const check of checks) checkLine(check.status, check.label, check.detail);
  if (failures.length > 0) {
    heading("Remedies");
    for (const failure of failures) {
      info(`${style.red("✖")} ${failure.label}`);
      if (failure.remedy) info(`  ${failure.remedy}`);
    }
  }
}

process.exit(failures.length === 0 ? 0 : 1);
