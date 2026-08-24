#!/usr/bin/env node
// Zero-dependency entry point. Runs with no pnpm and no node_modules, using only
// Node built-ins and the npm bundled with the pinned Node runtime.
import { existsSync, mkdirSync } from "node:fs";

import { fail, heading, info, ok, step, style, warn } from "./lib/log.mjs";
import {
  describeNodeCliFailure,
  formatWorkspaceBinPathInstruction,
  nodeCliVersion,
  pnpmToolingLayout,
  resetPnpmToolingDirectory,
  resolveNpmCli,
  runNodeCliInherit,
  workspaceInstallEnvironment,
} from "./lib/package-manager.mjs";
import { paths } from "./lib/paths.mjs";
import { pinnedPnpmVersion, readNodeVersion } from "./lib/versions.mjs";

const HELP = `gitmog bootstrap

  node scripts/bootstrap.mjs [--ci] [--help]

Prepares a clean checkout: verifies the pinned Node runtime, installs the pinned
pnpm into .gitmog/tooling/pnpm when it is not already available, and installs
workspace dependencies without running dependency lifecycle scripts.

  --ci    Non-interactive. Requires a committed lockfile.
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
const ci = args.includes("--ci") || process.env.CI === "true" || process.env.CI === "1";

function die(message, remedy) {
  fail(message);
  if (remedy !== undefined) info(`  ${remedy}`);
  process.exit(1);
}

heading("Gitmog bootstrap");

// 1. Runtime.
const expectedNode = readNodeVersion();
if (process.versions.node !== expectedNode) {
  die(
    `Node ${expectedNode} is required, found ${process.versions.node}.`,
    `.node-version pins the runtime. With nvm: nvm install ${expectedNode} && nvm use. With fnm: fnm use --install-if-missing.`,
  );
}
ok(`Node ${expectedNode}`);

// 2. Package manager.
const pinnedPnpm = pinnedPnpmVersion();
const pnpmCli = paths.toolingPnpmCli;
if (existsSync(pnpmCli) && nodeCliVersion("pnpm", pnpmCli) === pinnedPnpm) {
  ok(`pnpm ${pinnedPnpm} (workspace-local)`);
} else {
  step(`Installing pnpm ${pinnedPnpm} into ${style.dim(".gitmog/tooling/pnpm")}`);
  let npmCli;
  try {
    npmCli = resolveNpmCli();
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }
  const npmVersion = nodeCliVersion("npm", npmCli);
  if (npmVersion === undefined) {
    const result = runNodeCliInherit("npm", npmCli, ["--version"]);
    die(
      describeNodeCliFailure("npm", npmCli, result),
      "Activate the pinned Node distribution with bundled npm; do not install pnpm globally.",
    );
  }

  const layout = pnpmToolingLayout();
  if (layout === "legacy") info("  Replacing the previous POSIX pnpm tooling layout.");
  else if (layout === "partial") info("  Replacing incomplete pnpm tooling state.");
  resetPnpmToolingDirectory();
  mkdirSync(paths.toolingDir, { recursive: true });
  const install = runNodeCliInherit("npm", npmCli, [
    "install",
    "--prefix",
    paths.toolingDir,
    "--no-save",
    "--no-package-lock",
    "--ignore-scripts",
    `pnpm@${pinnedPnpm}`,
    "--no-fund",
    "--no-audit",
    "--loglevel=error",
  ]);
  if (install.code !== 0) {
    die(
      `Could not install pnpm ${pinnedPnpm}. ${describeNodeCliFailure("npm", npmCli, install)}`,
      "Check network access to the npm registry, then re-run node scripts/bootstrap.mjs.",
    );
  }
  const installedPnpm = nodeCliVersion("pnpm", pnpmCli);
  if (installedPnpm !== pinnedPnpm) {
    die(
      `Installed pnpm validation failed through ${pnpmCli} on ${process.platform}: expected ${pinnedPnpm}, found ${installedPnpm ?? "no version"}.`,
      "Remove only .gitmog/tooling/pnpm, then re-run node scripts/bootstrap.mjs.",
    );
  }
  ok(`pnpm ${pinnedPnpm} installed`);
}

// 3. Dependencies.
const hasLockfile = existsSync(paths.lockfile);
if (ci && !hasLockfile) {
  die("--ci requires a committed pnpm-lock.yaml.", "Run node scripts/bootstrap.mjs without --ci.");
}
step(hasLockfile ? "pnpm install --frozen-lockfile" : "pnpm install (creating a lockfile)");
const install = runNodeCliInherit(
  "pnpm",
  pnpmCli,
  hasLockfile
    ? ["install", "--frozen-lockfile", "--ignore-scripts"]
    : ["install", "--ignore-scripts"],
  { env: workspaceInstallEnvironment(ci) },
);
if (install.code !== 0) {
  die(
    `Dependency installation failed. ${describeNodeCliFailure("pnpm", pnpmCli, install)}`,
    "If pnpm reported blocked dependency build scripts, review each package and add it to allowBuilds in pnpm-workspace.yaml with a rationale in docs/decisions/0001-public-upstream-and-toolchain.md.",
  );
}
if (!hasLockfile) warn("pnpm-lock.yaml was created. Review it before committing.");
ok("Dependencies installed");

heading("Next steps");
info(`  ${formatWorkspaceBinPathInstruction()}`);
// pnpm 11 has a built-in `doctor`, so the repository's own check needs `pnpm run`.
info("  pnpm run doctor");
info("  pnpm verify");
