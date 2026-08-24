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
const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      [".git", ".gitmog", ".pnpm-store", ".turbo", "coverage", "dist", "node_modules"].includes(
        entry.name,
      )
    ) {
      return [];
    }
    const path = resolve(entry.parentPath, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

const policyPath = resolve(root, "quality", "QUALITY_SCORE_POLICY.json");
const policy = parse(policyPath, "Quality score policy");
if (
  Object.keys(policy).toSorted().join(",") !== "reason,scoreInfluence,state" ||
  policy.state !== "informational-only" ||
  policy.scoreInfluence !== 0 ||
  policy.reason !== "Quality Judge is a separate product signal"
) {
  throw new Error("Quality score policy must be the exact informational-only contract.");
}

for (const removed of [
  "calibration",
  "docs/CALIBRATION.md",
  "scripts/calibration-check.mjs",
  ".github/workflows/calibration.yml",
]) {
  if (existsSync(resolve(root, removed))) {
    throw new Error(`Retired reviewer-program path remains: ${removed}`);
  }
}

const forbiddenPhrases = [
  ["human", "calibration"].join(" "),
  ["experienced", "reviewers", "required"].join(" "),
  ["three", "genuine", "humans"].join(" "),
  ["sealed", "human", "holdout"].join(" "),
  ["quality", "judge", "score", "activation"].join(" "),
];
for (const path of walk(root)) {
  let contents;
  try {
    contents = readFileSync(path, "utf8").toLowerCase();
  } catch {
    continue;
  }
  for (const phrase of forbiddenPhrases) {
    if (contents.includes(phrase)) {
      throw new Error(`Retired reviewer-program phrase remains in ${relative(root, path)}.`);
    }
  }
}

const fixtureRoot = resolve(root, "quality", "fixtures");
const manifest = parse(resolve(fixtureRoot, "manifest.json"), "Synthetic fixture manifest");
if (
  manifest.schemaVersion !== "1.0.0-synthetic-fixtures" ||
  manifest.license !== "MIT" ||
  manifest.containsPublicSource !== false ||
  !Array.isArray(manifest.cases) ||
  manifest.cases.length < 3
) {
  throw new Error("Synthetic fixture manifest does not preserve the license and source boundary.");
}

const scoringRoot = resolve(root, "packages", "scoring");
for (const path of walk(scoringRoot)) {
  const contents = readFileSync(path, "utf8");
  if (contents.includes("@gitmog/quality-judge") || contents.includes("qualityPreview")) {
    throw new Error(`Canonical scoring imports Quality Judge through ${relative(root, path)}.`);
  }
}

const qualityTypes = read(
  resolve(root, "packages", "quality-judge", "src", "types.ts"),
  "Quality result types",
);
const qualityAnalysis = read(
  resolve(root, "packages", "quality-judge", "src", "analyze.ts"),
  "Quality analysis",
);
for (const contract of [qualityTypes, qualityAnalysis]) {
  if (!contract.includes('activation: "preview-only"') || !contract.includes("scoreInfluence: 0")) {
    throw new Error(
      "Quality Judge JSON compatibility fields are not fixed to preview-only and zero.",
    );
  }
}

console.log(
  `Quality policy contract complete (informational-only; ${String(manifest.cases.length)} synthetic fixtures; canonical scoring isolated).`,
);
