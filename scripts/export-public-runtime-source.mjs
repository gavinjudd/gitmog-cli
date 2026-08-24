#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveWorkspacePnpmCli } from "./lib/package-manager.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const allowlistPath = resolve(root, "config/public-runtime-source-allowlist.json");

const runtimePackages = Object.freeze([
  "analyzers",
  "github",
  "personality",
  "scoring",
  "source-analysis",
  "battle",
  "cli",
]);

const exactDevelopmentDependencies = Object.freeze({
  "@types/node": "24.13.3",
  rolldown: "1.2.4",
  typescript: "6.0.3",
});

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isInside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path !== "" && !path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path);
}

function assertRelativeLiteral(path) {
  if (
    typeof path !== "string" ||
    path === "" ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Invalid public-source allowlist path: ${JSON.stringify(path)}.`);
  }
}

export function validatePublicSourceAllowlist(document, trackedFiles) {
  if (document?.schemaVersion !== "1.0.0-public-runtime-source-allowlist") {
    throw new Error("Unsupported public-source allowlist schema.");
  }
  if (!Array.isArray(document.files) || document.files.length === 0) {
    throw new Error("Public-source allowlist must contain literal file paths.");
  }
  const sorted = [...document.files].sort();
  if (JSON.stringify(document.files) !== JSON.stringify(sorted)) {
    throw new Error("Public-source allowlist must be byte-order sorted.");
  }
  if (new Set(document.files).size !== document.files.length) {
    throw new Error("Public-source allowlist contains a duplicate path.");
  }
  const tracked = new Set(trackedFiles);
  for (const path of document.files) {
    assertRelativeLiteral(path);
    if (!tracked.has(path))
      throw new Error(`Allowlisted public-source file is not tracked: ${path}`);
  }
  return Object.freeze([...document.files]);
}

export function sanitizeRuntimePackageManifest(manifest, packageName = "") {
  const allowedKeys = [
    "name",
    "version",
    "private",
    "type",
    "description",
    "bin",
    "exports",
    "main",
    "types",
    "dependencies",
  ];
  const sanitized = Object.fromEntries(
    allowedKeys
      .filter((key) => manifest[key] !== undefined)
      .map((key) => [key, structuredClone(manifest[key])]),
  );
  if (packageName === "personality") {
    sanitized.exports = { ".": sanitized.exports["."] };
  }
  return sanitized;
}

export function publicCandidateRootManifest(version) {
  const workspaceDependencies = Object.fromEntries(
    ["config", ...runtimePackages].map((name) => [`@gitmog/${name}`, "workspace:*"]),
  );
  const buildSteps = runtimePackages.map(
    (name) => `pnpm exec tsc -p packages/${name}/tsconfig.build.json`,
  );
  buildSteps.push("node packages/distribution/build.mjs");
  return {
    name: "gitmog-public-runtime-source",
    version,
    private: true,
    type: "module",
    license: "MIT",
    packageManager: "pnpm@11.21.0",
    engines: { node: ">=24.19.0 <25", pnpm: "11.21.0" },
    scripts: {
      build: buildSteps.join(" && "),
      test: "pnpm run build && node scripts/package-acceptance.mjs",
    },
    devDependencies: { ...workspaceDependencies, ...exactDevelopmentDependencies },
  };
}

function publicWorkspaceDocument() {
  return [
    "packages:",
    '  - "packages/*"',
    "",
    "engineStrict: true",
    "strictDepBuilds: true",
    "",
  ].join("\n");
}

function publicExportEnvironment(output) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/(?:token|auth|cookie|secret|password)/iu.test(key)) delete environment[key];
  }
  const userconfig = resolve(output, ".npmrc-public-runtime-source");
  return { ...environment, npm_config_userconfig: userconfig, NPM_CONFIG_USERCONFIG: userconfig };
}

function markdownDocuments({ commit, version, schemaVersion }) {
  return {
    "README.md": `# Git Mog public runtime source\n\nThis single-root source export contains the code needed to inspect and reproduce the shipped \`gitmog@${version}\` runtime. It was allowlisted from private canonical source commit \`${commit}\` using export schema \`${schemaVersion}\`. It does not contain the private repository history.\n\nGit Mog compares public GitHub work for entertainment. Coverage is the portion of the public scorecard that could be measured, not an estimate of anyone's engineering ability. Target repositories are never cloned, installed, built, or executed.\n\nSee [BUILDING.md](BUILDING.md), [SECURITY.md](SECURITY.md), [SUPPORTED_PLATFORMS.md](SUPPORTED_PLATFORMS.md), and [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).\n`,
    "BUILDING.md": `# Build and verification\n\nRequirements: Node 24.19.0 and pnpm 11.21.0.\n\n\`\`\`sh\ncorepack pnpm install --frozen-lockfile --ignore-scripts\ncorepack pnpm test\n\`\`\`\n\nThe acceptance command builds \`packages/distribution\`, packs it outside the checkout, requires exactly six package members, installs that tarball into a disposable project, and runs offline fixture acceptance. Compare package member bytes and the tarball hash against the release checksums supplied with the audited release candidate.\n\nDevelopment dependencies are exactly pinned in \`package.json\` and \`pnpm-lock.yaml\`. The packed package has zero runtime dependencies and no lifecycle install behavior.\n`,
    "SUPPORTED_PLATFORMS.md": `# Supported platforms\n\nThe public package engine is Node \`^22.23.2 || >=24.16.0 <25 || ^26.7.0\`. The v0.2.2 candidate is accepted on native Apple Silicon macOS and native Windows x64, with exact-artifact checks on Node 22.23.2, 24.19.0, and 26.7.0. Other native architectures are not claimed without physical acceptance evidence.\n`,
    "KNOWN_LIMITATIONS.md": `# Known limitations\n\n- Git Mog uses only public GitHub evidence; unavailable or rate-limited evidence lowers coverage.\n- One-time GitHub device authorization is session-only and requests no scope. Tokens are not persisted.\n- The cache stores stable derived/public API data, never raw source, and is capped at 25 MiB.\n- Identical source and tool versions are required for exact artifact reproduction. Platform-specific npm archive metadata can otherwise affect tarball bytes even when all six member bytes match.\n`,
  };
}

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.name === ".git" || entry.name === "node_modules") return [];
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

function assertPrivacyBoundary(output) {
  const forbiddenPathNames = /(?:^|\/)(?:AGENTS\.md|PLANNING\.md|EXECUTION_STATE\.md)$/u;
  const forbiddenContent = [
    ["macOS user path", /\/Users\/[A-Za-z0-9._-]+\//u],
    ["Windows user path", /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\/u],
    ["OAuth client secret", /client_secret\s*[:=]\s*["'][^"']+/iu],
    ["GitHub token shape", /\b(?:gh[opsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u],
    ["npm token shape", /\bnpm_[A-Za-z0-9]{20,}\b/u],
    ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ];
  for (const path of walkFiles(output)) {
    const portable = relative(output, path).replaceAll("\\", "/");
    if (forbiddenPathNames.test(portable)) throw new Error(`Private file escaped: ${portable}`);
    const contents = readFileSync(path, "utf8");
    for (const [label, pattern] of forbiddenContent) {
      if (pattern.test(contents)) throw new Error(`Public source contains ${label}: ${portable}`);
    }
  }
}

function writeManifest(output) {
  const rows = walkFiles(output)
    .filter((path) => relative(output, path).replaceAll("\\", "/") !== "SHA256SUMS.txt")
    .map((path) => [relative(output, path).replaceAll("\\", "/"), sha256(readFileSync(path))])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  writeFileSync(
    resolve(output, "SHA256SUMS.txt"),
    `${rows.map(([path, digest]) => `${digest}  ${path}`).join("\n")}\n`,
    "utf8",
  );
  return rows.length;
}

function parseArguments(argv) {
  const outputIndex = argv.indexOf("--output");
  const shaIndex = argv.indexOf("--expected-sha");
  return {
    output: outputIndex < 0 ? undefined : argv[outputIndex + 1],
    expectedSha: shaIndex < 0 ? undefined : argv[shaIndex + 1],
  };
}

function assertExternalEmptyOutput(value) {
  if (value === undefined || value === "") {
    throw new Error(
      "Usage: export-public-runtime-source.mjs --output <empty-external-directory> --expected-sha <commit>",
    );
  }
  const output = resolve(value);
  if (!isAbsolute(output) || output === root || isInside(root, output)) {
    throw new Error("Public runtime source must be written outside the canonical repository.");
  }
  if (existsSync(output)) {
    if (lstatSync(output).isSymbolicLink())
      throw new Error("Public-source output may not be a symlink.");
    if (!statSync(output).isDirectory() || readdirSync(output).length !== 0) {
      throw new Error("Public-source output directory must be empty.");
    }
    if (realpathSync(output) === realpathSync(root))
      throw new Error("Output resolved to repository root.");
  } else {
    const parent = resolve(output, "..");
    if (!existsSync(parent) || !statSync(parent).isDirectory()) {
      throw new Error("Create the external output parent explicitly before exporting.");
    }
    const realParent = realpathSync(parent);
    if (realParent === realpathSync(root) || isInside(root, realParent)) {
      throw new Error("Public-source output parent resolves inside the canonical repository.");
    }
    mkdirSync(output);
  }
  return output;
}

export function exportPublicRuntimeSource(argv = process.argv.slice(2)) {
  const arguments_ = parseArguments(argv);
  if (arguments_.expectedSha === undefined || !/^[0-9a-f]{40}$/u.test(arguments_.expectedSha)) {
    throw new Error("An exact 40-character --expected-sha is required.");
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (head !== arguments_.expectedSha) {
    throw new Error(`Expected source commit ${arguments_.expectedSha}; found ${head}.`);
  }
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  if (status !== "") throw new Error("Public-source export requires a clean canonical worktree.");

  const trackedFiles = execFileSync("git", ["ls-files", "-z"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const allowlistDocument = JSON.parse(readFileSync(allowlistPath, "utf8"));
  const allowlist = validatePublicSourceAllowlist(allowlistDocument, trackedFiles);
  const output = assertExternalEmptyOutput(arguments_.output);
  try {
    for (const path of allowlist) {
      const source = resolve(root, path);
      if (
        !isInside(root, source) ||
        lstatSync(source).isSymbolicLink() ||
        !statSync(source).isFile()
      ) {
        throw new Error(`Unsafe allowlisted source file: ${path}`);
      }
      const destination = resolve(output, path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }

    for (const packageName of runtimePackages) {
      const path = resolve(output, "packages", packageName, "package.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      const sanitized = sanitizeRuntimePackageManifest(manifest, packageName);
      writeFileSync(path, json(sanitized), "utf8");
    }
    const configManifestPath = resolve(output, "packages/config/package.json");
    const configManifest = sanitizeRuntimePackageManifest(
      JSON.parse(readFileSync(configManifestPath, "utf8")),
    );
    configManifest.exports = {
      "./typescript/base.json": "./typescript/base.json",
      "./typescript/node-lib.json": "./typescript/node-lib.json",
    };
    delete configManifest.dependencies;
    writeFileSync(configManifestPath, json(configManifest), "utf8");
    const distributionManifest = JSON.parse(
      readFileSync(resolve(output, "packages/distribution/package.json"), "utf8"),
    );
    writeFileSync(
      resolve(output, "package.json"),
      json(publicCandidateRootManifest(distributionManifest.version)),
    );
    writeFileSync(resolve(output, "pnpm-workspace.yaml"), publicWorkspaceDocument(), "utf8");

    const documents = markdownDocuments({
      commit: head,
      version: distributionManifest.version,
      schemaVersion: allowlistDocument.schemaVersion,
    });
    for (const [path, contents] of Object.entries(documents)) {
      writeFileSync(resolve(output, path), contents, "utf8");
    }
    writeFileSync(
      resolve(output, "SOURCE_EXPORT.json"),
      json({
        schema: allowlistDocument.schemaVersion,
        canonicalRepository: "Incit-AI/Git-Mog",
        sourceCommit: head,
        package: `gitmog@${distributionManifest.version}`,
        allowlist: "config/public-runtime-source-allowlist.json",
        historyIncluded: false,
      }),
      "utf8",
    );
    writeFileSync(
      resolve(output, "SBOM.json"),
      json({
        schema: "gitmog-public-runtime-sbom-v1",
        package: { name: "gitmog", version: distributionManifest.version, runtimeDependencies: [] },
        developmentDependencies: exactDevelopmentDependencies,
        workspacePackages: ["config", ...runtimePackages, "distribution"].map(
          (name) => `packages/${name}`,
        ),
      }),
      "utf8",
    );

    const pnpmCli = resolveWorkspacePnpmCli();
    execFileSync(
      process.execPath,
      [pnpmCli, "install", "--lockfile-only", "--ignore-scripts", "--config.minimum-release-age=0"],
      {
        cwd: output,
        env: publicExportEnvironment(output),
        stdio: "inherit",
      },
    );
    const temporaryNpmrc = resolve(output, ".npmrc-public-runtime-source");
    if (existsSync(temporaryNpmrc)) rmSync(temporaryNpmrc, { force: true });
    if (existsSync(resolve(output, "node_modules"))) {
      throw new Error("Lockfile-only public-source export unexpectedly created node_modules.");
    }
    assertPrivacyBoundary(output);
    const fileCount = writeManifest(output);
    process.stdout.write(
      `${JSON.stringify({ output, sourceCommit: head, version: distributionManifest.version, fileCount }, null, 2)}\n`,
    );
    return { output, sourceCommit: head, version: distributionManifest.version, fileCount };
  } catch (error) {
    rmSync(output, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  exportPublicRuntimeSource();
}
