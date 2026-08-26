import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "rolldown";

import { assertBrowserOpenBundlePolicy } from "./browser-open-policy.mjs";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const input = resolve(packageDirectory, "../cli/dist/bin.js");
const output = resolve(packageDirectory, "dist/gitmog.mjs");
const parserInput = resolve(packageDirectory, "../quality-judge/dist/parser-worker.js");
const parserOutput = resolve(packageDirectory, "dist/parsers/quality-worker.mjs");
const manifest = JSON.parse(readFileSync(resolve(packageDirectory, "package.json"), "utf8"));
const privateContextApp = JSON.parse(
  readFileSync(resolve(packageDirectory, "../../config/private-context-app.json"), "utf8"),
);
const interactionVersions = JSON.parse(
  readFileSync(resolve(packageDirectory, "../../config/interaction-versions.json"), "utf8"),
);
const interactionOwnerSource = [
  resolve(packageDirectory, "../cli/src/cli.ts"),
  resolve(packageDirectory, "../cli/src/open-external.ts"),
]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

rmSync(resolve(packageDirectory, "dist"), { recursive: true, force: true });
mkdirSync(dirname(output), { recursive: true });
mkdirSync(dirname(parserOutput), { recursive: true });

/** @param {string} entry @param {string} file */
const bundle = async (entry, file) => {
  await build({
    input: entry,
    platform: "node",
    external: [/^node:/],
    transform: {
      define: {
        __filename: "import.meta.filename",
        __dirname: "import.meta.dirname",
      },
    },
    output: {
      file,
      format: "esm",
      codeSplitting: false,
      minify: false,
      sourcemap: false,
    },
  });
};

await bundle(input, output);
await bundle(parserInput, parserOutput);

chmodSync(resolve(packageDirectory, "bin/gitmog.mjs"), 0o755);

// Rolldown's region comments expose workspace-relative source locations. They are not
// runtime data and have no place in the standalone artifact.
/** @param {string} file */
const sanitize = (file) => {
  const bundled = readFileSync(file, "utf8")
    .replace(/^\s*\/\/#(?:end)?region(?: .*)?\r?\n/gm, "")
    // The bundled TypeScript parser contains its own emitter's source-map vocabulary.
    // Preserve that runtime string while ensuring the shipped file contains no active
    // source-map directive or review-confusing literal directive marker.
    .replace(/^\s*\/\/[#@]\s*sourceMappingURL=.*\r?\n?/gmu, "")
    .replaceAll("sourceMappingURL=", "sourceMappingURL\\x3d");
  writeFileSync(file, bundled, "utf8");
  return bundled;
};
const bundled = sanitize(output);
const parserBundle = sanitize(parserOutput);
assertBrowserOpenBundlePolicy(bundled, parserBundle);
for (const version of Object.values(interactionVersions)) {
  if (!interactionOwnerSource.includes(version)) {
    throw new Error(`Interaction owner source omitted configured version ${version}.`);
  }
}
/** @type {readonly (readonly [string, RegExp])[]} */
const forbidden = [
  ["workspace dependency", /(?:from|import\s*\()\s*["']@gitmog\//],
  ["workspace protocol", /\bworkspace:/],
  ["source map reference", /sourceMappingURL=/],
  ["hosted AI SDK", /@ai-sdk|api\.openai\.com/],
  ["repository-relative CLI path", /packages\/cli/],
  ["developer-machine path", /\/Users\/|[A-Za-z]:\\Users\\/],
];
for (const [label, pattern] of forbidden) {
  if (pattern.test(bundled) || pattern.test(parserBundle)) {
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
  if (
    bundled.toLowerCase().includes(term.toLowerCase()) ||
    parserBundle.toLowerCase().includes(term.toLowerCase())
  ) {
    throw new Error("Distribution bundle contains a retired product term.");
  }
}

// A build sentinel makes an incomplete pack obvious and gives the test a stable, tiny
// file to assert. It contains no path, clock or machine-specific detail.
writeFileSync(
  resolve(packageDirectory, "dist/build.json"),
  `${JSON.stringify(
    {
      package: manifest.name,
      version: manifest.version,
      entry: "gitmog.mjs",
      parserAssets: ["parsers/quality-worker.mjs"],
      interaction: interactionVersions,
      privateContext: {
        app: privateContextApp,
        result: "1.2.0-readable-sample-presentation",
        request: "1.0.0-bounded-private-rest",
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);
