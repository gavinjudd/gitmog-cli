#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path, label) => {
  if (!existsSync(path)) throw new Error(`${label} is missing.`);
  return readFileSync(path, "utf8");
};
const parse = (path, label) => {
  try {
    return JSON.parse(read(path, label));
  } catch {
    throw new Error(`${label} is missing or malformed.`);
  }
};
const exactKeys = (value, expected) => {
  const actual = Object.keys(value).toSorted();
  const sortedExpected = [...expected].toSorted();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};
const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["coverage", "dist", "node_modules"].includes(entry.name)) return [];
    const path = resolve(entry.parentPath, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

const configPath = resolve(root, "config/private-context-app.json");
const config = parse(configPath, "Private Context app configuration");
if (
  typeof config !== "object" ||
  config === null ||
  Array.isArray(config) ||
  !exactKeys(config, [
    "appId",
    "clientId",
    "clientSecrets",
    "deviceFlow",
    "installationSelectionRequired",
    "name",
    "permissions",
    "privateKeys",
    "slug",
    "version",
  ]) ||
  config.version !== "1.0.0" ||
  !["Git Mog Private Context", "Git Mog Private Context CLI"].includes(config.name) ||
  !/^git-mog-private-context(?:-cli)?$/u.test(config.slug) ||
  !/^[1-9]\d{3,15}$/u.test(config.appId) ||
  !/^Iv[0-9A-Za-z]{18,126}$/u.test(config.clientId) ||
  config.deviceFlow !== true ||
  config.installationSelectionRequired !== "selected" ||
  config.privateKeys !== 0 ||
  config.clientSecrets !== 0 ||
  typeof config.permissions !== "object" ||
  config.permissions === null ||
  Array.isArray(config.permissions) ||
  !exactKeys(config.permissions, ["contents", "metadata"]) ||
  config.permissions.contents !== "read" ||
  config.permissions.metadata !== "read"
) {
  throw new Error("Private Context app configuration violates the minimum-permission contract.");
}
const bundledConfigSource = read(
  resolve(root, "packages/private-context/src/default-config.ts"),
  "Bundled Private Context app configuration",
);
for (const publicValue of [config.name, config.slug, config.appId, config.clientId]) {
  if (!bundledConfigSource.includes(JSON.stringify(publicValue))) {
    throw new Error("Bundled Private Context app configuration differs from the audited contract.");
  }
}
for (const invariant of [
  "deviceFlow: true",
  'metadata: "read"',
  'contents: "read"',
  'installationSelectionRequired: "selected"',
  "privateKeys: 0",
  "clientSecrets: 0",
]) {
  if (!bundledConfigSource.includes(invariant)) {
    throw new Error("Bundled Private Context app configuration omitted a required invariant.");
  }
}

const packageManifest = parse(
  resolve(root, "packages/private-context/package.json"),
  "Private Context package manifest",
);
if (
  packageManifest.private !== true ||
  !exactKeys(packageManifest.dependencies ?? {}, [
    "@gitmog/github",
    "@gitmog/quality-judge",
    "@gitmog/scoring",
  ]) ||
  Object.values(packageManifest.dependencies).some((value) => value !== "workspace:*")
) {
  throw new Error("Private Context must remain an internal workspace-only package.");
}

const sourceRoot = resolve(root, "packages/private-context/src");
const privateSource = walk(sourceRoot)
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
for (const forbidden of [
  "node:child_process",
  "node:fs",
  "node:sqlite",
  "process.env",
  "private_key",
  "client_secret",
  "webhook_secret",
]) {
  if (privateSource.toLowerCase().includes(forbidden)) {
    throw new Error(`Private Context source contains forbidden capability: ${forbidden}`);
  }
}
for (const required of [
  "PRIVATE_CONTEXT_MAX_REPOSITORIES = 5",
  "PRIVATE_CONTEXT_MAX_REQUESTS = 64",
  "PRIVATE_CONTEXT_MAX_REQUESTS_PER_REPOSITORY = 12",
  'PRIVATE_REST_ORIGIN = "https://api.github.com"',
  "privateRestRequestAllowed",
  'redirect: "error"',
  "scoreInfluence: 0",
  "publicWinnerInfluence: 0",
  "persisted: false",
]) {
  if (!privateSource.includes(required)) {
    throw new Error(`Private Context source omitted required invariant: ${required}`);
  }
}

for (const directory of ["packages/battle", "packages/scoring"]) {
  for (const path of walk(resolve(root, directory))) {
    const contents = readFileSync(path, "utf8");
    if (contents.includes("@gitmog/private-context") || contents.includes("privateContext")) {
      throw new Error(
        `Canonical public scoring imports Private Context through ${relative(root, path)}.`,
      );
    }
  }
}

const cliSource = read(resolve(root, "packages/cli/src/cli.ts"), "CLI source");
if (
  !/authorized\.lease\.use\(async \(token\) =>/u.test(cliSource) ||
  !cliSource.includes("privateRunner({") ||
  !cliSource.includes("private_context_conflicting_token_boundaries")
) {
  throw new Error("CLI token-boundary enforcement is missing.");
}

const decision = read(
  resolve(root, "docs/decisions/0003-private-context.md"),
  "Private Context architecture decision",
);
for (const statement of [
  "public-only",
  "selected repositories",
  "process-only",
  "scoreInfluence: 0",
  "public winner",
]) {
  if (!decision.toLowerCase().includes(statement.toLowerCase())) {
    throw new Error(`Private Context decision omitted: ${statement}`);
  }
}

console.log(
  `Private Context policy complete (${config.slug}; metadata read; contents read; selected repositories; zero keys and secrets; canonical scoring isolated).`,
);
