import { readFileSync } from "node:fs";

import { paths } from "./paths.mjs";

export function readNodeVersion() {
  return readFileSync(paths.nodeVersionFile, "utf8").trim();
}

export function readRootPackageJson() {
  return JSON.parse(readFileSync(paths.packageJson, "utf8"));
}

export function pinnedPnpmVersion() {
  const declared = readRootPackageJson().packageManager;
  if (typeof declared !== "string" || !declared.startsWith("pnpm@")) {
    throw new Error('Root package.json must declare "packageManager": "pnpm@<version>".');
  }
  return declared.slice("pnpm@".length);
}

export function declaredServiceMajors() {
  const services = readRootPackageJson().gitmog?.services ?? {};
  return {
    postgres: services.postgres?.major,
    redis: services.redis?.major,
  };
}

/** Reads the concrete image tags out of compose.yaml so doctor can detect drift
 * between the declared majors and the artifact that actually runs. */
export function composeImageMajors() {
  const text = readFileSync(paths.compose, "utf8");
  const read = (image) => {
    const match = new RegExp(`image:\\s*${image}:(\\d+)`).exec(text);
    return match === null ? undefined : Number(match[1]);
  };
  return { postgres: read("postgres"), redis: read("redis") };
}

export function majorOf(version) {
  const match = /(\d+)/.exec(version ?? "");
  return match === null ? undefined : Number(match[1]);
}
