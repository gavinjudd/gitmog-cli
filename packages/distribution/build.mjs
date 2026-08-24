import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "rolldown";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const input = resolve(packageDirectory, "../cli/dist/bin.js");
const output = resolve(packageDirectory, "dist/gitmog.mjs");
const manifest = JSON.parse(readFileSync(resolve(packageDirectory, "package.json"), "utf8"));

rmSync(resolve(packageDirectory, "dist"), { recursive: true, force: true });
mkdirSync(dirname(output), { recursive: true });

await build({
  input,
  platform: "node",
  external: [/^node:/],
  output: {
    file: output,
    format: "esm",
    codeSplitting: false,
    minify: false,
    sourcemap: false,
  },
});

chmodSync(resolve(packageDirectory, "bin/gitmog.mjs"), 0o755);

// Rolldown's region comments expose workspace-relative source locations. They are not
// runtime data and have no place in the standalone artifact.
const bundled = readFileSync(output, "utf8").replace(/^\s*\/\/#(?:end)?region(?: .*)?\r?\n/gm, "");
writeFileSync(output, bundled, "utf8");
/** @type {readonly (readonly [string, RegExp])[]} */
const forbidden = [
  ["workspace dependency", /(?:from|import\s*\()\s*["']@gitmog\//],
  ["workspace protocol", /\bworkspace:/],
  ["source map reference", /sourceMappingURL=/],
  ["hosted AI SDK", /@ai-sdk|api\.openai\.com/],
  ["product child process", /node:child_process/],
  ["repository-relative CLI path", /packages\/cli/],
  ["developer-machine path", /\/Users\/|[A-Za-z]:\\Users\\/],
];
for (const [label, pattern] of forbidden) {
  if (pattern.test(bundled)) {
    throw new Error(`Distribution bundle still contains ${label}.`);
  }
}

const retiredTerms = [
  ["ultra", "think"].join(""),
  ["ol", "lama"].join(""),
  ["qw", "en"].join(""),
  ["ora", "cle"].join(""),
  ["AI", "GATEWAY"].join("_"),
  ["local", "model"].join(" "),
  ["inference", "provider"].join(" "),
  ["model", "download"].join(" "),
  ["114", "34"].join(""),
  ["/api", "/version"].join(""),
  ["/api", "/tags"].join(""),
  ["/api", "/pull"].join(""),
  ["/api", "/chat"].join(""),
  `--${["ora", "cle"].join("")}`,
  `--${["ultra", "think"].join("")}`,
];
for (const term of retiredTerms) {
  if (bundled.toLowerCase().includes(term.toLowerCase())) {
    throw new Error("Distribution bundle contains a retired product term.");
  }
}

// A build sentinel makes an incomplete pack obvious and gives the test a stable, tiny
// file to assert. It contains no path, clock or machine-specific detail.
writeFileSync(
  resolve(packageDirectory, "dist/build.json"),
  `${JSON.stringify(
    { package: manifest.name, version: manifest.version, entry: "gitmog.mjs" },
    null,
    2,
  )}\n`,
  "utf8",
);
