#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(root, "calibration", "synthetic");
if (!existsSync(fixtureRoot)) throw new Error("Missing calibration/synthetic fixture root.");

const files = readdirSync(fixtureRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => resolve(entry.parentPath, entry.name));
const allowed = new Set([".json", ".md", ".ts", ".tsx", ".js", ".jsx", ".py", ".go"]);
for (const file of files) {
  if (!allowed.has(extname(file))) throw new Error(`Unsupported synthetic fixture member: ${file}`);
}

console.log(`Quality fixture contract ready (${String(files.length)} synthetic files).`);
