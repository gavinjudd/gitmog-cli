import { spawn, spawnSync } from "node:child_process";
import { posix, win32 } from "node:path";

import { paths } from "./paths.mjs";

/** Runs a command and captures its output. Never throws on a non-zero exit. */
export function capture(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    cwd: options.cwd ?? paths.root,
    env: options.env ?? process.env,
    encoding: options.encoding ?? "utf8",
    shell: false,
  });
  return {
    code: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    signal: result.signal,
    error: result.error,
  };
}

/** Runs a command with inherited stdio. Returns the exit code. */
export function runInherit(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    cwd: options.cwd ?? paths.root,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
    shell: false,
  });
  if (result.error !== undefined) {
    return { code: 1, error: result.error };
  }
  return { code: result.status ?? 1 };
}

/** Spawns a long-lived child process. */
export function spawnDetachedChild(command, args, options = {}) {
  return spawn(command, args, {
    ...options,
    cwd: options.cwd ?? paths.root,
    env: options.env ?? process.env,
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    shell: false,
  });
}

export function commandAvailable(command, args = ["--version"]) {
  const result = capture(command, args);
  return result.code === 0;
}

export function prependPath(directory, env = process.env) {
  return prependPathForPlatform(directory, env, process.platform);
}

export function prependPathForPlatform(directory, env, platform) {
  const pathApi = platform === "win32" ? win32 : posix;
  const pathKeys = Object.keys(env).filter((key) => key.toLowerCase() === "path");
  const pathKey = pathKeys[0] ?? (platform === "win32" ? "Path" : "PATH");
  const normalize = (entry) => (platform === "win32" ? entry.toLowerCase() : entry);
  const seen = new Set();
  const entries = [];
  for (const entry of [
    directory,
    ...pathKeys.flatMap((key) => (env[key] ?? "").split(pathApi.delimiter)),
  ]) {
    if (entry === "") continue;
    const normalized = normalize(entry);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    entries.push(entry);
  }

  const result = { ...env };
  for (const key of pathKeys) delete result[key];
  result[pathKey] = entries.join(pathApi.delimiter);
  return result;
}
