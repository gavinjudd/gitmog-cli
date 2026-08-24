#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runInherit } from "./lib/exec.mjs";
import { captureNodeCli, resolveNpmEntrypoints } from "./lib/package-manager.mjs";
import {
  buildExternalTarball,
  packageAcceptanceEnvironment,
  repositoryPackageHygieneFindings,
  withPackageAcceptanceScratch,
} from "./lib/package-acceptance.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDirectory = resolve(root, "packages", "distribution");

const initialFindings = repositoryPackageHygieneFindings(root);
if (initialFindings.length > 0) {
  throw new Error(`Repository-local package state exists: ${initialFindings.join(", ")}`);
}

await withPackageAcceptanceScratch(root, async (context) => {
  const { npmCli } = resolveNpmEntrypoints();
  const environment = packageAcceptanceEnvironment(
    { ...process.env, GITHUB_TOKEN: "", NO_COLOR: "1" },
    context.npmCache,
    context.gitmogCache,
  );
  const runCli = (entrypoint, args, options) => {
    const result = captureNodeCli("npm", entrypoint, args, options);
    if (result.code !== 0) {
      throw new Error(
        `npm ${args.join(" ")} failed with ${String(result.code)}.\n${result.stderr}`,
      );
    }
    return result;
  };
  const artifact = buildExternalTarball({
    npmCli,
    packageDirectory,
    context,
    environment,
    runCli,
  });
  const accepted = runInherit(
    process.execPath,
    [
      resolve(root, "scripts", "accept-platform.mjs"),
      "--tarball",
      artifact.tarball,
      "--fixture-network",
    ],
    { cwd: root, env: environment },
  );
  if (accepted.code !== 0)
    throw new Error(`Packed acceptance failed with ${String(accepted.code)}.`);
});

const finalFindings = repositoryPackageHygieneFindings(root);
if (finalFindings.length > 0) {
  throw new Error(`Package acceptance left repository-local state: ${finalFindings.join(", ")}`);
}
