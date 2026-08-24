#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertReleaseTag } from "./check-release.mjs";
import { buildExternalTarball, packageAcceptanceEnvironment } from "./lib/package-acceptance.mjs";
import { captureNodeCli, resolveNpmEntrypoints } from "./lib/package-manager.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
export const RELEASE_BUILD_TARGETS = Object.freeze(["@gitmog/cli", "gitmog"]);
export const RELEASE_WORKSPACE_PACKAGES = Object.freeze([
  "packages/analyzers",
  "packages/battle",
  "packages/cli",
  "packages/config",
  "packages/distribution",
  "packages/github",
  "packages/personality",
  "packages/quality-judge",
  "packages/scoring",
  "packages/source-analysis",
  "packages/test-fixtures",
]);

const INSTALL_SCRIPT_NAMES = Object.freeze(["preinstall", "install", "postinstall"]);
const DISTRIBUTION_ROOT = resolve(root, "packages/distribution");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function evidenceHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readLicenseReview() {
  const review = readJson(resolve(root, "config/toolchain-licenses.json"));
  if (
    review.schema !== "gitmog-toolchain-license-review-v1" ||
    !Array.isArray(review.dependencies) ||
    review.dependencies.length === 0
  ) {
    throw new Error("Toolchain license review is absent or malformed.");
  }
  return review;
}

function readQualityPolicy() {
  const path = resolve(root, "quality/QUALITY_SCORE_POLICY.json");
  if (!existsSync(path)) throw new Error("Quality score policy is absent.");
  const policy = readJson(path);
  if (
    policy.state !== "informational-only" ||
    policy.scoreInfluence !== 0 ||
    policy.reason !== "Quality Judge is a separate product signal" ||
    Object.keys(policy).length !== 3
  ) {
    throw new Error(
      "Release candidate requires the fail-closed informational-only quality policy.",
    );
  }
  return policy;
}

function readQualityVersions() {
  const path = resolve(root, "config/quality-versions.json");
  return existsSync(path) ? readJson(path) : null;
}

function parserAssets(files) {
  return [...files]
    .filter((path) => path.replaceAll("\\", "/").startsWith("dist/parsers/"))
    .sort()
    .map((path) => {
      const absolute = resolve(DISTRIBUTION_ROOT, path);
      if (!existsSync(absolute)) throw new Error(`Packed parser asset is missing: ${path}`);
      return {
        path,
        bytes: statSync(absolute).size,
        sha256: evidenceHash(readFileSync(absolute)),
      };
    });
}

function acceptReleaseArtifact(tarball, environment, expectedSha256) {
  const stdout = execFileSync(
    process.execPath,
    [resolve(root, "scripts/accept-platform.mjs"), "--tarball", tarball, "--fixture-network"],
    {
      cwd: root,
      env: environment,
      encoding: "utf8",
      maxBuffer: 48 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const report = JSON.parse(stdout);
  if (String(report.tarball?.sha256 ?? "").toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error("Exact candidate acceptance reported a different tarball hash.");
  }
  return report;
}

function buildReleaseRuntime() {
  const environment = {
    ...process.env,
    GITHUB_TOKEN: "",
    GH_TOKEN: "",
    NODE_AUTH_TOKEN: "",
    NPM_TOKEN: "",
  };
  execFileSync(
    process.execPath,
    [
      resolve(root, "scripts/turbo.mjs"),
      "run",
      "build",
      ...RELEASE_BUILD_TARGETS.map((target) => `--filter=${target}`),
    ],
    { cwd: root, env: environment, stdio: "inherit" },
  );
}

export function artifactHashes(bytes) {
  return {
    sha1: createHash("sha1").update(bytes).digest("hex"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  };
}

export function releaseMetadata(input) {
  return {
    schema: "gitmog-release-artifact-v1",
    repository: "gavinjudd/gitmog-cli",
    commit: input.commit,
    package: {
      name: "gitmog",
      version: input.version,
      filename: input.filename,
      bytes: input.bytes,
      unpackedBytes: input.unpackedBytes,
      files: [...input.files].sort(),
      members: [...input.members].sort((left, right) => left.path.localeCompare(right.path)),
      license: input.manifest.license,
      repository: input.manifest.repository,
      engines: input.manifest.engines,
      bins: input.manifest.bin,
      dependencies: input.manifest.dependencies ?? {},
      installScripts: Object.fromEntries(
        INSTALL_SCRIPT_NAMES.filter((name) => input.manifest.scripts?.[name] !== undefined).map(
          (name) => [name, input.manifest.scripts[name]],
        ),
      ),
    },
    hashes: {
      sha1: input.sha1,
      sha256: input.sha256,
      integrity: input.integrity,
    },
    parserAssets: input.parserAssets,
    quality: {
      policy: input.policy,
      versions: input.qualityVersions,
    },
    evidence: input.evidence,
  };
}

const parseArguments = (argv) => {
  const outputIndex = argv.indexOf("--output");
  const tagIndex = argv.indexOf("--tag");
  const shaIndex = argv.indexOf("--expected-sha");
  return {
    output: outputIndex < 0 ? undefined : argv[outputIndex + 1],
    tag: tagIndex < 0 ? undefined : argv[tagIndex + 1],
    expectedSha: shaIndex < 0 ? undefined : argv[shaIndex + 1],
  };
};

export async function buildReleaseArtifact(argv = process.argv.slice(2)) {
  const arguments_ = parseArguments(argv);
  if (arguments_.output === undefined || arguments_.output === "") {
    throw new Error(
      "Usage: build-release-artifact.mjs --output <external-directory> [--tag vX.Y.Z] [--expected-sha <commit>]",
    );
  }
  const output = resolve(arguments_.output);
  const relativeOutput = relative(root, output);
  if (
    !isAbsolute(output) ||
    relativeOutput === "" ||
    (!relativeOutput.startsWith("..") && !isAbsolute(relativeOutput))
  ) {
    throw new Error("Release artifacts must be written outside the repository.");
  }
  mkdirSync(output, { recursive: true });
  if (readdirSync(output).length !== 0) {
    throw new Error("Release artifact directory must be empty.");
  }

  const manifest = readJson(resolve(DISTRIBUTION_ROOT, "package.json"));
  if (arguments_.tag !== undefined) assertReleaseTag(arguments_.tag, manifest.version);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const worktree = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  if (worktree !== "") {
    throw new Error("Release artifacts require a clean worktree.");
  }
  if (arguments_.expectedSha !== undefined && commit !== arguments_.expectedSha) {
    throw new Error(`Expected release commit ${arguments_.expectedSha}; found ${commit}.`);
  }

  buildReleaseRuntime();
  const builtCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const builtWorktree = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  if (builtCommit !== commit || builtWorktree !== "") {
    throw new Error("Repository identity changed while building the release runtime.");
  }

  const scratch = mkdtempSync(join(tmpdir(), "gitmog-release-build-"));
  try {
    const { npmCli } = resolveNpmEntrypoints();
    const environment = packageAcceptanceEnvironment(
      {
        ...process.env,
        GITHUB_TOKEN: "",
        GH_TOKEN: "",
        NODE_AUTH_TOKEN: "",
        NPM_TOKEN: "",
        NO_COLOR: "1",
      },
      join(scratch, "npm-cache"),
      join(scratch, "gitmog-cache"),
    );
    const runCli = (entrypoint, args, options) => {
      const result = captureNodeCli("npm", entrypoint, args, options);
      if (result.code !== 0) {
        throw new Error(
          `npm ${args.join(" ")} failed with ${String(result.code)}.\n${result.stderr}`,
        );
      }
      return result;
    };
    const artifact = buildExternalTarball({
      npmCli,
      packageDirectory: resolve(root, "packages/distribution"),
      context: { artifacts: output },
      environment,
      runCli,
    });
    const filename = `gitmog-${manifest.version}.tgz`;
    if (artifact.tarball !== resolve(output, filename)) {
      throw new Error(`Expected exact artifact filename ${filename}.`);
    }
    const hashes = artifactHashes(readFileSync(artifact.tarball));
    if (hashes.sha1 !== artifact.shasum || hashes.integrity !== artifact.integrity) {
      throw new Error("Locally computed artifact hashes disagree with npm pack metadata.");
    }
    const acceptance = acceptReleaseArtifact(artifact.tarball, environment, hashes.sha256);
    const assets = parserAssets(artifact.files);
    const policy = readQualityPolicy();
    const qualityVersions = readQualityVersions();
    const licenseReview = readLicenseReview();
    const licenses = {
      schema: "gitmog-release-licenses-v1",
      package: { name: manifest.name, version: manifest.version, license: manifest.license },
      toolchain: licenseReview,
    };
    const sbom = {
      schema: "gitmog-release-sbom-v1",
      commit,
      package: {
        name: manifest.name,
        version: manifest.version,
        license: manifest.license,
        runtimeDependencies: manifest.dependencies ?? {},
        installScripts: Object.fromEntries(
          INSTALL_SCRIPT_NAMES.filter((name) => manifest.scripts?.[name] !== undefined).map(
            (name) => [name, manifest.scripts[name]],
          ),
        ),
        engines: manifest.engines,
        compressedBytes: artifact.bytes,
        unpackedBytes: artifact.unpackedBytes,
        members: [...artifact.members].sort((left, right) => left.path.localeCompare(right.path)),
        parserAssets: assets,
      },
      developmentDependencies: licenseReview.dependencies,
      workspacePackages: RELEASE_WORKSPACE_PACKAGES,
      quality: { policy, versions: qualityVersions },
    };
    const evidenceDocuments = {
      "LICENSES.json": `${JSON.stringify(licenses, null, 2)}\n`,
      "SBOM.json": `${JSON.stringify(sbom, null, 2)}\n`,
      "platform-acceptance.json": `${JSON.stringify(acceptance, null, 2)}\n`,
    };
    for (const [name, contents] of Object.entries(evidenceDocuments)) {
      writeFileSync(resolve(output, name), contents, "utf8");
    }
    const evidence = Object.fromEntries(
      Object.entries(evidenceDocuments).map(([name, contents]) => [
        name,
        { bytes: Buffer.byteLength(contents), sha256: evidenceHash(contents) },
      ]),
    );
    const metadata = releaseMetadata({
      commit,
      version: manifest.version,
      filename,
      bytes: artifact.bytes,
      unpackedBytes: artifact.unpackedBytes,
      files: artifact.files,
      members: artifact.members,
      manifest,
      parserAssets: assets,
      policy,
      qualityVersions,
      evidence,
      ...hashes,
    });
    const metadataContents = `${JSON.stringify(metadata, null, 2)}\n`;
    writeFileSync(resolve(output, "release-metadata.json"), metadataContents, "utf8");
    const checksums = [
      [filename, hashes.sha256],
      ...Object.entries(evidence).map(([name, record]) => [name, record.sha256]),
      ["release-metadata.json", evidenceHash(metadataContents)],
    ]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, hash]) => `${hash}  ${name}`)
      .join("\n");
    writeFileSync(resolve(output, "SHA256SUMS.txt"), `${checksums}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
    return metadata;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  await buildReleaseArtifact();
}
