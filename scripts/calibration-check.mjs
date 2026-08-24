#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contract = resolve(root, "docs", "CALIBRATION.md");
if (!existsSync(contract)) throw new Error("Missing docs/CALIBRATION.md.");
const text = readFileSync(contract, "utf8").replaceAll(/\s+/gu, " ");
for (const phrase of ["genuine human", "preview", "activation", "model output"]) {
  if (!text.toLowerCase().includes(phrase))
    throw new Error(`Calibration contract omits ${phrase}.`);
}

const activation = resolve(root, "calibration", "QUALITY_SCORE_ACTIVATION.json");
if (existsSync(activation)) {
  const parsed = JSON.parse(readFileSync(activation, "utf8"));
  if (parsed.state !== "disabled") throw new Error("Quality score activation must fail closed.");
}

console.log("Calibration boundary is preregistration-only; score activation is disabled.");
