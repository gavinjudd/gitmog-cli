#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const calibrationRoot = resolve(root, "calibration");
const parse = (path, label) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${label} is missing or malformed.`);
  }
};
const read = (path, label) => {
  if (!existsSync(path)) throw new Error(`${label} is missing.`);
  return readFileSync(path, "utf8");
};

const requiredFiles = [
  "README.md",
  "RUBRIC.md",
  "PREREGISTRATION.md",
  "QUALITY_SCORE_ACTIVATION.json",
  "public-training-manifest.json",
  "schema/batch.schema.json",
  "schema/judgment.schema.json",
  "schema/report.schema.json",
  "schema/training-manifest.schema.json",
  "tools/review-pairwise.mjs",
];
for (const file of requiredFiles) read(resolve(calibrationRoot, file), `calibration/${file}`);

const activation = parse(
  resolve(calibrationRoot, "QUALITY_SCORE_ACTIVATION.json"),
  "Quality score activation",
);
if (
  Object.keys(activation).toSorted().join(",") !== "reason,state" ||
  activation.state !== "disabled" ||
  activation.reason !== "human calibration pending"
)
  throw new Error("Quality score activation must be the exact fail-closed v0.3.0 contract.");

const manifest = parse(
  resolve(calibrationRoot, "public-training-manifest.json"),
  "Public training manifest",
);
if (
  manifest.schemaVersion !== "1.0.0-blinded-pairwise" ||
  manifest.state !== "not-collected" ||
  manifest.reason !== "human calibration corpus selection pending" ||
  !Array.isArray(manifest.repositories) ||
  manifest.repositories.length !== 0 ||
  !Array.isArray(manifest.pairs) ||
  manifest.pairs.length !== 0 ||
  manifest.judgmentsCollected !== 0
)
  throw new Error("Public training manifest must truthfully contain zero collected judgments.");

for (const file of requiredFiles.filter((file) => file.startsWith("schema/"))) {
  const schema = parse(resolve(calibrationRoot, file), `calibration/${file}`);
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema")
    throw new Error(`calibration/${file} does not declare JSON Schema 2020-12.`);
}

const preregistration = read(
  resolve(calibrationRoot, "PREREGISTRATION.md"),
  "Calibration preregistration",
)
  .replaceAll(/\s+/gu, " ")
  .toLowerCase();
for (const phrase of [
  "human judgments collected: **0**",
  "at least 25%",
  "three genuine humans",
  "at least 200",
  "at least 75",
  "more than 50%",
  ">= 0.60",
  ">= 0.70",
  ">= 0.62",
  ">= 0.55",
  "clopper–pearson",
  "fisher exact",
  "approve quality judge score activation",
]) {
  if (!preregistration.includes(phrase))
    throw new Error(`Calibration preregistration omits required fixed contract: ${phrase}`);
}

const judgmentSchema = read(
  resolve(calibrationRoot, "schema", "judgment.schema.json"),
  "Judgment schema",
);
for (const forbidden of ["repository", "sourceUrl", "sourceText", "owner", "email", "stars"]) {
  if (judgmentSchema.includes(`"${forbidden}"`))
    throw new Error(`Judgment schema exposes forbidden field: ${forbidden}`);
}

const reviewerTool = read(
  resolve(calibrationRoot, "tools", "review-pairwise.mjs"),
  "Pairwise reviewer tool",
);
for (const required of [
  "raw.githubusercontent.com",
  "MAX_FILE_BYTES",
  "MAX_SIDE_BYTES",
  "AbortSignal.timeout",
  "No upload performed",
  "identity-recognized",
]) {
  if (!reviewerTool.includes(required))
    throw new Error(`Reviewer tool omits boundary: ${required}`);
}
for (const forbidden of [
  "writeFileSync(temporary, sample",
  "Math.random",
  "Date.now",
  "githubToken",
]) {
  if (reviewerTool.includes(forbidden))
    throw new Error(`Reviewer tool contains forbidden path: ${forbidden}`);
}

const reports = readdirSync(resolve(calibrationRoot, "reports"), { withFileTypes: true }).filter(
  (entry) => entry.isFile() && entry.name !== ".gitkeep",
);
if (reports.length > 0)
  throw new Error(
    `Calibration reports must remain empty before human review: ${reports.map((entry) => relative(root, resolve(entry.parentPath, entry.name))).join(", ")}`,
  );

console.log(
  "Calibration preregistration is complete; 0 human judgments collected; score activation disabled.",
);
