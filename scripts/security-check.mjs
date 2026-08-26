#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { assertBrowserOpenSourcePolicy } from "./lib/browser-open-policy.mjs";

const root = resolve(import.meta.dirname, "..");
const readJson = (...segments) => JSON.parse(readFileSync(resolve(root, ...segments), "utf8"));

const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      [
        ".git",
        ".gitmog",
        ".next",
        ".pnpm-store",
        ".turbo",
        "coverage",
        "dist",
        "node_modules",
      ].includes(entry.name)
    )
      return [];
    const path = resolve(entry.parentPath, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

const failures = [];
const workflowDirectory = resolve(root, ".github", "workflows");
for (const path of walk(workflowDirectory)) {
  const contents = readFileSync(path, "utf8");
  if (/^\s*pull_request_target\s*:/mu.test(contents)) {
    failures.push(`${path}: pull_request_target is forbidden`);
  }
  if (/\bself-hosted\b/iu.test(contents)) failures.push(`${path}: self-hosted runner is forbidden`);
  for (const match of contents.matchAll(/^\s*-\s+uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu)) {
    const reference = match[1];
    if (reference.startsWith("./")) continue;
    const revision = reference.slice(reference.lastIndexOf("@") + 1);
    if (!/^[0-9a-f]{40}$/u.test(revision)) {
      failures.push(`${path}: action is not pinned to a full commit SHA`);
    }
  }
}

const runtimeDirectories = [
  "analyzers",
  "battle",
  "cli",
  "github",
  "personality",
  "private-context",
  "quality-judge",
  "scoring",
  "source-analysis",
].map((name) => resolve(root, "packages", name, "src"));
for (const path of runtimeDirectories.flatMap(walk)) {
  const contents = readFileSync(path, "utf8");
  for (const [label, pattern] of [
    ["VM execution", /(?:node:)?vm(?:["'])/u],
    ["direct eval", /\beval\s*\(/u],
    ["Function constructor", /\bnew\s+Function\s*\(/u],
    ["native addon loading", /process\.dlopen\s*\(/u],
  ]) {
    if (pattern.test(contents)) failures.push(`${path}: ${label} is forbidden in runtime source`);
  }
}

assertBrowserOpenSourcePolicy(root);

const distribution = readJson("packages", "distribution", "package.json");
if (Object.keys(distribution.dependencies ?? {}).length !== 0) {
  failures.push("distribution package has runtime dependencies");
}
for (const name of ["preinstall", "install", "postinstall"]) {
  if (distribution.scripts?.[name] !== undefined) failures.push(`distribution defines ${name}`);
}
const parserAssets = readJson("config", "parser-assets.json");
if (JSON.stringify(parserAssets.assets) !== JSON.stringify(["dist/parsers/quality-worker.mjs"])) {
  failures.push("parser asset allowlist changed without review");
}
const policy = readJson("quality", "QUALITY_SCORE_POLICY.json");
if (
  policy.state !== "informational-only" ||
  policy.scoreInfluence !== 0 ||
  policy.reason !== "Quality Judge is a separate product signal" ||
  Object.keys(policy).length !== 3
) {
  failures.push("quality score policy is not fail-closed");
}

const archivedPrefix = `${resolve(root, "docs", "releases", "v0.2.2")}/`;
const privateMarkers = [
  ["", "Users", "operator"].join("/"),
  ["Git", "Mog", "main"].join("-") + "-",
  ["Incit", "AI"].join("-") + "/" + ["Git", "Mog"].join("-"),
];
for (const path of walk(root)) {
  if (path.startsWith(archivedPrefix)) continue;
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  if (privateMarkers.some((marker) => contents.includes(marker))) {
    failures.push(`${path}: current public tree contains private-source provenance`);
  }
}

if (failures.length > 0) {
  throw new Error(`Security contract failed:\n- ${failures.join("\n- ")}`);
}

process.stdout.write(
  "Security contract complete (SHA-pinned Actions, no privileged PR workflow, no target-execution capability, exact parser assets, informational-only quality policy, public-path scan clean).\n",
);
