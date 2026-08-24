#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(root, "calibration", "synthetic");
if (!existsSync(fixtureRoot)) throw new Error("Missing calibration/synthetic fixture root.");

const files = readdirSync(fixtureRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => resolve(entry.parentPath, entry.name));
const allowed = new Set([".json", ".md", ".ts", ".tsx", ".js", ".jsx"]);
for (const file of files) {
  const path = relative(fixtureRoot, file);
  if (!allowed.has(extname(file))) throw new Error(`Unsupported synthetic fixture member: ${path}`);
  if (readFileSync(file).byteLength > 20 * 1024)
    throw new Error(`Synthetic fixture exceeds the per-file source bound: ${path}`);
}

const manifestPath = resolve(fixtureRoot, "manifest.json");
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  throw new Error("Synthetic fixture manifest is missing or malformed.");
}
if (
  manifest.schemaVersion !== "1.0.0-synthetic-fixtures" ||
  manifest.license !== "MIT" ||
  manifest.containsHumanJudgments !== false ||
  manifest.containsPublicSource !== false ||
  !Array.isArray(manifest.cases) ||
  manifest.cases.length < 3
)
  throw new Error("Synthetic fixture manifest does not preserve the license/privacy boundary.");
const ids = new Set();
for (const fixture of manifest.cases) {
  if (
    typeof fixture.id !== "string" ||
    ids.has(fixture.id) ||
    !["typescript", "javascript"].includes(fixture.language) ||
    !Array.isArray(fixture.expectedMetrics) ||
    fixture.expectedMetrics.length === 0 ||
    typeof fixture.path !== "string" ||
    fixture.path.includes("..") ||
    !existsSync(resolve(fixtureRoot, fixture.path))
  )
    throw new Error("Synthetic fixture manifest contains an invalid case.");
  ids.add(fixture.id);
}

console.log(
  `Quality fixture contract ready (${String(manifest.cases.length)} synthetic cases; no human judgments).`,
);
