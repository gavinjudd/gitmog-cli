import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { run, type CliContext } from "../src/cli.js";

const temporaryDirectories: string[] = [];
const safeHome = join(parse(tmpdir()).root, "gitmog-safe-home");
const safeRepository = join(parse(tmpdir()).root, "gitmog-safe-repository");
const scratch = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "gitmog-cache-command-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const invoke = async (directory: string, ...args: readonly string[]) => {
  let fetchCalls = 0;
  let allowanceCalls = 0;
  let authorizationCalls = 0;
  const context: CliContext = {
    invokedAs: "gitmog",
    version: "0.2.2",
    env: { GITMOG_CACHE_DIR: directory },
    home: safeHome,
    cwd: safeRepository,
    platform: process.platform,
    fetchImpl: () => {
      fetchCalls += 1;
      throw new Error("Cache commands must not fetch.");
    },
    readAllowance: () => {
      allowanceCalls += 1;
      throw new Error("Cache commands must not read GitHub allowance.");
    },
    authorizeDevice: () => {
      authorizationCalls += 1;
      throw new Error("Cache commands must not authorize.");
    },
  };
  const result = await run(["node", "gitmog", ...args], context);
  return { result, fetchCalls, allowanceCalls, authorizationCalls };
};

describe("local cache commands", () => {
  it("reports human cache usage with zero network or auth calls", async () => {
    const directory = join(scratch(), "cache");
    const execution = await invoke(directory, "--cache-info");
    expect(execution.result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(execution.result.stdout).toContain("GIT MOG CACHE");
    expect(execution.result.stdout).toContain(`Path: ${directory}`);
    expect(execution.result.stdout).toContain("Maximum: 26214400 bytes (25 MiB)");
    expect(execution.result.stdout).toContain("Raw source is never stored.");
    expect(execution.result.stdout).toContain("npm's cache is separate");
    expect([execution.fetchCalls, execution.allowanceCalls, execution.authorizationCalls]).toEqual([
      0, 0, 0,
    ]);
    expect(existsSync(directory)).toBe(false);
  });

  it("returns stable JSON for info and idempotent clear", async () => {
    const directory = join(scratch(), "cache");
    const info = await invoke(directory, "--cache-info", "--json");
    expect(info.result.stderr).toBe("");
    expect(JSON.parse(info.result.stdout)).toEqual({
      cache: {
        action: "info",
        path: directory,
        totalBytes: 0,
        fileCount: 0,
        maximumBytes: 26_214_400,
        oldestValidEntryAt: null,
        newestValidEntryAt: null,
        expiredOrCorruptEntriesRemoved: 0,
        snapshotEntries: 0,
        analysisEntries: 0,
        derivedFeatureEntries: 0,
        rawSourceStored: false,
        npmCacheControlled: false,
      },
    });
    for (let index = 0; index < 2; index += 1) {
      const cleared = await invoke(directory, "--clear-cache", "--json");
      expect(cleared.result.stderr).toBe("");
      expect(JSON.parse(cleared.result.stdout)).toEqual({
        cache: { action: "clear", path: directory, bytesRemoved: 0, filesRemoved: 0 },
      });
    }
  });

  it("rejects handles, conflicting local flags, and other options before any call", async () => {
    for (const args of [
      ["alice", "--cache-info"],
      ["--cache-info", "--clear-cache"],
      ["--cache-info", "--refresh"],
    ]) {
      const execution = await invoke(join(scratch(), "cache"), ...args);
      expect(execution.result.exitCode, args.join(" ")).toBe(2);
      expect([
        execution.fetchCalls,
        execution.allowanceCalls,
        execution.authorizationCalls,
      ]).toEqual([0, 0, 0]);
    }
  });

  it("returns JSON-only refusal for an unsafe root", async () => {
    const execution = await invoke(parse(tmpdir()).root, "--clear-cache", "--json");
    expect(execution.result).toMatchObject({ exitCode: 2, stderr: "" });
    expect(JSON.parse(execution.result.stdout)).toMatchObject({
      error: { code: "cache_path_refused", retryable: false },
    });
  });
});
