import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, posix, relative, win32 } from "node:path";

import {
  DEFAULT_SNAPSHOT_TTL_MS,
  PROFILE_SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_CACHE_KEY_VERSION,
  digest,
  stableStringify,
} from "@gitmog/github";
import {
  DEFAULT_CODE_DNA_TTL_MS,
  DEFAULT_DERIVED_FEATURE_TTL_MS,
  isCodeDnaCacheEntry,
  isDerivedCacheSafe,
  isDerivedFeatureEntry,
} from "@gitmog/source-analysis";
import {
  DEFAULT_QUALITY_RESULT_TTL_MS,
  isQualityCacheSafe,
  isQualityJudgeResult,
} from "@gitmog/quality-judge";

import { isProfileSnapshot } from "./snapshot-store.js";

export const MAX_CACHE_BYTES = 25 * 1024 * 1024;
export const CACHE_MARKER_NAME = ".gitmog-cache-v1";
const CACHE_MARKER_CONTENT = "gitmog-cache-v1\n";
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const EXPECTED_DIRECTORIES = new Set(["snapshots", "analysis", "features", "quality"]);

type CacheKind = "snapshot" | "analysis" | "feature" | "quality";

interface CacheEntry {
  readonly path: string;
  readonly kind: CacheKind;
  readonly bytes: number;
  readonly createdAt: number;
  readonly lastUsedAt: number;
}

export interface CacheInspection {
  readonly path: string;
  readonly totalBytes: number;
  readonly fileCount: number;
  readonly maximumBytes: typeof MAX_CACHE_BYTES;
  readonly oldestValidEntryAt: string | null;
  readonly newestValidEntryAt: string | null;
  readonly expiredOrCorruptEntriesRemoved: number;
  readonly snapshotEntries: number;
  readonly analysisEntries: number;
  readonly derivedFeatureEntries: number;
  readonly qualityEntries: number;
  readonly rawSourceStored: false;
  readonly npmCacheControlled: false;
}

export interface CacheClearResult {
  readonly path: string;
  readonly bytesRemoved: number;
  readonly filesRemoved: number;
}

export interface CacheRootOptions {
  readonly directory: string;
  readonly home?: string | undefined;
  readonly cwd?: string | undefined;
  readonly platform?: string | undefined;
  readonly npmCacheDirectories?: readonly string[] | undefined;
  readonly now?: (() => number) | undefined;
  /** Permit strict migration only for the platform-default Git Mog cache root. */
  readonly allowLegacy?: boolean | undefined;
}

type CacheOperationResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

const exactRecord = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const sha256 = (value: unknown): string =>
  createHash("sha256").update(stableStringify(value)).digest("hex");

const pathApiFor = (platform: string) => (platform === "win32" ? win32 : posix);

const normalizeForComparison = (value: string, platform: string): string => {
  const pathApi = pathApiFor(platform);
  const normalized = pathApi.resolve(value).replace(/[\\/]+$/u, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
};

const containsPath = (parent: string, child: string, platform: string): boolean => {
  const pathApi = pathApiFor(platform);
  const normalizedParent = normalizeForComparison(parent, platform);
  const normalizedChild = normalizeForComparison(child, platform);
  const nested = pathApi.relative(normalizedParent, normalizedChild);
  return nested === "" || (!nested.startsWith("..") && !pathApi.isAbsolute(nested));
};

function validateCacheRoot(options: CacheRootOptions): CacheOperationResult<string> {
  const platform = options.platform ?? process.platform;
  const pathApi = pathApiFor(platform);
  const raw = options.directory.trim();
  if (raw === "") return { ok: false, error: "The Git Mog cache path is empty." };
  const directory = pathApi.resolve(raw);
  const home = pathApi.resolve(options.home ?? homedir());
  const cwd = pathApi.resolve(options.cwd ?? process.cwd());
  const parsed = pathApi.parse(directory);
  if (
    normalizeForComparison(directory, platform) === normalizeForComparison(parsed.root, platform)
  ) {
    return { ok: false, error: "Git Mog refuses to use a filesystem or drive root as its cache." };
  }
  if (containsPath(directory, home, platform)) {
    return { ok: false, error: "Git Mog refuses a cache path that contains the home directory." };
  }
  if (containsPath(directory, cwd, platform)) {
    return { ok: false, error: "Git Mog refuses a cache path that contains the repository." };
  }
  const tooling = pathApi.join(cwd, ".gitmog");
  if (containsPath(tooling, directory, platform) || containsPath(directory, tooling, platform)) {
    return { ok: false, error: "Git Mog refuses to use its tooling directory as a cache." };
  }
  for (const npmDirectory of options.npmCacheDirectories ?? []) {
    if (
      npmDirectory.trim() !== "" &&
      (containsPath(directory, npmDirectory, platform) ||
        containsPath(npmDirectory, directory, platform))
    ) {
      return { ok: false, error: "Git Mog refuses to use npm's cache as its own cache." };
    }
  }
  return { ok: true, value: directory };
}

const markerPath = (directory: string): string => join(directory, CACHE_MARKER_NAME);

function expectedRootShape(directory: string): boolean {
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === CACHE_MARKER_NAME) {
        if (
          !entry.isFile() ||
          readFileSync(join(directory, entry.name), "utf8") !== CACHE_MARKER_CONTENT
        ) {
          return false;
        }
        continue;
      }
      if (!EXPECTED_DIRECTORIES.has(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function cacheRootOwned(directory: string): boolean {
  if (!existsSync(directory)) return true;
  try {
    const root = lstatSync(directory);
    if (!root.isDirectory() || root.isSymbolicLink()) return false;
    if (existsSync(markerPath(directory))) {
      const marker = lstatSync(markerPath(directory));
      if (!marker.isFile() || marker.isSymbolicLink()) return false;
      return readFileSync(markerPath(directory), "utf8") === CACHE_MARKER_CONTENT;
    }
    return expectedRootShape(directory);
  } catch {
    return false;
  }
}

interface LegacyCacheLayout {
  readonly files: readonly { readonly path: string; readonly bytes: number }[];
  readonly directories: readonly string[];
}

const LEGACY_SNAPSHOT_NAME = /^[0-9a-f]{32}\.json$/u;
const LEGACY_DIRECTORY_NAME = /^[a-z][a-z0-9-]{0,63}$/u;
const MAX_LEGACY_ENTRY_BYTES = 2 * 1024 * 1024;

const LEGACY_PROFILE_SNAPSHOT_KEYS = [
  "snapshotKey",
  "collectedAt",
  "referenceDate",
  "profile",
  "repositories",
  "repositoryListComplete",
  "eligibleRepositoryCount",
  "selectedRepositories",
  "inspections",
  "events",
  "eventsAvailable",
  "eventWindow",
  "commitSample",
  "budget",
  "rateLimit",
  "degradations",
] as const;
const LEGACY_PROFILE_KEYS = [
  "login",
  "id",
  "name",
  "avatarUrl",
  "htmlUrl",
  "bio",
  "publicRepos",
  "followers",
  "createdAt",
  "accountType",
] as const;

/** Historical snapshots are never reused. This proves their exact Git Mog envelope,
 * deterministic evidence digest, bounded collection shape, and persistence safety
 * before the platform-default legacy root may be removed. */
const legacyProfileSnapshot = (value: unknown): boolean => {
  if (!exactRecord(value, LEGACY_PROFILE_SNAPSHOT_KEYS) || !isDerivedCacheSafe(value)) {
    return false;
  }
  const eligibleRepositoryCount = value.eligibleRepositoryCount;
  if (
    typeof value.snapshotKey !== "string" ||
    !/^[0-9a-f]{32}$/u.test(value.snapshotKey) ||
    typeof value.collectedAt !== "string" ||
    !Number.isFinite(Date.parse(value.collectedAt)) ||
    typeof value.referenceDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value.referenceDate) ||
    value.referenceDate !== value.collectedAt.slice(0, 10) ||
    typeof value.repositoryListComplete !== "boolean" ||
    typeof value.eventsAvailable !== "boolean" ||
    typeof eligibleRepositoryCount !== "number" ||
    !Number.isSafeInteger(eligibleRepositoryCount) ||
    eligibleRepositoryCount < 0 ||
    !Array.isArray(value.repositories) ||
    value.repositories.length > 200 ||
    !Array.isArray(value.selectedRepositories) ||
    value.selectedRepositories.length > 5 ||
    !Array.isArray(value.inspections) ||
    value.inspections.length > 5 ||
    !Array.isArray(value.events) ||
    value.events.length > 300 ||
    !Array.isArray(value.degradations) ||
    value.degradations.length > 32 ||
    !value.selectedRepositories.every(
      (entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 100,
    ) ||
    !value.degradations.every((entry) => typeof entry === "string" && entry.length <= 1_024) ||
    !exactRecord(value.profile, LEGACY_PROFILE_KEYS) ||
    typeof value.profile.login !== "string" ||
    !/^(?!-)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(value.profile.login) ||
    !exactRecord(value.budget, [
      "maxRequests",
      "usedRequests",
      "maxInspectedRepositories",
      "inspectedRepositories",
      "exhausted",
    ]) ||
    !exactRecord(value.rateLimit, ["authenticated", "limit", "remaining", "resetAt"])
  ) {
    return false;
  }
  const budget = value.budget;
  const rateLimit = value.rateLimit;
  if (
    typeof budget.maxRequests !== "number" ||
    !Number.isSafeInteger(budget.maxRequests) ||
    budget.maxRequests < 1 ||
    budget.maxRequests > 32 ||
    typeof budget.usedRequests !== "number" ||
    !Number.isSafeInteger(budget.usedRequests) ||
    budget.usedRequests < 0 ||
    budget.usedRequests > budget.maxRequests ||
    typeof budget.maxInspectedRepositories !== "number" ||
    !Number.isSafeInteger(budget.maxInspectedRepositories) ||
    budget.maxInspectedRepositories < 1 ||
    budget.maxInspectedRepositories > 5 ||
    typeof budget.inspectedRepositories !== "number" ||
    !Number.isSafeInteger(budget.inspectedRepositories) ||
    budget.inspectedRepositories < 0 ||
    budget.inspectedRepositories > budget.maxInspectedRepositories ||
    typeof budget.exhausted !== "boolean" ||
    typeof rateLimit.authenticated !== "boolean" ||
    (rateLimit.limit !== null &&
      (typeof rateLimit.limit !== "number" || !Number.isSafeInteger(rateLimit.limit))) ||
    (rateLimit.remaining !== null &&
      (typeof rateLimit.remaining !== "number" || !Number.isSafeInteger(rateLimit.remaining))) ||
    (rateLimit.resetAt !== null &&
      (typeof rateLimit.resetAt !== "string" || !Number.isFinite(Date.parse(rateLimit.resetAt))))
  ) {
    return false;
  }
  const {
    snapshotKey,
    collectedAt: _collectedAt,
    budget: _budget,
    rateLimit: _rateLimit,
    ...evidence
  } = value;
  return digest(evidence) === snapshotKey;
};

const legacySnapshot = (path: string, now: number): boolean => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (exactRecord(parsed, ["expiresAt", "snapshot"])) {
      return (
        typeof parsed.expiresAt === "number" &&
        Number.isSafeInteger(parsed.expiresAt) &&
        parsed.expiresAt >= 0 &&
        parsed.expiresAt <= now + DEFAULT_SNAPSHOT_TTL_MS + FUTURE_CLOCK_SKEW_MS &&
        (isProfileSnapshot(parsed.snapshot) || legacyProfileSnapshot(parsed.snapshot))
      );
    }
    if (
      !exactRecord(parsed, [
        "schemaVersion",
        "cacheKeyVersion",
        "createdAt",
        "expiresAt",
        "checksum",
        "snapshot",
      ])
    )
      return false;
    if (typeof parsed.expiresAt !== "string") return false;
    const expiresAt = Date.parse(parsed.expiresAt);
    return Number.isFinite(expiresAt) && snapshotEntry(parsed, expiresAt - 1) !== null;
  } catch {
    return false;
  }
};

const legacyDerived = (path: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return (
      exactRecord(parsed, ["expiresAt", "value"]) &&
      typeof parsed.expiresAt === "number" &&
      Number.isSafeInteger(parsed.expiresAt) &&
      isDerivedCacheSafe(parsed.value)
    );
  } catch {
    return false;
  }
};

function legacyCacheLayout(directory: string, now: number): LegacyCacheLayout | null {
  try {
    const root = lstatSync(directory);
    if (!root.isDirectory() || root.isSymbolicLink()) return null;
    const entries = readdirSync(directory, { withFileTypes: true });
    if (entries.length === 0) return null;
    const files: { path: string; bytes: number }[] = [];
    const directories: string[] = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) return null;
      if (entry.isFile()) {
        const metadata = lstatSync(path);
        if (
          !LEGACY_SNAPSHOT_NAME.test(entry.name) ||
          metadata.size > MAX_LEGACY_ENTRY_BYTES ||
          !legacySnapshot(path, now)
        )
          return null;
        files.push({ path, bytes: metadata.size });
        continue;
      }
      if (!entry.isDirectory() || !LEGACY_DIRECTORY_NAME.test(entry.name)) return null;
      const children = readdirSync(path, { withFileTypes: true });
      if (children.length === 0) return null;
      const nestedName = new RegExp(
        `^[0-9a-f]{64}\\.${entry.name}-[a-z][a-z0-9-]{0,63}\\.json$`,
        "u",
      );
      for (const child of children) {
        const childPath = join(path, child.name);
        if (!child.isFile() || child.isSymbolicLink() || !nestedName.test(child.name)) return null;
        const metadata = lstatSync(childPath);
        if (metadata.size > MAX_LEGACY_ENTRY_BYTES || !legacyDerived(childPath)) return null;
        files.push({ path: childPath, bytes: metadata.size });
      }
      directories.push(path);
    }
    return { files, directories };
  } catch {
    return null;
  }
}

function removeLegacyCache(layout: LegacyCacheLayout, directory: string): boolean {
  try {
    for (const file of layout.files) rmSync(file.path, { force: true });
    for (const child of layout.directories) rmdirSync(child);
    rmdirSync(directory);
    return true;
  } catch {
    return false;
  }
}

export function prepareCacheRoot(options: CacheRootOptions): CacheOperationResult<string> {
  const validated = validateCacheRoot(options);
  if (!validated.ok) return validated;
  const directory = validated.value;
  try {
    if (existsSync(directory) && !cacheRootOwned(directory) && options.allowLegacy === true) {
      const legacy = legacyCacheLayout(directory, (options.now ?? Date.now)());
      if (legacy === null || !removeLegacyCache(legacy, directory)) {
        return { ok: false, error: "The resolved cache path is not an owned Git Mog cache." };
      }
    }
    mkdirSync(directory, { recursive: true });
    const root = lstatSync(directory);
    if (!root.isDirectory() || root.isSymbolicLink() || !expectedRootShape(directory)) {
      return { ok: false, error: "The resolved cache path is not an owned Git Mog cache." };
    }
    const marker = markerPath(directory);
    if (!existsSync(marker))
      writeFileSync(marker, CACHE_MARKER_CONTENT, { encoding: "utf8", flag: "wx" });
    if (readFileSync(marker, "utf8") !== CACHE_MARKER_CONTENT) {
      return { ok: false, error: "The resolved cache marker is invalid." };
    }
    return { ok: true, value: directory };
  } catch {
    return {
      ok: false,
      error: "The Git Mog cache is unavailable; analysis can continue without it.",
    };
  }
}

function snapshotEntry(value: unknown, now: number): { createdAt: number } | null {
  if (
    !exactRecord(value, [
      "schemaVersion",
      "cacheKeyVersion",
      "createdAt",
      "expiresAt",
      "checksum",
      "snapshot",
    ]) ||
    value.schemaVersion !== PROFILE_SNAPSHOT_SCHEMA_VERSION ||
    value.cacheKeyVersion !== SNAPSHOT_CACHE_KEY_VERSION ||
    typeof value.createdAt !== "string" ||
    typeof value.expiresAt !== "string" ||
    typeof value.checksum !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.checksum) ||
    !isProfileSnapshot(value.snapshot)
  ) {
    return null;
  }
  const createdAt = Date.parse(value.createdAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (
    !Number.isFinite(createdAt) ||
    !Number.isFinite(expiresAt) ||
    createdAt < 0 ||
    createdAt > now + FUTURE_CLOCK_SKEW_MS ||
    expiresAt <= now ||
    expiresAt <= createdAt ||
    expiresAt - createdAt > DEFAULT_SNAPSHOT_TTL_MS + FUTURE_CLOCK_SKEW_MS
  ) {
    return null;
  }
  const { checksum, ...payload } = value;
  return checksum === sha256(payload) ? { createdAt } : null;
}

function analysisEntry(
  value: unknown,
  kind: "analysis" | "feature" | "quality",
  now: number,
): { createdAt: number } | null {
  if (
    !exactRecord(value, ["expiresAt", "checksum", "value"]) ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt) ||
    typeof value.checksum !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.checksum) ||
    value.checksum !== sha256(value.value) ||
    !(kind === "quality" ? isQualityCacheSafe(value.value) : isDerivedCacheSafe(value.value))
  ) {
    return null;
  }
  const ttl =
    kind === "analysis"
      ? DEFAULT_CODE_DNA_TTL_MS
      : kind === "feature"
        ? DEFAULT_DERIVED_FEATURE_TTL_MS
        : DEFAULT_QUALITY_RESULT_TTL_MS;
  const createdAt = value.expiresAt - ttl;
  if (
    value.expiresAt <= now ||
    value.expiresAt > now + ttl + FUTURE_CLOCK_SKEW_MS ||
    createdAt < 0 ||
    createdAt > now + FUTURE_CLOCK_SKEW_MS ||
    (kind === "analysis"
      ? !isCodeDnaCacheEntry(value.value)
      : kind === "feature"
        ? !isDerivedFeatureEntry(value.value)
        : !isQualityJudgeResult(value.value))
  ) {
    return null;
  }
  return { createdAt };
}

function kindFor(directoryName: string, fileName: string): CacheKind | null {
  if (directoryName === "snapshots" && /^[0-9a-f]{32}\.json$/u.test(fileName)) return "snapshot";
  if (directoryName === "analysis" && /^[0-9a-f]{64}\.dna\.json$/u.test(fileName)) {
    return "analysis";
  }
  if (directoryName === "features" && /^[0-9a-f]{64}\.features\.json$/u.test(fileName)) {
    return "feature";
  }
  if (directoryName === "quality" && /^[0-9a-f]{64}\.quality\.json$/u.test(fileName)) {
    return "quality";
  }
  return null;
}

function inspectEntry(path: string, kind: CacheKind, now: number): CacheEntry | null {
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const validated =
      kind === "snapshot" ? snapshotEntry(parsed, now) : analysisEntry(parsed, kind, now);
    if (validated === null) return null;
    const mtime = metadata.mtimeMs;
    const lastUsedAt =
      Number.isFinite(mtime) && mtime >= 0 && mtime <= now + FUTURE_CLOCK_SKEW_MS
        ? mtime
        : validated.createdAt;
    return {
      path,
      kind,
      bytes: metadata.size,
      createdAt: validated.createdAt,
      lastUsedAt,
    };
  } catch {
    return null;
  }
}

function removeInvalid(path: string): boolean {
  try {
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink()) unlinkSync(path);
    else if (metadata.isFile()) rmSync(path, { force: true });
    else return false;
    return true;
  } catch {
    return false;
  }
}

function scanOwnedRoot(
  directory: string,
  now: number,
): {
  entries: CacheEntry[];
  invalidRemoved: number;
  retainedInvalidBytes: number;
  retainedInvalidFiles: number;
} {
  const entries: CacheEntry[] = [];
  let invalidRemoved = 0;
  let retainedInvalidBytes = 0;
  let retainedInvalidFiles = 0;
  for (const directoryName of EXPECTED_DIRECTORIES) {
    const child = join(directory, directoryName);
    if (!existsSync(child)) continue;
    let children;
    try {
      const metadata = lstatSync(child);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) continue;
      children = readdirSync(child, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const childEntry of children) {
      const path = join(child, childEntry.name);
      const kind = kindFor(directoryName, childEntry.name);
      const entry = kind === null ? null : inspectEntry(path, kind, now);
      if (entry === null) {
        if (removeInvalid(path)) {
          invalidRemoved += 1;
        } else {
          try {
            const metadata = lstatSync(path);
            if (metadata.isFile() || metadata.isSymbolicLink()) {
              retainedInvalidBytes += metadata.size;
              retainedInvalidFiles += 1;
            }
          } catch {
            // A concurrent removal leaves no retained bytes to report.
          }
        }
      } else {
        entries.push(entry);
      }
    }
  }
  return { entries, invalidRemoved, retainedInvalidBytes, retainedInvalidFiles };
}

const isoOrNull = (value: number | undefined): string | null =>
  value === undefined ? null : new Date(value).toISOString();

function summarize(
  directory: string,
  entries: readonly CacheEntry[],
  invalidRemoved: number,
  retainedInvalidBytes = 0,
  retainedInvalidFiles = 0,
): CacheInspection {
  let markerBytes = 0;
  let markerFiles = 0;
  try {
    const marker = statSync(markerPath(directory));
    markerBytes = marker.size;
    markerFiles = 1;
  } catch {
    // A read-only legacy native cache may not have a marker yet.
  }
  const times = entries.map((entry) => entry.lastUsedAt).sort((left, right) => left - right);
  return {
    path: directory,
    totalBytes:
      markerBytes + retainedInvalidBytes + entries.reduce((total, entry) => total + entry.bytes, 0),
    fileCount: markerFiles + retainedInvalidFiles + entries.length,
    maximumBytes: MAX_CACHE_BYTES,
    oldestValidEntryAt: isoOrNull(times[0]),
    newestValidEntryAt: isoOrNull(times.at(-1)),
    expiredOrCorruptEntriesRemoved: invalidRemoved,
    snapshotEntries: entries.filter((entry) => entry.kind === "snapshot").length,
    analysisEntries: entries.filter((entry) => entry.kind === "analysis").length,
    derivedFeatureEntries: entries.filter((entry) => entry.kind === "feature").length,
    qualityEntries: entries.filter((entry) => entry.kind === "quality").length,
    rawSourceStored: false,
    npmCacheControlled: false,
  };
}

export function inspectCache(options: CacheRootOptions): CacheOperationResult<CacheInspection> {
  const validated = validateCacheRoot(options);
  if (!validated.ok) return validated;
  const directory = validated.value;
  if (!existsSync(directory)) {
    return { ok: true, value: summarize(directory, [], 0) };
  }
  if (!cacheRootOwned(directory) || !expectedRootShape(directory)) {
    if (options.allowLegacy === true) {
      const legacy = legacyCacheLayout(directory, (options.now ?? Date.now)());
      if (legacy !== null && removeLegacyCache(legacy, directory)) {
        return { ok: true, value: summarize(directory, [], legacy.files.length) };
      }
    }
    return { ok: false, error: "The resolved path is not an owned Git Mog cache." };
  }
  const now = (options.now ?? Date.now)();
  const scanned = scanOwnedRoot(directory, now);
  return {
    ok: true,
    value: summarize(
      directory,
      scanned.entries,
      scanned.invalidRemoved,
      scanned.retainedInvalidBytes,
      scanned.retainedInvalidFiles,
    ),
  };
}

export function enforceCacheCeiling(
  options: CacheRootOptions,
): CacheOperationResult<CacheInspection> {
  const prepared = prepareCacheRoot(options);
  if (!prepared.ok) return prepared;
  const directory = prepared.value;
  const now = (options.now ?? Date.now)();
  const scanned = scanOwnedRoot(directory, now);
  let entries = scanned.entries;
  let summary = summarize(
    directory,
    entries,
    scanned.invalidRemoved,
    scanned.retainedInvalidBytes,
    scanned.retainedInvalidFiles,
  );
  if (summary.totalBytes > MAX_CACHE_BYTES) {
    const oldestFirst = [...entries].sort(
      (left, right) =>
        left.lastUsedAt - right.lastUsedAt ||
        left.createdAt - right.createdAt ||
        relative(directory, left.path).localeCompare(relative(directory, right.path)),
    );
    const removed = new Set<string>();
    let total = summary.totalBytes;
    for (const entry of oldestFirst) {
      if (total <= MAX_CACHE_BYTES) break;
      if (removeInvalid(entry.path)) {
        removed.add(entry.path);
        total -= entry.bytes;
      }
    }
    entries = entries.filter((entry) => !removed.has(entry.path));
    summary = summarize(
      directory,
      entries,
      scanned.invalidRemoved,
      scanned.retainedInvalidBytes,
      scanned.retainedInvalidFiles,
    );
  }
  return { ok: true, value: summary };
}

export function clearCache(options: CacheRootOptions): CacheOperationResult<CacheClearResult> {
  const validated = validateCacheRoot(options);
  if (!validated.ok) return validated;
  const directory = validated.value;
  if (!existsSync(directory)) {
    return { ok: true, value: { path: directory, bytesRemoved: 0, filesRemoved: 0 } };
  }
  if (!cacheRootOwned(directory) || !expectedRootShape(directory)) {
    if (options.allowLegacy === true) {
      const legacy = legacyCacheLayout(directory, (options.now ?? Date.now)());
      if (legacy !== null && removeLegacyCache(legacy, directory)) {
        return {
          ok: true,
          value: {
            path: directory,
            bytesRemoved: legacy.files.reduce((total, file) => total + file.bytes, 0),
            filesRemoved: legacy.files.length,
          },
        };
      }
    }
    return { ok: false, error: "The resolved path is not an owned Git Mog cache." };
  }
  const files: { path: string; bytes: number }[] = [];
  const directories: string[] = [];
  const visit = (current: string): boolean => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const metadata = lstatSync(path);
      if (metadata.isSymbolicLink()) return false;
      if (metadata.isDirectory()) {
        if (!visit(path)) return false;
        directories.push(path);
      } else if (metadata.isFile()) {
        files.push({ path, bytes: metadata.size });
      } else {
        return false;
      }
    }
    return true;
  };
  try {
    if (!visit(directory)) {
      return { ok: false, error: "Git Mog refused to clear a cache containing a symlink." };
    }
    for (const file of files) rmSync(file.path, { force: true });
    for (const child of directories) rmdirSync(child);
    rmdirSync(directory);
    return {
      ok: true,
      value: {
        path: directory,
        bytesRemoved: files.reduce((total, file) => total + file.bytes, 0),
        filesRemoved: files.length,
      },
    };
  } catch {
    return { ok: false, error: "Git Mog could not safely clear the resolved cache root." };
  }
}
