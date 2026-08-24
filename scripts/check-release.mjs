#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryDirectory = resolve(dirname(scriptPath), "..");

export function versionFromReleaseTag(tag) {
  const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
  if (match?.[1] === undefined) {
    throw new Error(`Release tag must be v<semver>; received ${JSON.stringify(tag)}.`);
  }
  return match[1];
}

export function assertReleaseTag(tag, packageVersion) {
  const tagVersion = versionFromReleaseTag(tag);
  if (tagVersion !== packageVersion) {
    throw new Error(`Release tag ${tag} does not match gitmog@${packageVersion}.`);
  }
  return tagVersion;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  const tag = process.argv[2] ?? "";
  const manifest = JSON.parse(
    readFileSync(resolve(repositoryDirectory, "packages/distribution/package.json"), "utf8"),
  );
  const version = assertReleaseTag(tag, manifest.version);
  console.log(`Release tag verified: gitmog@${version}`);
}
