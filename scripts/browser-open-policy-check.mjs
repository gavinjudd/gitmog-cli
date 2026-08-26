#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertBrowserOpenBundlePolicy } from "../packages/distribution/browser-open-policy.mjs";
import { assertBrowserOpenSourcePolicy } from "./lib/browser-open-policy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
assertBrowserOpenSourcePolicy(root);

const bundleFlag = process.argv.indexOf("--bundle");
if (bundleFlag >= 0) {
  const bundlePath = process.argv[bundleFlag + 1];
  if (bundlePath === undefined) throw new Error("--bundle requires a packed bundle path.");
  assertBrowserOpenBundlePolicy(readFileSync(resolve(bundlePath), "utf8"));
}

process.stdout.write(
  "Browser-open policy complete (one spawn-only module; three closed GitHub destinations; no shell, exec, token, code, handle, or repository argument path).\n",
);
