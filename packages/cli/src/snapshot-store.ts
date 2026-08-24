import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { join, posix, win32 } from "node:path";

import {
  DEFAULT_SNAPSHOT_TTL_MS,
  MAX_PROFILE_EVENTS,
  PROFILE_SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_CACHE_KEY_VERSION,
  digest,
  parseGithubUsername,
  stableStringify,
  type ProfileSnapshot,
  type SnapshotCache,
} from "@gitmog/github";

/**
 * A file-backed snapshot cache.
 *
 * The web surface could rely on a process-lifetime cache; a command line cannot,
 * because every invocation is a new process. Without this, one tokenless battle spends
 * 26 of GitHub's 60 anonymous requests an hour and a rematch spends 26 more. See
 * ADR 0006.
 *
 * Only public GitHub evidence is written, never a token and never a credential.
 */
const MAX_ENTRIES = 60;
const MAX_STRING = 4_096;
const MAX_NUMBER = 1_000_000_000_000;

export interface FileSnapshotCacheOptions {
  readonly directory: string;
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly afterWrite?: (() => void) | undefined;
}

interface StoredEntry {
  readonly schemaVersion: typeof PROFILE_SNAPSHOT_SCHEMA_VERSION;
  readonly cacheKeyVersion: typeof SNAPSHOT_CACHE_KEY_VERSION;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly checksum: string;
  readonly snapshot: ProfileSnapshot;
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const exactRecord = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (!isPlainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const boundedString = (value: unknown, maximum = MAX_STRING, allowEmpty = false): value is string =>
  typeof value === "string" && value.length <= maximum && (allowEmpty || value.length > 0);

const nullableString = (value: unknown, maximum = MAX_STRING): value is string | null =>
  value === null || boundedString(value, maximum, true);

const finite = (value: unknown, minimum = 0, maximum = MAX_NUMBER): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;

const integer = (value: unknown, minimum = 0, maximum = MAX_NUMBER): value is number =>
  finite(value, minimum, maximum) && Number.isSafeInteger(value);

const GITHUB_UTC_TIMESTAMP =
  /^(?<year>\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\d|3[01])T(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d):(?<second>[0-5]\d)(?:\.(?<fraction>\d{1,3}))?Z$/;

/** Strict GitHub UTC RFC3339 timestamp. JavaScript dates have millisecond precision,
 * so fractional seconds are deliberately bounded to one through three digits. */
const githubUtcTimestamp = (value: unknown): value is string => {
  if (!boundedString(value, 24)) return false;
  const match = GITHUB_UTC_TIMESTAMP.exec(value);
  if (match?.groups === undefined) return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  const parsed = new Date(time);
  const fraction = Number((match.groups.fraction ?? "").padEnd(3, "0"));
  return (
    parsed.getUTCFullYear() === Number(match.groups.year) &&
    parsed.getUTCMonth() + 1 === Number(match.groups.month) &&
    parsed.getUTCDate() === Number(match.groups.day) &&
    parsed.getUTCHours() === Number(match.groups.hour) &&
    parsed.getUTCMinutes() === Number(match.groups.minute) &&
    parsed.getUTCSeconds() === Number(match.groups.second) &&
    parsed.getUTCMilliseconds() === fraction
  );
};

const referenceDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
};

const httpsUrl = (value: unknown): value is string => {
  if (!boundedString(value, MAX_STRING)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const stringArray = (
  value: unknown,
  maximumItems: number,
  maximumString = MAX_STRING,
  allowEmpty = false,
): value is readonly string[] =>
  Array.isArray(value) &&
  value.length <= maximumItems &&
  value.every((entry) => boundedString(entry, maximumString, allowEmpty)) &&
  new Set(value).size === value.length;

const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{40,64}$/i.test(value);

const PROFILE_KEYS = [
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

const isProfile = (value: unknown): boolean =>
  exactRecord(value, PROFILE_KEYS) &&
  typeof value.login === "string" &&
  parseGithubUsername(value.login)?.toLowerCase() === value.login.toLowerCase() &&
  integer(value.id, 1, Number.MAX_SAFE_INTEGER) &&
  nullableString(value.name, 512) &&
  httpsUrl(value.avatarUrl) &&
  httpsUrl(value.htmlUrl) &&
  nullableString(value.bio, 2_048) &&
  integer(value.publicRepos) &&
  integer(value.followers) &&
  githubUtcTimestamp(value.createdAt) &&
  ["User", "Organization", "Bot"].includes(String(value.accountType));

const REPOSITORY_KEYS = [
  "id",
  "name",
  "fullName",
  "htmlUrl",
  "description",
  "fork",
  "archived",
  "disabled",
  "isTemplate",
  "mirror",
  "sizeKb",
  "stars",
  "forks",
  "openIssues",
  "primaryLanguage",
  "topics",
  "homepage",
  "licenseSpdxId",
  "createdAt",
  "updatedAt",
  "pushedAt",
  "defaultBranch",
] as const;

const isRepository = (value: unknown, login: string): boolean =>
  exactRecord(value, REPOSITORY_KEYS) &&
  integer(value.id, 1, Number.MAX_SAFE_INTEGER) &&
  boundedString(value.name, 100) &&
  boundedString(value.fullName, 202) &&
  value.fullName.toLowerCase() === `${login.toLowerCase()}/${value.name.toLowerCase()}` &&
  httpsUrl(value.htmlUrl) &&
  nullableString(value.description, 2_048) &&
  ["fork", "archived", "disabled", "isTemplate", "mirror"].every(
    (key) => typeof value[key] === "boolean",
  ) &&
  ["sizeKb", "stars", "forks", "openIssues"].every((key) => integer(value[key])) &&
  nullableString(value.primaryLanguage, 128) &&
  stringArray(value.topics, 20, 64) &&
  nullableString(value.homepage, MAX_STRING) &&
  nullableString(value.licenseSpdxId, 128) &&
  githubUtcTimestamp(value.createdAt) &&
  githubUtcTimestamp(value.updatedAt) &&
  (value.pushedAt === null || githubUtcTimestamp(value.pushedAt)) &&
  boundedString(value.defaultBranch, 256);

const TREE_ENTRY_KEYS = ["path", "type", "sizeBytes", "sha"] as const;
const isTreeEntry = (value: unknown): boolean =>
  exactRecord(value, TREE_ENTRY_KEYS) &&
  boundedString(value.path, MAX_STRING) &&
  ["blob", "tree", "commit"].includes(String(value.type)) &&
  integer(value.sizeBytes) &&
  sha(value.sha);

const isLanguageBytes = (value: unknown): boolean =>
  isPlainRecord(value) &&
  Object.keys(value).length <= 64 &&
  Object.entries(value).every(
    ([language, bytes]) =>
      !["__proto__", "constructor", "prototype"].includes(language.toLowerCase()) &&
      boundedString(language, 128) &&
      integer(bytes, 1),
  );

const INSPECTION_KEYS = [
  "name",
  "fullName",
  "htmlUrl",
  "languageBytes",
  "releaseCount",
  "latestReleaseAt",
  "tree",
  "treeSha",
  "treeTruncated",
  "failures",
] as const;

const isInspection = (
  value: unknown,
  repositories: readonly Record<string, unknown>[],
): boolean => {
  if (!exactRecord(value, INSPECTION_KEYS)) return false;
  const repository = repositories.find(
    (entry) => entry.name === value.name && entry.fullName === value.fullName,
  );
  return (
    repository !== undefined &&
    value.htmlUrl === repository.htmlUrl &&
    isLanguageBytes(value.languageBytes) &&
    integer(value.releaseCount, 0, 1_000) &&
    (value.latestReleaseAt === null || githubUtcTimestamp(value.latestReleaseAt)) &&
    ((value.tree === null && value.treeSha === null) ||
      (Array.isArray(value.tree) &&
        value.tree.length <= 6_000 &&
        value.tree.every(isTreeEntry) &&
        sha(value.treeSha))) &&
    typeof value.treeTruncated === "boolean" &&
    stringArray(value.failures, 3, 16) &&
    value.failures.every((entry) => ["languages", "releases", "tree"].includes(entry))
  );
};

const EVENT_KEYS = ["type", "repoFullName", "createdAt", "action", "merged", "isBotActor"];
const isEvent = (value: unknown): boolean =>
  exactRecord(value, EVENT_KEYS) &&
  boundedString(value.type, 128) &&
  boundedString(value.repoFullName, 202, true) &&
  githubUtcTimestamp(value.createdAt) &&
  nullableString(value.action, 128) &&
  typeof value.merged === "boolean" &&
  typeof value.isBotActor === "boolean";

const COMMIT_KEYS = ["sha", "message", "authoredAt", "parentCount", "authorName", "isBotAuthor"];
const isCommit = (value: unknown): boolean =>
  exactRecord(value, COMMIT_KEYS) &&
  sha(value.sha) &&
  boundedString(value.message, 16_384) &&
  githubUtcTimestamp(value.authoredAt) &&
  integer(value.parentCount, 0, 100) &&
  boundedString(value.authorName, 512, true) &&
  typeof value.isBotAuthor === "boolean";

const isCommitSample = (value: unknown, repositoryNames: ReadonlySet<string>): boolean =>
  value === null ||
  (exactRecord(value, ["repository", "repositoryUrl", "commits", "truncated"]) &&
    typeof value.repository === "string" &&
    repositoryNames.has(value.repository.toLowerCase()) &&
    httpsUrl(value.repositoryUrl) &&
    Array.isArray(value.commits) &&
    value.commits.length <= 100 &&
    value.commits.every(isCommit) &&
    typeof value.truncated === "boolean");

const isEventWindow = (value: unknown): boolean =>
  exactRecord(value, ["oldest", "newest", "truncated"]) &&
  (value.oldest === null || githubUtcTimestamp(value.oldest)) &&
  (value.newest === null || githubUtcTimestamp(value.newest)) &&
  typeof value.truncated === "boolean";

const isBudget = (value: unknown): boolean =>
  exactRecord(value, [
    "maxRequests",
    "usedRequests",
    "maxInspectedRepositories",
    "inspectedRepositories",
    "exhausted",
  ]) &&
  integer(value.maxRequests, 1, 24) &&
  integer(value.usedRequests, 0, value.maxRequests) &&
  integer(value.maxInspectedRepositories, 1, 5) &&
  integer(value.inspectedRepositories, 0, value.maxInspectedRepositories) &&
  typeof value.exhausted === "boolean";

const isRateLimit = (value: unknown): boolean =>
  exactRecord(value, ["authenticated", "limit", "remaining", "resetAt"]) &&
  typeof value.authenticated === "boolean" &&
  (value.limit === null || integer(value.limit)) &&
  (value.remaining === null || integer(value.remaining)) &&
  (value.resetAt === null || githubUtcTimestamp(value.resetAt));

const SNAPSHOT_KEYS = [
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

/** Exact fail-closed validation for the persisted default-full snapshot schema. */
export function isProfileSnapshot(value: unknown): value is ProfileSnapshot {
  if (!exactRecord(value, SNAPSHOT_KEYS) || !isProfile(value.profile)) return false;
  const profile = value.profile as Record<string, unknown>;
  if (!Array.isArray(value.repositories) || value.repositories.length > 200) return false;
  if (!value.repositories.every((entry) => isRepository(entry, profile.login as string))) {
    return false;
  }
  const repositories = value.repositories as readonly Record<string, unknown>[];
  const repositoryIds = repositories.map((entry) => entry.id);
  const repositoryNames = new Set(
    repositories.map((entry) => String(entry.fullName).toLowerCase()),
  );
  if (
    new Set(repositoryIds).size !== repositoryIds.length ||
    repositoryNames.size !== repositories.length
  ) {
    return false;
  }
  if (!stringArray(value.selectedRepositories, 5, 100)) return false;
  if (
    !value.selectedRepositories.every((name) =>
      repositories.some((repository) => repository.name === name),
    )
  ) {
    return false;
  }
  if (
    !Array.isArray(value.inspections) ||
    value.inspections.length > 5 ||
    !value.inspections.every((entry) => isInspection(entry, repositories))
  ) {
    return false;
  }
  const inspectionNames = value.inspections.map((entry) => (entry as Record<string, unknown>).name);
  if (stableStringify(inspectionNames) !== stableStringify(value.selectedRepositories))
    return false;
  if (
    !Array.isArray(value.events) ||
    value.events.length > MAX_PROFILE_EVENTS ||
    !value.events.every(isEvent)
  ) {
    return false;
  }
  const structurallyValid =
    typeof value.snapshotKey === "string" &&
    /^[0-9a-f]{32}$/.test(value.snapshotKey) &&
    githubUtcTimestamp(value.collectedAt) &&
    referenceDate(value.referenceDate) &&
    value.referenceDate === value.collectedAt.slice(0, 10) &&
    typeof value.repositoryListComplete === "boolean" &&
    integer(value.eligibleRepositoryCount, 0, repositories.length) &&
    typeof value.eventsAvailable === "boolean" &&
    isEventWindow(value.eventWindow) &&
    isCommitSample(value.commitSample, repositoryNames) &&
    isBudget(value.budget) &&
    isRateLimit(value.rateLimit) &&
    stringArray(value.degradations, 32, 1_024, true);
  if (!structurallyValid) return false;
  const snapshot = value as unknown as ProfileSnapshot;
  const {
    snapshotKey,
    collectedAt: _collectedAt,
    budget: _budget,
    rateLimit: _rateLimit,
    ...evidence
  } = snapshot;
  return digest(evidence) === snapshotKey;
}

const ENVELOPE_KEYS = [
  "schemaVersion",
  "cacheKeyVersion",
  "createdAt",
  "expiresAt",
  "checksum",
  "snapshot",
] as const;

const checksumFor = (entry: Omit<StoredEntry, "checksum">): string =>
  createHash("sha256").update(stableStringify(entry)).digest("hex");

const isStoredEntry = (value: unknown): value is StoredEntry => {
  if (!exactRecord(value, ENVELOPE_KEYS)) return false;
  if (
    value.schemaVersion !== PROFILE_SNAPSHOT_SCHEMA_VERSION ||
    value.cacheKeyVersion !== SNAPSHOT_CACHE_KEY_VERSION ||
    !githubUtcTimestamp(value.createdAt) ||
    !githubUtcTimestamp(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.createdAt) ||
    typeof value.checksum !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.checksum) ||
    !isProfileSnapshot(value.snapshot)
  ) {
    return false;
  }
  const { checksum, ...payload } = value as unknown as StoredEntry;
  return checksum === checksumFor(payload);
};

/** Platform-native cache path with explicit override. */
export function resolveCacheDirectory(
  env: Readonly<Record<string, string | undefined>>,
  home: string = homedir(),
  platform: string = process.platform,
): string {
  const explicit = env.GITMOG_CACHE_DIR?.trim();
  if (explicit !== undefined && explicit !== "") return explicit;
  const pathApi = platform === "win32" ? win32 : posix;
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim() || pathApi.join(home, "AppData", "Local");
    return pathApi.join(localAppData, "GitMog", "Cache");
  }
  if (platform === "darwin") return pathApi.join(home, "Library", "Caches", "gitmog");
  const xdg = env.XDG_CACHE_HOME?.trim();
  if (xdg !== undefined && xdg !== "") return pathApi.join(xdg, "gitmog");
  return pathApi.join(home, ".cache", "gitmog");
}

const fileNameFor = (key: string): string =>
  `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`;

export function createFileSnapshotCache(
  options: FileSnapshotCacheOptions,
): SnapshotCache<ProfileSnapshot> & { readonly hits: readonly string[] } {
  const ttlMs = options.ttlMs ?? DEFAULT_SNAPSHOT_TTL_MS;
  const now = options.now ?? Date.now;
  const directory = options.directory;
  const hits: string[] = [];

  const pathFor = (key: string): string => join(directory, fileNameFor(key));

  const ensureDirectory = (): boolean => {
    try {
      mkdirSync(directory, { recursive: true });
      return true;
    } catch {
      // A read-only or unwritable cache directory must never fail a battle.
      return false;
    }
  };

  const prune = (): void => {
    try {
      const files = readdirSync(directory).filter((file) => file.endsWith(".json"));
      if (files.length <= MAX_ENTRIES) return;
      // Oldest first by name-independent read of the stored expiry.
      const dated = files
        .map((file) => {
          try {
            const parsed: unknown = JSON.parse(readFileSync(join(directory, file), "utf8"));
            return {
              file,
              expiresAt:
                isPlainRecord(parsed) && githubUtcTimestamp(parsed.expiresAt)
                  ? Date.parse(parsed.expiresAt)
                  : 0,
            };
          } catch {
            return { file, expiresAt: 0 };
          }
        })
        .sort(
          (left, right) => left.expiresAt - right.expiresAt || left.file.localeCompare(right.file),
        );
      for (const entry of dated.slice(0, dated.length - MAX_ENTRIES)) {
        rmSync(join(directory, entry.file), { force: true });
      }
    } catch {
      // Pruning is best effort.
    }
  };

  return {
    get(key) {
      const file = pathFor(key);
      if (!existsSync(file)) return undefined;
      try {
        const entry: unknown = JSON.parse(readFileSync(file, "utf8"));
        if (!isStoredEntry(entry) || Date.parse(entry.expiresAt) <= now()) return undefined;
        try {
          const accessedAt = new Date(now());
          utimesSync(file, accessedAt, accessedAt);
        } catch {
          // Recency is best effort and never changes the cached evidence.
        }
        hits.push(key);
        return entry.snapshot;
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      if (!isProfileSnapshot(value)) return;
      if (!ensureDirectory()) return;
      const path = pathFor(key);
      const temporary = `${path}.tmp`;
      try {
        const createdAt = new Date(now()).toISOString();
        const payload: Omit<StoredEntry, "checksum"> = {
          schemaVersion: PROFILE_SNAPSHOT_SCHEMA_VERSION,
          cacheKeyVersion: SNAPSHOT_CACHE_KEY_VERSION,
          createdAt,
          expiresAt: new Date(now() + ttlMs).toISOString(),
          snapshot: value,
        };
        const entry: StoredEntry = { ...payload, checksum: checksumFor(payload) };
        writeFileSync(temporary, JSON.stringify(entry), "utf8");
        renameSync(temporary, path);
        prune();
        options.afterWrite?.();
      } catch {
        rmSync(temporary, { force: true });
        // A failed write only costs the next run a re-fetch.
      }
    },
    delete(key) {
      rmSync(pathFor(key), { force: true });
    },
    clear() {
      try {
        for (const file of readdirSync(directory).filter((name) => name.endsWith(".json"))) {
          rmSync(join(directory, file), { force: true });
        }
      } catch {
        // Nothing cached, nothing to clear.
      }
    },
    get size() {
      try {
        return readdirSync(directory).filter((file) => file.endsWith(".json")).length;
      } catch {
        return 0;
      }
    },
    get hits() {
      return hits;
    },
  };
}
