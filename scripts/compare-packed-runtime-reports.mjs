#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { publicNodeVersions } from "./public-node-versions.mjs";

export function comparePackedRuntimeReports(paths) {
  const expected = Object.values(publicNodeVersions());
  if (paths.length !== expected.length) {
    throw new Error(`Expected ${String(expected.length)} packed-runtime reports.`);
  }
  const reports = paths.map((path) => JSON.parse(readFileSync(path, "utf8")));
  for (const [index, report] of reports.entries()) {
    if (report.node !== `v${expected[index]}`) {
      throw new Error(`Packed report ${String(index + 1)} used ${String(report.node)}.`);
    }
    if (!Array.isArray(report.checks) || report.checks.length === 0) {
      throw new Error(`Packed report ${String(index + 1)} has no acceptance checks.`);
    }
    if (!/^[0-9a-f]{64}$/u.test(report.canonicalJsonSha256 ?? "")) {
      throw new Error(`Packed report ${String(index + 1)} has no canonical JSON hash.`);
    }
  }
  const hashes = new Set(reports.map((report) => report.canonicalJsonSha256));
  if (hashes.size !== 1) throw new Error("Canonical packed JSON differs across Node runtimes.");
  return reports.map((report) => ({
    node: report.node,
    checks: report.checks.length,
    canonicalJsonSha256: report.canonicalJsonSha256,
  }));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length < 5) {
    throw new Error(
      "Usage: compare-packed-runtime-reports.mjs <node-22.json> <node-24.json> <node-26.json>",
    );
  }
  process.stdout.write(
    `${JSON.stringify(comparePackedRuntimeReports(process.argv.slice(2)), null, 2)}\n`,
  );
}
