import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";

import { collectProfileSnapshot } from "@gitmog/github";
import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
} from "@gitmog/test-fixtures/github-personas";
import { afterEach, describe, expect, it } from "vitest";

import {
  CACHE_MARKER_NAME,
  MAX_CACHE_BYTES,
  clearCache,
  enforceCacheCeiling,
  inspectCache,
  prepareCacheRoot,
} from "../src/cache-control.js";
import { createFileSnapshotCache, isProfileSnapshot } from "../src/snapshot-store.js";

const temporaryDirectories: string[] = [];
const scratch = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "gitmog-cache-control-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    try {
      chmodSync(directory, 0o700);
    } catch {
      // The clear-cache case removes the root on purpose.
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

const safeHome = join(parse(tmpdir()).root, "gitmog-safe-home");
const safeRepository = join(parse(tmpdir()).root, "gitmog-safe-repository");

const optionsFor = (directory: string) => ({
  directory,
  home: safeHome,
  cwd: safeRepository,
  platform: process.platform,
  now: () => FIXTURE_NOW_MS,
});

const populateSnapshot = async (directory: string, key = "fixture"): Promise<string> => {
  const collected = await collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
    fetchImpl: createFixtureFetch(PERSONAS.strongMaintainer),
    cache: null,
    now: () => FIXTURE_NOW_MS,
  });
  if (!collected.ok) throw new Error(collected.error.code);
  const snapshotDirectory = join(directory, "snapshots");
  const before = new Set(existsSync(snapshotDirectory) ? readdirSync(snapshotDirectory) : []);
  createFileSnapshotCache({ directory: snapshotDirectory, now: () => FIXTURE_NOW_MS }).set(
    key,
    collected.snapshot,
  );
  const file = readdirSync(snapshotDirectory).find(
    (name) => name.endsWith(".json") && !before.has(name),
  );
  if (file === undefined) throw new Error("Snapshot fixture was not written.");
  return join(snapshotDirectory, file);
};

const populateLegacyCache = async (directory: string): Promise<void> => {
  const collected = await collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
    fetchImpl: createFixtureFetch(PERSONAS.strongMaintainer),
    cache: null,
    now: () => FIXTURE_NOW_MS,
  });
  if (!collected.ok) throw new Error(collected.error.code);
  const historicalSnapshot = JSON.parse(JSON.stringify(collected.snapshot)) as {
    budget: { maxRequests: number };
  };
  historicalSnapshot.budget.maxRequests = 32;
  expect(isProfileSnapshot(historicalSnapshot)).toBe(false);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${"b".repeat(32)}.json`),
    JSON.stringify({
      expiresAt: FIXTURE_NOW_MS + 60_000,
      snapshot: historicalSnapshot,
    }),
    "utf8",
  );
  const retired = join(directory, "retired");
  mkdirSync(retired);
  writeFileSync(
    join(retired, `${"a".repeat(64)}.retired-profile.json`),
    JSON.stringify({
      expiresAt: FIXTURE_NOW_MS + 60_000,
      value: { features: { functionCount: 2 } },
    }),
    "utf8",
  );
};

describe("cache control", () => {
  it("reports an absent cache without creating it", () => {
    const directory = join(scratch(), "missing");
    const result = inspectCache(optionsFor(directory));
    expect(result).toEqual({
      ok: true,
      value: {
        path: directory,
        totalBytes: 0,
        fileCount: 0,
        maximumBytes: 25 * 1024 * 1024,
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
    expect(existsSync(directory)).toBe(false);
  });

  it("removes corrupt and interrupted entries during inspection", () => {
    const directory = join(scratch(), "cache");
    expect(prepareCacheRoot(optionsFor(directory)).ok).toBe(true);
    const snapshots = join(directory, "snapshots");
    mkdirSync(snapshots);
    const corrupt = join(snapshots, `${"a".repeat(32)}.json`);
    const interrupted = join(snapshots, `${"b".repeat(32)}.json.tmp`);
    writeFileSync(corrupt, "{broken", "utf8");
    writeFileSync(interrupted, "partial", "utf8");
    const inspected = inspectCache(optionsFor(directory));
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.value.expiredOrCorruptEntriesRemoved).toBe(2);
    expect(inspected.value.snapshotEntries).toBe(0);
    expect(existsSync(corrupt)).toBe(false);
    expect(existsSync(interrupted)).toBe(false);
  });

  it("keeps exactly 25 MiB and prunes one byte over the hard cap", async () => {
    const directory = join(scratch(), "cache");
    expect(prepareCacheRoot(optionsFor(directory)).ok).toBe(true);
    const snapshot = await populateSnapshot(directory);
    const markerBytes = statSync(join(directory, CACHE_MARKER_NAME)).size;
    const original = readFileSync(snapshot, "utf8");
    const exactSnapshotBytes = MAX_CACHE_BYTES - markerBytes;
    writeFileSync(
      snapshot,
      original + " ".repeat(exactSnapshotBytes - Buffer.byteLength(original)),
    );

    const exact = enforceCacheCeiling(optionsFor(directory));
    expect(exact.ok).toBe(true);
    if (!exact.ok) return;
    expect(exact.value.totalBytes).toBe(MAX_CACHE_BYTES);
    expect(existsSync(snapshot)).toBe(true);

    writeFileSync(snapshot, `${readFileSync(snapshot, "utf8")} `);
    const over = enforceCacheCeiling(optionsFor(directory));
    expect(over.ok).toBe(true);
    if (!over.ok) return;
    expect(over.value.totalBytes).toBeLessThanOrEqual(MAX_CACHE_BYTES);
    expect(over.value.snapshotEntries).toBe(0);
    expect(existsSync(snapshot)).toBe(false);
  });

  it("prunes validated least-recently-used bytes rather than filename order", async () => {
    const directory = join(scratch(), "cache");
    expect(prepareCacheRoot(optionsFor(directory)).ok).toBe(true);
    const first = await populateSnapshot(directory, "first-key");
    const second = await populateSnapshot(directory, "second-key");
    for (const path of [first, second]) {
      const original = readFileSync(path, "utf8");
      writeFileSync(path, original + " ".repeat(14 * 1024 * 1024 - Buffer.byteLength(original)));
    }
    const oldest = new Date(FIXTURE_NOW_MS - 2_000);
    const newest = new Date(FIXTURE_NOW_MS - 1_000);
    utimesSync(first, oldest, oldest);
    utimesSync(second, newest, newest);

    const enforced = enforceCacheCeiling(optionsFor(directory));
    expect(enforced.ok).toBe(true);
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(true);
  });

  it("refuses roots, home, repository, tooling, and npm cache paths", () => {
    for (const directory of [
      parse(tmpdir()).root,
      safeHome,
      safeRepository,
      join(safeRepository, ".gitmog", "cache"),
    ]) {
      expect(prepareCacheRoot(optionsFor(directory)).ok, directory).toBe(false);
    }
    const npmCache = join(tmpdir(), "gitmog-npm-cache");
    expect(
      prepareCacheRoot({
        ...optionsFor(join(npmCache, "gitmog")),
        npmCacheDirectories: [npmCache],
      }).ok,
    ).toBe(false);
  });

  it("refuses a symlink without touching its external target", () => {
    const parent = scratch();
    const directory = join(parent, "cache");
    const outside = join(parent, "outside");
    mkdirSync(outside);
    const sentinel = join(outside, "sentinel.txt");
    writeFileSync(sentinel, "keep", "utf8");
    expect(prepareCacheRoot(optionsFor(directory)).ok).toBe(true);
    const snapshots = join(directory, "snapshots");
    mkdirSync(snapshots);
    symlinkSync(outside, join(snapshots, "escape"));

    const cleared = clearCache({ ...optionsFor(directory), allowLegacy: true });
    expect(cleared.ok).toBe(false);
    expect(readFileSync(sentinel, "utf8")).toBe("keep");
    expect(lstatSync(join(snapshots, "escape")).isSymbolicLink()).toBe(true);
  });

  it("removes a strictly validated legacy layout only for the default cache root", async () => {
    const refusedDirectory = join(scratch(), "cache");
    await populateLegacyCache(refusedDirectory);
    expect(inspectCache(optionsFor(refusedDirectory)).ok).toBe(false);
    expect(existsSync(refusedDirectory)).toBe(true);

    const futureDirectory = join(scratch(), "cache");
    await populateLegacyCache(futureDirectory);
    const futureSnapshot = join(futureDirectory, `${"b".repeat(32)}.json`);
    const futureEntry = JSON.parse(readFileSync(futureSnapshot, "utf8")) as {
      expiresAt: number;
      snapshot: unknown;
    };
    writeFileSync(
      futureSnapshot,
      JSON.stringify({
        ...futureEntry,
        expiresAt: FIXTURE_NOW_MS + 366 * 24 * 60 * 60 * 1000,
      }),
      "utf8",
    );
    expect(inspectCache({ ...optionsFor(futureDirectory), allowLegacy: true }).ok).toBe(false);
    expect(existsSync(futureDirectory)).toBe(true);

    const inspectedDirectory = join(scratch(), "cache");
    await populateLegacyCache(inspectedDirectory);
    const inspected = inspectCache({ ...optionsFor(inspectedDirectory), allowLegacy: true });
    expect(inspected).toMatchObject({
      ok: true,
      value: { fileCount: 0, totalBytes: 0, expiredOrCorruptEntriesRemoved: 2 },
    });
    expect(existsSync(inspectedDirectory)).toBe(false);

    const clearedDirectory = join(scratch(), "cache");
    await populateLegacyCache(clearedDirectory);
    const cleared = clearCache({ ...optionsFor(clearedDirectory), allowLegacy: true });
    expect(cleared).toMatchObject({ ok: true, value: { filesRemoved: 2 } });
    if (!cleared.ok) return;
    expect(cleared.value.bytesRemoved).toBeGreaterThan(0);
    expect(existsSync(clearedDirectory)).toBe(false);

    const preparedDirectory = join(scratch(), "cache");
    await populateLegacyCache(preparedDirectory);
    expect(prepareCacheRoot({ ...optionsFor(preparedDirectory), allowLegacy: true })).toMatchObject(
      { ok: true, value: preparedDirectory },
    );
    expect(inspectCache(optionsFor(preparedDirectory))).toMatchObject({
      ok: true,
      value: { fileCount: 1, totalBytes: 16, expiredOrCorruptEntriesRemoved: 0 },
    });
  });

  it("clears the exact owned cache and is idempotent", async () => {
    const directory = join(scratch(), "cache");
    expect(prepareCacheRoot(optionsFor(directory)).ok).toBe(true);
    await populateSnapshot(directory);
    const first = clearCache(optionsFor(directory));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.filesRemoved).toBe(2);
    expect(first.value.bytesRemoved).toBeGreaterThan(0);
    expect(existsSync(directory)).toBe(false);
    expect(clearCache(optionsFor(directory))).toEqual({
      ok: true,
      value: { path: directory, bytesRemoved: 0, filesRemoved: 0 },
    });
  });

  it("keeps inspection and enforcement nonfatal on a read-only cache", () => {
    const directory = join(scratch(), "cache");
    expect(prepareCacheRoot(optionsFor(directory)).ok).toBe(true);
    chmodSync(directory, 0o500);
    expect(inspectCache(optionsFor(directory)).ok).toBe(true);
    expect(enforceCacheCeiling(optionsFor(directory)).ok).toBe(true);
    chmodSync(directory, 0o700);
  });
});
