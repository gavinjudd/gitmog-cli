import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { delimiter, dirname, resolve, win32 } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { prependPath, prependPathForPlatform } from "../scripts/lib/exec.mjs";
import {
  formatWorkspaceBinPathInstruction,
  legacyWorkspacePnpmCliPath,
  nodeCliInvocation,
  npmCliCandidates,
  pnpmToolingLayout,
  resetPnpmToolingDirectory,
  resolveNpmCli,
  workspaceInstallEnvironment,
  workspacePnpmCliPath,
} from "../scripts/lib/package-manager.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("path handling uses the host path.delimiter", () => {
  const result = prependPath("workspace-bin", { PATH: "existing-bin" });
  assert.equal(result.PATH, ["workspace-bin", "existing-bin"].join(delimiter));
});

test("path handling preserves an existing Windows Path key", () => {
  const result = prependPathForPlatform("C:\\workspace\\bin", { Path: "C:\\Windows" }, "win32");
  assert.deepEqual(result, { Path: "C:\\workspace\\bin;C:\\Windows" });
});

test("path handling preserves an existing uppercase PATH key", () => {
  const result = prependPathForPlatform("C:\\workspace\\bin", { PATH: "C:\\Windows" }, "win32");
  assert.deepEqual(result, { PATH: "C:\\workspace\\bin;C:\\Windows" });
});

test("path handling coalesces duplicate case variants without losing entries", () => {
  const result = prependPathForPlatform(
    "C:\\workspace\\bin",
    { Path: "C:\\Windows", PATH: "C:\\Tools;C:\\Windows", KEEP: "yes" },
    "win32",
  );
  assert.deepEqual(
    Object.keys(result).filter((key) => key.toLowerCase() === "path"),
    ["Path"],
  );
  assert.equal(result.Path, "C:\\workspace\\bin;C:\\Windows;C:\\Tools");
  assert.equal(result.KEEP, "yes");
});

test("path handling does not append an empty entry", () => {
  assert.deepEqual(prependPathForPlatform("/workspace/bin", {}, "linux"), {
    PATH: "/workspace/bin",
  });
  assert.deepEqual(prependPathForPlatform("C:\\workspace\\bin", { Path: "" }, "win32"), {
    Path: "C:\\workspace\\bin",
  });
});

test("npm resolves from an injected Windows fnm-style Node layout", () => {
  const executablePath = "C:\\Users\\dev\\AppData\\Local\\fnm_multishells\\session\\node.exe";
  const expected = win32.join(
    win32.dirname(executablePath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  assert.equal(
    resolveNpmCli({
      platform: "win32",
      executablePath,
      env: {},
      fileExists: (candidate) => candidate === expected,
    }),
    expected,
  );
});

test("npm resolves from the accepted POSIX Node layout", () => {
  const expected = "/opt/node/lib/node_modules/npm/bin/npm-cli.js";
  assert.equal(
    resolveNpmCli({
      platform: "darwin",
      executablePath: "/opt/node/bin/node",
      env: {},
      fileExists: (candidate) => candidate === expected,
    }),
    expected,
  );
  assert.ok(
    npmCliCandidates({
      platform: "linux",
      executablePath: "/opt/node/bin/node",
      env: {},
    }).includes(expected),
  );
});

test("missing npm reports the tool, entrypoints, OS, code and local remediation", () => {
  assert.throws(
    () =>
      resolveNpmCli({
        platform: "win32",
        executablePath: "C:\\node\\node.exe",
        env: {},
        fileExists: () => false,
      }),
    /npm JavaScript CLI.*win32.*npm-cli\.js.*ENOENT.*do not install pnpm globally/i,
  );
});

test("workspace pnpm uses the same controlled pnpm.cjs purpose across platforms", () => {
  assert.equal(
    workspacePnpmCliPath("C:\\repo\\.gitmog\\tooling\\pnpm", { platform: "win32" }),
    "C:\\repo\\.gitmog\\tooling\\pnpm\\node_modules\\pnpm\\bin\\pnpm.cjs",
  );
  assert.equal(
    workspacePnpmCliPath("/repo/.gitmog/tooling/pnpm", { platform: "linux" }),
    "/repo/.gitmog/tooling/pnpm/node_modules/pnpm/bin/pnpm.cjs",
  );
});

test("pnpm.cjs is invoked through the injected Node executable", () => {
  assert.deepEqual(
    nodeCliInvocation("C:\\repo\\pnpm.cjs", ["run", "verify"], {
      executablePath: "C:\\node\\node.exe",
    }),
    {
      command: "C:\\node\\node.exe",
      args: ["C:\\repo\\pnpm.cjs", "run", "verify"],
    },
  );
});

test("bootstrap makes --ci dependency installation noninteractive", () => {
  assert.deepEqual(workspaceInstallEnvironment(true, { KEEP: "yes", CI: "false" }), {
    KEEP: "yes",
    CI: "true",
  });
  assert.deepEqual(workspaceInstallEnvironment(false, { KEEP: "yes" }), { KEEP: "yes" });
});

test("legacy pnpm tooling is recognized and replacement is confined", () => {
  const tooling = resolve(root, ".gitmog", "tooling", "pnpm");
  const legacy = legacyWorkspacePnpmCliPath(tooling);
  assert.equal(
    pnpmToolingLayout(tooling, {
      fileExists: (candidate) => candidate === legacy,
    }),
    "legacy",
  );

  const removed = [];
  resetPnpmToolingDirectory(tooling, {
    allowedToolingDirectory: tooling,
    remove: (target) => removed.push(target),
  });
  assert.deepEqual(removed, [tooling]);
  assert.throws(
    () =>
      resetPnpmToolingDirectory(resolve(root, ".gitmog"), {
        allowedToolingDirectory: tooling,
        remove: (target) => removed.push(target),
      }),
    /Refusing to remove pnpm tooling outside/,
  );
  assert.deepEqual(removed, [tooling]);
});

const executionSources = [
  "scripts/bootstrap.mjs",
  "scripts/doctor.mjs",
  "scripts/identity-calibrate.mjs",
  "scripts/code-dna-calibrate.mjs",
  "scripts/accept-platform.mjs",
  "scripts/turbo.mjs",
  "scripts/verify.mjs",
  "scripts/lib/exec.mjs",
  "scripts/lib/package-manager.mjs",
]
  .map((file) => readFileSync(resolve(root, file), "utf8"))
  .join("\n");
const packageManifest = readFileSync(resolve(root, "package.json"), "utf8");

test("package-manager execution is shell-free and independent of command shims", () => {
  assert.doesNotMatch(executionSources, /shell:\s*true/);
  assert.doesNotMatch(executionSources, /\b(?:npm|pnpm)\.cmd\b/i);
  assert.doesNotMatch(executionSources, /(?:capture|runInherit|spawnSync)\(["'](?:npm|pnpm)["']/);
  assert.doesNotMatch(packageManifest, /"(?:lint|typecheck|test|build)":\s*"turbo\b/);
  assert.doesNotMatch(packageManifest, /"verify":\s*"pnpm\b/);
});

test("bootstrap prints native PowerShell syntax on win32", () => {
  assert.equal(
    formatWorkspaceBinPathInstruction("C:\\repo\\.gitmog\\tooling\\pnpm\\node_modules\\.bin", {
      platform: "win32",
    }),
    '$env:Path = "C:\\repo\\.gitmog\\tooling\\pnpm\\node_modules\\.bin;$env:Path"',
  );
});

test("bootstrap retains export syntax on macOS and Linux", () => {
  for (const platform of ["darwin", "linux"]) {
    assert.equal(
      formatWorkspaceBinPathInstruction("/repo/.gitmog/tooling/pnpm/node_modules/.bin", {
        platform,
      }),
      'export PATH="/repo/.gitmog/tooling/pnpm/node_modules/.bin:$PATH"',
    );
  }
});
