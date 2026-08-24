#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");

export function publicNodeVersions() {
  const canonical = readFileSync(resolve(root, ".node-version"), "utf8").trim();
  const manifest = JSON.parse(
    readFileSync(resolve(root, "packages", "distribution", "package.json"), "utf8"),
  );
  const range = manifest.engines?.node;
  if (typeof range !== "string") throw new Error("Public package has no Node engine range.");
  const lanes = range.split("||").map((lane) => lane.trim());
  const caretVersion = (major) => {
    const lane = lanes.find((candidate) => candidate.startsWith(`^${String(major)}.`));
    const match = /^\^(\d+\.\d+\.\d+)$/u.exec(lane ?? "");
    if (match === null) throw new Error(`Public Node ${String(major)} lane is not exact.`);
    return match[1];
  };
  const supported24 = /^>=(\d+\.\d+\.\d+) <25$/u.exec(
    lanes.find((candidate) => candidate.startsWith(">=24.")) ?? "",
  );
  if (supported24 === null || !canonical.startsWith("24.")) {
    throw new Error("Canonical Node does not match the public Node 24 lane.");
  }
  const numeric = (version) => version.split(".").map(Number);
  const minimum24 = numeric(supported24[1]);
  const canonical24 = numeric(canonical);
  if (canonical24.some((part, index) => part < minimum24[index])) {
    throw new Error("Canonical Node is below the public Node 24 minimum.");
  }
  return { node22: caretVersion(22), node24: canonical, node26: caretVersion(26) };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const versions = publicNodeVersions();
  if (process.argv.includes("--github-output")) {
    for (const [lane, version] of Object.entries(versions)) {
      process.stdout.write(`${lane}=${version}\n`);
    }
  } else {
    process.stdout.write(`${JSON.stringify(versions)}\n`);
  }
}
