#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertReleaseTag } from "./check-release.mjs";
import { buildExternalTarball, packageAcceptanceEnvironment } from "./lib/package-acceptance.mjs";
import { captureNodeCli, resolveNpmEntrypoints } from "./lib/package-manager.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
export const RELEASE_BUILD_TARGETS = Object.freeze(["@gitmog/cli", "gitmog"]);

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
      files: [...input.files].sort(),
      dependencies: {},
    },
    hashes: {
      sha1: input.sha1,
      sha256: input.sha256,
      integrity: input.integrity,
    },
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

  const manifest = JSON.parse(
    readFileSync(resolve(root, "packages/distribution/package.json"), "utf8"),
  );
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
      { ...process.env, GITHUB_TOKEN: "", NO_COLOR: "1" },
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
    const metadata = releaseMetadata({
      commit,
      version: manifest.version,
      filename,
      bytes: artifact.bytes,
      files: artifact.files,
      ...hashes,
    });
    writeFileSync(resolve(output, "SHA256SUMS.txt"), `${hashes.sha256}  ${filename}\n`, "utf8");
    writeFileSync(
      resolve(output, "release-metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
    return metadata;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  await buildReleaseArtifact();
}
