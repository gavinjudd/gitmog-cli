import { existsSync, rmSync } from "node:fs";
import { posix, resolve, win32 } from "node:path";

import { capture, runInherit, spawnDetachedChild } from "./exec.mjs";
import { paths } from "./paths.mjs";

const pathApiFor = (platform) => (platform === "win32" ? win32 : posix);

function unique(values) {
  return [...new Set(values)];
}

export function npmCliCandidates({
  platform = process.platform,
  executablePath = process.execPath,
} = {}) {
  const pathApi = pathApiFor(platform);
  const executableDirectory = pathApi.dirname(executablePath);
  return unique([
    pathApi.join(executableDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    pathApi.join(
      pathApi.dirname(executableDirectory),
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ]);
}

function missingCliError(logicalTool, candidates, platform, remediation) {
  const error = new Error(
    [
      `Could not resolve ${logicalTool} JavaScript CLI on ${platform}.`,
      `Attempted safe entry points: ${candidates.join(", ")}.`,
      "Underlying error code: ENOENT.",
      remediation,
    ].join(" "),
  );
  error.code = "ENOENT";
  return error;
}

export function resolveNpmCli(options = {}) {
  const platform = options.platform ?? process.platform;
  const candidates = npmCliCandidates(options);
  const fileExists = options.fileExists ?? existsSync;
  const entrypoint = candidates.find((candidate) => fileExists(candidate));
  if (entrypoint === undefined) {
    throw missingCliError(
      "npm",
      candidates,
      platform,
      "Activate the pinned Node distribution with bundled npm, then rerun bootstrap; do not install pnpm globally.",
    );
  }
  return entrypoint;
}

export function resolveNpmEntrypoints(options = {}) {
  const platform = options.platform ?? process.platform;
  const pathApi = pathApiFor(platform);
  const fileExists = options.fileExists ?? existsSync;
  const npmCli = resolveNpmCli(options);
  const npxCli = pathApi.join(pathApi.dirname(npmCli), "npx-cli.js");
  if (!fileExists(npxCli)) {
    throw missingCliError(
      "npx",
      [npxCli],
      platform,
      "Activate the pinned Node distribution with bundled npm/npx, then rerun the acceptance command.",
    );
  }
  return { npmCli, npxCli };
}

export function workspacePnpmCliPath(
  toolingDirectory = paths.toolingDir,
  { platform = process.platform } = {},
) {
  return pathApiFor(platform).join(toolingDirectory, "node_modules", "pnpm", "bin", "pnpm.cjs");
}

export function legacyWorkspacePnpmCliPath(
  toolingDirectory = paths.toolingDir,
  { platform = process.platform } = {},
) {
  return pathApiFor(platform).join(
    toolingDirectory,
    "lib",
    "node_modules",
    "pnpm",
    "bin",
    "pnpm.cjs",
  );
}

export function pnpmToolingLayout(
  toolingDirectory = paths.toolingDir,
  { platform = process.platform, fileExists = existsSync } = {},
) {
  if (fileExists(workspacePnpmCliPath(toolingDirectory, { platform }))) return "current";
  if (fileExists(legacyWorkspacePnpmCliPath(toolingDirectory, { platform }))) return "legacy";
  return fileExists(toolingDirectory) ? "partial" : "absent";
}

export function resetPnpmToolingDirectory(
  toolingDirectory = paths.toolingDir,
  { allowedToolingDirectory = paths.toolingDir, remove = rmSync } = {},
) {
  const target = resolve(toolingDirectory);
  const allowed = resolve(allowedToolingDirectory);
  if (target !== allowed) {
    throw new Error(`Refusing to remove pnpm tooling outside ${allowed}: ${target}`);
  }
  remove(target, { recursive: true, force: true });
}

export function resolveWorkspacePnpmCli({
  toolingDirectory = paths.toolingDir,
  platform = process.platform,
  fileExists = existsSync,
} = {}) {
  const entrypoint = workspacePnpmCliPath(toolingDirectory, { platform });
  if (!fileExists(entrypoint)) {
    throw missingCliError(
      "workspace-local pnpm",
      [entrypoint],
      platform,
      "Run node scripts/bootstrap.mjs to install the pinned pnpm inside this workspace; do not install pnpm globally.",
    );
  }
  return entrypoint;
}

export function nodeCliInvocation(
  entrypoint,
  args = [],
  { executablePath = process.execPath } = {},
) {
  return { command: executablePath, args: [entrypoint, ...args] };
}

export function captureNodeCli(logicalTool, entrypoint, args = [], options = {}) {
  const invocation = nodeCliInvocation(entrypoint, args, options);
  const { executablePath: _executablePath, ...spawnOptions } = options;
  return {
    logicalTool,
    entrypoint,
    ...capture(invocation.command, invocation.args, spawnOptions),
  };
}

export function runNodeCliInherit(logicalTool, entrypoint, args = [], options = {}) {
  const invocation = nodeCliInvocation(entrypoint, args, options);
  const { executablePath: _executablePath, ...spawnOptions } = options;
  return {
    logicalTool,
    entrypoint,
    ...runInherit(invocation.command, invocation.args, spawnOptions),
  };
}

export function spawnNodeCli(logicalTool, entrypoint, args = [], options = {}) {
  if (logicalTool === "") throw new Error("A logical tool name is required.");
  const invocation = nodeCliInvocation(entrypoint, args, options);
  const { executablePath: _executablePath, ...spawnOptions } = options;
  return spawnDetachedChild(invocation.command, invocation.args, spawnOptions);
}

export function nodeCliVersion(logicalTool, entrypoint, options = {}) {
  const result = captureNodeCli(logicalTool, entrypoint, ["--version"], options);
  return result.code === 0 ? result.stdout : undefined;
}

export function describeNodeCliFailure(
  logicalTool,
  entrypoint,
  result,
  platform = process.platform,
) {
  const errorCode = result.error?.code ?? result.code;
  return `${logicalTool} failed through ${entrypoint} on ${platform} (error code ${String(errorCode)}).`;
}

function escapePowerShellDoubleQuoted(value) {
  return value.replaceAll("`", "``").replaceAll("$", "`$").replaceAll('"', '`"');
}

function escapePosixDoubleQuoted(value) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("$", "\\$")
    .replaceAll("`", "\\`");
}

export function formatWorkspaceBinPathInstruction(
  directory = paths.toolingPnpmBinDir,
  { platform = process.platform } = {},
) {
  const pathApi = pathApiFor(platform);
  if (platform === "win32") {
    return `$env:Path = "${escapePowerShellDoubleQuoted(directory)}${pathApi.delimiter}$env:Path"`;
  }
  return `export PATH="${escapePosixDoubleQuoted(directory)}${pathApi.delimiter}$PATH"`;
}
