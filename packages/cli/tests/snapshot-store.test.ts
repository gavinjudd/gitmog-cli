import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
  type PersonaSpec,
} from "@gitmog/test-fixtures/github-personas";
import {
  collectProfileSnapshot,
  createSnapshotCache,
  digest,
  EVENTS_PER_PAGE,
  MAX_EVENT_PAGES,
  MAX_PROFILE_EVENTS,
  PROFILE_SNAPSHOT_SCHEMA_VERSION,
  REQUEST_BUDGETS,
  SNAPSHOT_CACHE_KEY_VERSION,
  snapshotCacheKey,
  stableStringify,
  type ProfileSnapshot,
  type SnapshotCache,
} from "@gitmog/github";
import { afterEach, describe, expect, it } from "vitest";

import { run, type CliContext } from "../src/cli.js";
import {
  createFileSnapshotCache,
  isProfileSnapshot,
  resolveCacheDirectory,
} from "../src/snapshot-store.js";

const temporaryDirectories: string[] = [];
const RECORDED_GITHUB_CREATED_AT = (
  JSON.parse(
    readFileSync(
      new URL("../../github/tests/fixtures/recorded/rest/user.json", import.meta.url),
      "utf8",
    ),
  ) as { readonly created_at: string }
).created_at;

const scratch = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "gitmog-cache-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const fixtureSnapshot = async (): Promise<ProfileSnapshot> => {
  const result = await collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
    fetchImpl: createFixtureFetch(PERSONAS.strongMaintainer),
    cache: null,
    now: () => FIXTURE_NOW_MS,
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.snapshot;
};

const recomputeSnapshotKey = (snapshot: ProfileSnapshot): ProfileSnapshot => {
  const {
    snapshotKey: _snapshotKey,
    collectedAt: _collectedAt,
    budget: _budget,
    rateLimit: _rateLimit,
    ...evidence
  } = snapshot;
  return { ...snapshot, snapshotKey: digest(evidence) };
};

const withProfileCreatedAt = (snapshot: ProfileSnapshot, createdAt: unknown): ProfileSnapshot =>
  recomputeSnapshotKey({
    ...snapshot,
    profile: { ...snapshot.profile, createdAt: createdAt as string },
  });

const withEventCount = (snapshot: ProfileSnapshot, count: number): ProfileSnapshot => {
  const event = snapshot.events[0];
  if (event === undefined) throw new Error("The snapshot fixture needs one public event.");
  const events = Array.from({ length: count }, () => event);
  return recomputeSnapshotKey({
    ...snapshot,
    events,
    eventWindow:
      count === 0
        ? { oldest: null, newest: null, truncated: false }
        : {
            oldest: event.createdAt,
            newest: event.createdAt,
            truncated: count >= MAX_PROFILE_EVENTS,
          },
  });
};

const withoutOperationalRequestTelemetry = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutOperationalRequestTelemetry);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "requestBudget" && key !== "requestTelemetry")
      .map(([key, nested]) => [key, withoutOperationalRequestTelemetry(nested)]),
  );
};

describe("resolveCacheDirectory", () => {
  it("prefers GITMOG_CACHE_DIR, then XDG_CACHE_HOME, then the Linux home cache", () => {
    expect(resolveCacheDirectory({ GITMOG_CACHE_DIR: "/tmp/explicit" }, "/home/dev", "linux")).toBe(
      "/tmp/explicit",
    );
    expect(resolveCacheDirectory({ XDG_CACHE_HOME: "/xdg" }, "/home/dev", "linux")).toBe(
      "/xdg/gitmog",
    );
    expect(resolveCacheDirectory({}, "/home/dev", "linux")).toBe("/home/dev/.cache/gitmog");
  });

  it("constructs native macOS and Windows cache paths", () => {
    expect(resolveCacheDirectory({}, "/Users/dev", "darwin")).toBe(
      "/Users/dev/Library/Caches/gitmog",
    );
    expect(
      resolveCacheDirectory(
        { LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local" },
        "C:\\Users\\dev",
        "win32",
      ),
    ).toBe("C:\\Users\\dev\\AppData\\Local\\GitMog\\Cache");
  });
});

describe("createFileSnapshotCache", () => {
  it("round-trips an exact versioned snapshot and reports a hit", async () => {
    const snapshot = await fixtureSnapshot();
    const cache = createFileSnapshotCache({ directory: scratch(), now: () => FIXTURE_NOW_MS });
    expect(cache.get("k")).toBeUndefined();
    cache.set("k", snapshot);
    expect(cache.get("k")).toEqual(snapshot);
    expect(cache.hits).toEqual(["k"]);
    expect(cache.size).toBe(1);
  });

  it.each([
    RECORDED_GITHUB_CREATED_AT,
    "2011-01-25T18:44:36.000Z",
    "2011-01-25T18:44:36.123Z",
    "2024-02-29T23:59:59.9Z",
  ])("accepts strict GitHub UTC RFC3339 timestamp %s", async (createdAt) => {
    const snapshot = withProfileCreatedAt(await fixtureSnapshot(), createdAt);
    expect(isProfileSnapshot(snapshot)).toBe(true);
  });

  it.each([
    ["partial date", "2011-01-25"],
    ["locale-dependent prose", "January 25, 2011 18:44:36 UTC"],
    ["impossible month", "2011-13-25T18:44:36Z"],
    ["impossible day", "2023-02-29T18:44:36Z"],
    ["impossible hour", "2011-01-25T24:44:36Z"],
    ["missing UTC marker", "2011-01-25T18:44:36"],
    ["timezone offset", "2011-01-25T13:44:36-05:00"],
    ["trailing data", "2011-01-25T18:44:36Z trailing"],
    ["leading whitespace", " 2011-01-25T18:44:36Z"],
    ["trailing whitespace", "2011-01-25T18:44:36Z "],
    ["empty value", ""],
    ["oversized value", `${"2".repeat(65)}Z`],
    ["excess fractional precision", "2011-01-25T18:44:36.1234Z"],
    ["type mismatch", 1_295_982_276_000],
  ])("rejects %s timestamp input", async (_description, createdAt) => {
    const snapshot = withProfileCreatedAt(await fixtureSnapshot(), createdAt);
    expect(isProfileSnapshot(snapshot)).toBe(false);
  });

  it("keeps invalid timestamp entries fail-closed and creates no cache entry", async () => {
    const cache = createFileSnapshotCache({ directory: scratch(), now: () => FIXTURE_NOW_MS });
    cache.set("invalid", withProfileCreatedAt(await fixtureSnapshot(), RECORDED_GITHUB_CREATED_AT));
    expect(cache.size).toBe(1);
    cache.clear();
    cache.set("invalid", withProfileCreatedAt(await fixtureSnapshot(), "2011-01-25T18:44:36"));
    expect(cache.size).toBe(0);
    expect(cache.get("invalid")).toBeUndefined();
  });

  it.each([0, 200, 201, MAX_PROFILE_EVENTS])(
    "accepts a fully validated %i-event snapshot",
    async (count) => {
      expect(isProfileSnapshot(withEventCount(await fixtureSnapshot(), count))).toBe(true);
    },
  );

  it("rejects 301 events and a malformed member within a 300-event array", async () => {
    const snapshot = await fixtureSnapshot();
    expect(isProfileSnapshot(withEventCount(snapshot, MAX_PROFILE_EVENTS + 1))).toBe(false);
    const malformed = structuredClone(withEventCount(snapshot, MAX_PROFILE_EVENTS));
    (malformed.events as unknown as { type: unknown }[])[149] = {
      ...malformed.events[149],
      type: { unexpected: true },
    };
    expect(isProfileSnapshot(recomputeSnapshotKey(malformed))).toBe(false);
  });

  it("atomically replaces valid entries and preserves the prior value after rejection", async () => {
    const directory = scratch();
    const cache = createFileSnapshotCache({ directory, now: () => FIXTURE_NOW_MS });
    const initial = await fixtureSnapshot();
    const replacement = withProfileCreatedAt(initial, RECORDED_GITHUB_CREATED_AT);
    cache.set("k", initial);
    cache.set("k", replacement);
    expect(cache.get("k")).toEqual(replacement);
    expect(readdirSync(directory)).toHaveLength(1);
    expect(readdirSync(directory).some((file) => file.endsWith(".tmp"))).toBe(false);

    cache.set("k", withProfileCreatedAt(initial, "invalid timestamp"));
    expect(cache.get("k")).toEqual(replacement);
    expect(readdirSync(directory)).toHaveLength(1);
  });

  it("persists and reuses the shared authenticated collection envelope", async () => {
    const persona: PersonaSpec = {
      login: "eventmaximum",
      repos: [{ name: "main-project", sizeKb: 900 }],
      trees: { "main-project": ["README.md", "src/index.ts"] },
      events: Array.from({ length: MAX_PROFILE_EVENTS }, (_value, index) => ({
        type: "PushEvent",
        repo: "eventmaximum/main-project",
        daysAgo: index % 60,
      })),
    };
    expect(MAX_PROFILE_EVENTS).toBe(MAX_EVENT_PAGES * EVENTS_PER_PAGE);
    expect(REQUEST_BUDGETS.authenticated.eventPages).toBe(REQUEST_BUDGETS.anonymous.eventPages);

    const directory = scratch();
    const cache = createFileSnapshotCache({ directory, now: () => FIXTURE_NOW_MS });
    const fetchImpl = createFixtureFetch(persona);
    const options = {
      cache,
      fetchImpl,
      now: () => FIXTURE_NOW_MS,
      token: "fixture-auth-token",
    };
    const first = await collectProfileSnapshot(persona.login, options);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.snapshot.events).toHaveLength(
      REQUEST_BUDGETS.authenticated.eventPages * EVENTS_PER_PAGE,
    );
    const eventCalls = fetchImpl.calls.filter((call) => call.includes("/events/public"));
    expect(eventCalls).toHaveLength(REQUEST_BUDGETS.authenticated.eventPages);
    expect(eventCalls.every((call) => call.includes(`per_page=${String(EVENTS_PER_PAGE)}`))).toBe(
      true,
    );
    expect(cache.size).toBe(1);
    expect(
      cache.get(
        snapshotCacheKey({
          login: persona.login,
          authenticated: true,
          maxInspectedRepositories: REQUEST_BUDGETS.authenticated.inspectedRepositories,
        }),
      ),
    ).toEqual(first.snapshot);

    let warmCalls = 0;
    const warm = await collectProfileSnapshot(persona.login, {
      ...options,
      fetchImpl: () => {
        warmCalls += 1;
        throw new Error("A valid maximum event snapshot must satisfy the cache read.");
      },
    });
    expect(warm.ok).toBe(true);
    expect(warmCalls).toBe(0);
    if (!warm.ok) return;
    expect(warm.requestsUsed).toBe(0);
    expect(warm.snapshot).toEqual(first.snapshot);

    const uncached = await collectProfileSnapshot(persona.login, {
      ...options,
      cache: null,
      fetchImpl: createFixtureFetch(persona),
    });
    expect(uncached.ok).toBe(true);
    if (uncached.ok) expect(uncached.snapshot).toEqual(first.snapshot);

    const persisted = readdirSync(directory).map((file) =>
      readFileSync(join(directory, file), "utf8"),
    );
    expect(persisted).toHaveLength(1);
    for (const contents of persisted) {
      expect(contents).not.toContain("fixture-auth-token");
      for (const forbidden of [
        "sourcecontent",
        "credential",
        "authorization",
        "token",
        "prompt",
        "reasoning",
      ]) {
        expect(contents.toLowerCase()).not.toContain(forbidden);
      }
    }
  });

  it("treats an expired entry as a miss without deleting the prior file", async () => {
    const snapshot = await fixtureSnapshot();
    let clock = FIXTURE_NOW_MS;
    const cache = createFileSnapshotCache({
      directory: scratch(),
      ttlMs: 500,
      now: () => clock,
    });
    cache.set("k", snapshot);
    clock += 499;
    expect(cache.get("k")).toEqual(snapshot);
    clock += 2;
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  it("treats a corrupted entry as a miss without deleting it", async () => {
    const snapshot = await fixtureSnapshot();
    const directory = scratch();
    const cache = createFileSnapshotCache({ directory, now: () => FIXTURE_NOW_MS });
    cache.set("k", snapshot);
    const file = readdirSync(directory)[0] as string;
    writeFileSync(join(directory, file), "{ not json", "utf8");
    expect(cache.get("k")).toBeUndefined();
    expect(readFileSync(join(directory, file), "utf8")).toBe("{ not json");
  });

  it("survives an unwritable directory without failing the caller", async () => {
    const snapshot = await fixtureSnapshot();
    const parent = scratch();
    const regularFile = join(parent, "not-a-directory");
    writeFileSync(regularFile, "blocks child directory creation", "utf8");
    const cache = createFileSnapshotCache({ directory: join(regularFile, "cache") });
    expect(() => {
      cache.set("k", snapshot);
    }).not.toThrow();
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("clears everything it wrote", async () => {
    const snapshot = await fixtureSnapshot();
    const cache = createFileSnapshotCache({ directory: scratch(), now: () => FIXTURE_NOW_MS });
    cache.set("a", snapshot);
    cache.set("b", snapshot);
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("rejects old snapshot objects, old cache identity, and malformed exact schemas", async () => {
    const snapshot = await fixtureSnapshot();
    expect(isProfileSnapshot(snapshot)).toBe(true);
    expect(isProfileSnapshot({ snapshotKey: "old-schema" })).toBe(false);
    expect(
      snapshotCacheKey({
        login: snapshot.profile.login,
        authenticated: false,
        maxInspectedRepositories: 3,
      }),
    ).toContain(SNAPSHOT_CACHE_KEY_VERSION);
    expect(
      snapshotCacheKey({
        login: snapshot.profile.login,
        authenticated: false,
        maxInspectedRepositories: 3,
      }),
    ).not.toContain("fast-scan:1");

    const missingRepositoryId = structuredClone(snapshot) as unknown as Record<string, unknown>;
    delete (missingRepositoryId.repositories as Record<string, unknown>[])[0]!.id;
    expect(isProfileSnapshot(missingRepositoryId)).toBe(false);

    const missingTreeSha = structuredClone(snapshot) as unknown as Record<string, unknown>;
    delete (missingTreeSha.inspections as Record<string, unknown>[])[0]!.treeSha;
    expect(isProfileSnapshot(missingTreeSha)).toBe(false);

    const missingBlobSha = structuredClone(snapshot) as unknown as Record<string, unknown>;
    const tree = (missingBlobSha.inspections as Record<string, unknown>[])[0]!.tree as Record<
      string,
      unknown
    >[];
    delete tree.find((entry) => entry.type === "blob")!.sha;
    expect(isProfileSnapshot(missingBlobSha)).toBe(false);

    expect(isProfileSnapshot({ ...snapshot, unknownField: true })).toBe(false);
    const { profile, ...rest } = snapshot;
    expect(isProfileSnapshot({ ...rest, Profile: profile })).toBe(false);
    expect(isProfileSnapshot({ ...snapshot, eligibleRepositoryCount: "1" })).toBe(false);
    expect(isProfileSnapshot({ ...snapshot, degradations: ["x".repeat(1_025)] })).toBe(false);
    expect(
      isProfileSnapshot({
        ...snapshot,
        repositories: Array.from({ length: 201 }, () => snapshot.repositories[0]),
      }),
    ).toBe(false);
    expect(
      isProfileSnapshot(JSON.parse(`{"__proto__":{},${JSON.stringify(snapshot).slice(1)}`)),
    ).toBe(false);
  });

  it("rejects stale envelopes and checksum mismatches without deleting their bytes", async () => {
    const snapshot = await fixtureSnapshot();
    const directory = scratch();
    const cache = createFileSnapshotCache({ directory, now: () => FIXTURE_NOW_MS });
    cache.set("k", snapshot);
    const file = join(directory, readdirSync(directory)[0] as string);

    writeFileSync(file, JSON.stringify({ snapshotKey: "old-schema" }), "utf8");
    expect(cache.get("k")).toBeUndefined();
    expect(readFileSync(file, "utf8")).toContain("old-schema");

    cache.set("k", snapshot);
    const envelope = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(envelope.schemaVersion).toBe(PROFILE_SNAPSHOT_SCHEMA_VERSION);
    envelope.checksum = "0".repeat(64);
    writeFileSync(file, JSON.stringify(envelope), "utf8");
    expect(cache.get("k")).toBeUndefined();
    expect(readFileSync(file, "utf8")).toContain(`"checksum":"${"0".repeat(64)}"`);

    envelope.schemaVersion = "old-schema-version";
    const { checksum: _checksum, ...payload } = envelope;
    envelope.checksum = createHash("sha256").update(stableStringify(payload)).digest("hex");
    writeFileSync(file, JSON.stringify(envelope), "utf8");
    expect(cache.get("k")).toBeUndefined();
    expect(readFileSync(file, "utf8")).toContain("old-schema-version");
  });

  it("recollects an old-schema hit and preserves it until a successful replacement", async () => {
    const snapshot = await fixtureSnapshot();
    const directory = scratch();
    const cache = createFileSnapshotCache({ directory, now: () => FIXTURE_NOW_MS });
    const key = snapshotCacheKey({
      login: snapshot.profile.login,
      authenticated: false,
      maxInspectedRepositories: 3,
    });
    cache.set(key, snapshot);
    const file = join(directory, readdirSync(directory)[0] as string);
    const old = JSON.stringify({ snapshotKey: "old-schema" });
    writeFileSync(file, old, "utf8");

    let failedCalls = 0;
    const failed = await collectProfileSnapshot(snapshot.profile.login, {
      cache,
      now: () => FIXTURE_NOW_MS,
      fetchImpl: () => {
        failedCalls += 1;
        return Promise.resolve(new Response("{}", { status: 500 }));
      },
    });
    expect(failed.ok).toBe(false);
    expect(failedCalls).toBe(1);
    expect(readFileSync(file, "utf8")).toBe(old);

    const fixture = createFixtureFetch(PERSONAS.strongMaintainer);
    const replacement = await collectProfileSnapshot(snapshot.profile.login, {
      cache,
      now: () => FIXTURE_NOW_MS,
      fetchImpl: fixture,
    });
    expect(replacement.ok).toBe(true);
    expect(fixture.calls.length).toBeGreaterThan(0);
    expect(readFileSync(file, "utf8")).not.toContain("old-schema");
    expect(cache.get(key)).toEqual(snapshot);
  });

  it.each(["filesystem", "memory"] as const)(
    "refresh replaces a successful %s cache entry and preserves it after a failed refresh",
    async (kind) => {
      const cache: SnapshotCache<ProfileSnapshot> =
        kind === "filesystem"
          ? createFileSnapshotCache({ directory: scratch(), now: () => FIXTURE_NOW_MS })
          : createSnapshotCache(60_000, () => FIXTURE_NOW_MS);
      const initial = await collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
        fetchImpl: createFixtureFetch(PERSONAS.strongMaintainer),
        cache,
        now: () => FIXTURE_NOW_MS,
      });
      expect(initial.ok).toBe(true);
      if (!initial.ok) return;

      const changed = {
        ...PERSONAS.strongMaintainer,
        repos: PERSONAS.strongMaintainer.repos.slice(0, 1),
        trees: { orchestrator: ["src/index.ts"] },
      };
      const refreshed = await collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
        fetchImpl: createFixtureFetch(changed),
        cache,
        cachePolicy: { read: false, write: true },
        now: () => FIXTURE_NOW_MS,
      });
      expect(refreshed.ok).toBe(true);
      if (!refreshed.ok) return;
      expect(refreshed.snapshot.snapshotKey).not.toBe(initial.snapshot.snapshotKey);

      const fromReplacement = await collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
        fetchImpl: () => {
          throw new Error("cache read should avoid fetch");
        },
        cache,
        now: () => FIXTURE_NOW_MS,
      });
      expect(fromReplacement.ok).toBe(true);
      if (!fromReplacement.ok) return;
      expect(fromReplacement.snapshot.snapshotKey).toBe(refreshed.snapshot.snapshotKey);

      const failed = await collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
        fetchImpl: () =>
          Promise.resolve(new Response('{"message":"upstream failed"}', { status: 500 })),
        cache,
        cachePolicy: { read: false, write: true },
        now: () => FIXTURE_NOW_MS,
      });
      expect(failed.ok).toBe(false);

      const afterFailure = await collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
        fetchImpl: () => {
          throw new Error("valid replacement should survive failed refresh");
        },
        cache,
        now: () => FIXTURE_NOW_MS,
      });
      expect(afterFailure.ok).toBe(true);
      if (afterFailure.ok) {
        expect(afterFailure.snapshot.snapshotKey).toBe(refreshed.snapshot.snapshotKey);
      }
    },
  );
});

describe("battle caching end to end", () => {
  const rivals = [PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos] as const;

  /** Counts requests so a second invocation can be proven to make none. */
  const countingFetch = () => {
    const handlers = rivals.map((persona) => ({
      login: persona.login,
      fetchImpl: createFixtureFetch(persona),
    }));
    const calls: string[] = [];
    const fetchImpl: typeof globalThis.fetch = (input, init) => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(href);
      const match = handlers.find((handler) => href.includes(handler.login));
      if (match === undefined) {
        return Promise.resolve(new Response("{}", { status: 404 }));
      }
      return match.fetchImpl(input, init);
    };
    return { fetchImpl, calls };
  };

  const recordedTimestampFetch = () => {
    const routed = countingFetch();
    const fetchImpl: typeof globalThis.fetch = async (input, init) => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const response = await routed.fetchImpl(input, init);
      if (new URL(href).pathname === `/users/${PERSONAS.strongMaintainer.login}`) {
        const profile = (await response.json()) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ ...profile, created_at: RECORDED_GITHUB_CREATED_AT }),
          { status: response.status, headers: response.headers },
        );
      }
      return response;
    };
    return { fetchImpl, calls: routed.calls };
  };

  const invoke = (
    directory: string,
    fetchImpl: typeof globalThis.fetch,
    ...args: readonly string[]
  ) => {
    const context: CliContext = {
      invokedAs: "gitmog",
      version: "0.0.0",
      env: { GITMOG_CACHE_DIR: directory },
      fetchImpl,
      now: () => FIXTURE_NOW_MS,
      readAllowance: () =>
        Promise.resolve({
          ok: true,
          allowance: {
            authenticated: false,
            limit: 5_000,
            remaining: 5_000,
            resetAt: "2026-08-24T00:00:00.000Z",
            rateLimitClass: "none",
            retryAfterSeconds: null,
            source: "endpoint",
          },
        }),
    };
    return run(
      ["/usr/bin/node", "/bin/gitmog", "strongmaintainer", "sidequester", ...args],
      context,
    );
  };

  it("round-trips the recorded GitHub timestamp without changing canonical analysis", async () => {
    const directory = scratch();
    const { fetchImpl, calls } = recordedTimestampFetch();
    const first = await invoke(directory, fetchImpl, "--json");
    expect(first.exitCode).toBe(0);
    const callsAfterFirst = calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const key = snapshotCacheKey({
      login: PERSONAS.strongMaintainer.login,
      authenticated: false,
      maxInspectedRepositories: REQUEST_BUDGETS.anonymous.inspectedRepositories,
    });
    const snapshotCache = createFileSnapshotCache({
      directory: join(directory, "snapshots"),
      now: () => FIXTURE_NOW_MS,
    });
    const persisted = snapshotCache.get(key);
    expect(persisted?.profile.createdAt).toBe(RECORDED_GITHUB_CREATED_AT);
    expect(persisted === undefined ? false : isProfileSnapshot(persisted)).toBe(true);
    const snapshotKey = persisted?.snapshotKey;
    expect(snapshotKey).toMatch(/^[0-9a-f]{32}$/);

    const envelope = readdirSync(join(directory, "snapshots"))
      .map(
        (file) =>
          JSON.parse(readFileSync(join(directory, "snapshots", file), "utf8")) as Record<
            string,
            unknown
          >,
      )
      .find(
        (entry) =>
          ((entry.snapshot as { profile?: { login?: string } } | undefined)?.profile?.login ??
            "") === PERSONAS.strongMaintainer.login,
      );
    expect(envelope).toBeDefined();
    const { checksum, ...checksummedPayload } = envelope ?? {};
    expect(checksum).toBe(
      createHash("sha256").update(stableStringify(checksummedPayload)).digest("hex"),
    );

    let warmCalls = 0;
    const warm = await invoke(
      directory,
      () => {
        warmCalls += 1;
        return Promise.resolve(new Response("{}", { status: 500 }));
      },
      "--json",
    );
    expect(warm.exitCode).toBe(0);
    expect(warmCalls).toBe(0);
    expect(calls.length).toBe(callsAfterFirst);
    const firstPayload = JSON.parse(first.stdout) as {
      battle: { left: { overallScore: number; evidence: readonly unknown[] } };
      sourceAnalysis: { analysisKey: string; left: { codeDna: unknown } };
      story: unknown;
    };
    const warmPayload = JSON.parse(warm.stdout) as typeof firstPayload;
    expect(withoutOperationalRequestTelemetry(warmPayload)).toEqual(
      withoutOperationalRequestTelemetry(firstPayload),
    );
    expect(warmPayload.battle.left.overallScore).toBe(firstPayload.battle.left.overallScore);
    expect(warmPayload.sourceAnalysis.left.codeDna).toEqual(
      firstPayload.sourceAnalysis.left.codeDna,
    );
    expect(warmPayload.story).toEqual(firstPayload.story);
    expect(warmPayload.battle.left.evidence).toEqual(firstPayload.battle.left.evidence);
    expect(warmPayload.sourceAnalysis.analysisKey).toBe(firstPayload.sourceAnalysis.analysisKey);
    expect(snapshotCache.get(key)?.snapshotKey).toBe(snapshotKey);
    expect(snapshotCache.get(key)?.profile.createdAt).toBe(RECORDED_GITHUB_CREATED_AT);
  });

  it("re-reads nothing from GitHub on a second invocation", async () => {
    const directory = scratch();
    const { fetchImpl, calls } = countingFetch();

    const first = await invoke(directory, fetchImpl, "--json");
    expect(first.exitCode).toBe(0);
    const afterFirst = calls.length;
    expect(afterFirst).toBeGreaterThan(10);

    const second = await invoke(directory, fetchImpl, "--json");
    expect(second.exitCode).toBe(0);
    expect(calls.length).toBe(afterFirst);
    const firstPayload = JSON.parse(first.stdout) as unknown;
    const secondPayload = JSON.parse(second.stdout) as {
      sourceAnalysis: {
        requestBudget: {
          left: { metadata: number; source: number; total: number };
          right: { metadata: number; source: number; total: number };
          total: number;
        };
      };
    };
    expect(withoutOperationalRequestTelemetry(secondPayload)).toEqual(
      withoutOperationalRequestTelemetry(firstPayload),
    );
    expect(secondPayload.sourceAnalysis.requestBudget).toMatchObject({
      left: { metadata: 0, source: 0, total: 0 },
      right: { metadata: 0, source: 0, total: 0 },
      total: 0,
    });
  });

  it("--refresh re-reads GitHub and writes the replacement for the next invocation", async () => {
    const directory = scratch();
    const { fetchImpl, calls } = countingFetch();
    await invoke(directory, fetchImpl, "--json");
    const afterFirst = calls.length;
    // Keep the whole-profile analysis entry but remove immutable derived vectors so a
    // source-analysis cache read would be observable as zero blob calls.
    rmSync(join(directory, "features"), { recursive: true, force: true });
    const refreshed = await invoke(directory, fetchImpl, "--json", "--refresh");
    expect(calls.length).toBeGreaterThan(afterFirst);
    expect(calls.slice(afterFirst).some((href) => href.includes("/git/blobs/"))).toBe(true);
    const afterRefresh = calls.length;
    const next = await invoke(directory, fetchImpl, "--json");
    expect(calls.length).toBe(afterRefresh);
    expect(withoutOperationalRequestTelemetry(JSON.parse(next.stdout))).toEqual(
      withoutOperationalRequestTelemetry(JSON.parse(refreshed.stdout)),
    );
  });

  it("--no-cache writes nothing to disk", async () => {
    const directory = scratch();
    const { fetchImpl } = countingFetch();
    await invoke(directory, fetchImpl, "--json", "--no-cache");
    expect(readdirSync(directory)).toEqual([]);
  });

  it("caches only public evidence, never a token", async () => {
    const directory = scratch();
    const { fetchImpl } = countingFetch();
    const context: CliContext = {
      invokedAs: "gitmog",
      version: "0.0.0",
      env: { GITMOG_CACHE_DIR: directory, GITHUB_TOKEN: "ghp_disk_cache_secret" },
      fetchImpl,
      now: () => FIXTURE_NOW_MS,
      readAllowance: () =>
        Promise.resolve({
          ok: true,
          allowance: {
            authenticated: true,
            limit: 5_000,
            remaining: 5_000,
            resetAt: "2026-08-24T00:00:00.000Z",
            rateLimitClass: "none",
            retryAfterSeconds: null,
            source: "endpoint",
          },
        }),
    };
    const result = await run(
      ["/usr/bin/node", "/bin/gitmog", "strongmaintainer", "sidequester", "--json"],
      context,
    );
    expect(result.exitCode).toBe(0);
    const written = readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"));
    expect(written.length).toBeGreaterThan(0);
    for (const contents of written) {
      expect(contents).not.toContain("ghp_disk_cache_secret");
      expect(contents.toLowerCase()).not.toContain("authorization");
    }
  });
});
