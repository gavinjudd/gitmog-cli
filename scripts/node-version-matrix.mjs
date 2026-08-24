#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pinned = readFileSync(resolve(process.cwd(), ".node-version"), "utf8").trim();
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(pinned);
if (match === null) throw new Error(".node-version must contain one full semantic version.");

const major = match[1];
const matrix = {
  include: [
    { lane: "pinned", node: pinned },
    { lane: "latest-supported-major", node: `${major}.x` },
  ],
};
const serialized = JSON.stringify(matrix);
process.stdout.write(
  process.argv.includes("--github-output") ? `matrix=${serialized}\n` : `${serialized}\n`,
);
