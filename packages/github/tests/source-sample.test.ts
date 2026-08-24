import { Buffer } from "node:buffer";

import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
} from "@gitmog/test-fixtures/github-personas";
import { describe, expect, it } from "vitest";

import { collectProfileSnapshot } from "../src/collect.js";
import { stableStringify } from "../src/digest.js";
import {
  MAX_SAMPLE_BYTES_PER_FILE,
  MAX_SAMPLE_BYTES_TOTAL,
  collectSourceSamples,
  isEligibleSourcePath,
  isTestSamplePath,
  rankSourceFiles,
  resolveSourceOpportunityScope,
  selectSampleRepositories,
  sourceReceiptId,
  sourceFileScore,
  type SourceTreeBlob,
} from "../src/source-sample.js";
import type {
  DerivedFeatureCache,
  DerivedFeatureCacheEntry,
  ProfileSnapshot,
  SourceSampleSet,
} from "../src/types.js";

const blob = (path: string, sizeBytes: number): SourceTreeBlob => ({
  path,
  sha: `sha-${path}`,
  sizeBytes,
});

async function snapshotOf(persona: (typeof PERSONAS)[keyof typeof PERSONAS]) {
  const result = await collectProfileSnapshot(persona.login, {
    fetchImpl: createFixtureFetch(persona),
    cache: null,
    now: () => FIXTURE_NOW_MS,
  });
  if (!result.ok) throw new Error(`fixture ${persona.login} failed: ${result.error.code}`);
  return result.snapshot;
}

const withSourceBudget = (snapshot: ProfileSnapshot, remaining: number): ProfileSnapshot => ({
  ...snapshot,
  budget: {
    ...snapshot.budget,
    maxRequests: 16,
    usedRequests: 16 - remaining,
  },
});

const duplicateShaSnapshot = async (
  paths: readonly string[],
  remaining = 4,
): Promise<ProfileSnapshot> => {
  const snapshot = await snapshotOf(PERSONAS.strongMaintainer);
  const repository = snapshot.repositories.find(
    (entry) => entry.name === snapshot.selectedRepositories[0],
  );
  if (repository === undefined) throw new Error("fixture repository missing");
  const inspection = snapshot.inspections.find((entry) => entry.name === repository.name);
  if (inspection === undefined) throw new Error("fixture inspection missing");
  return withSourceBudget(
    {
      ...snapshot,
      repositories: [repository],
      selectedRepositories: [repository.name],
      inspections: [
        {
          ...inspection,
          treeSha: "tree-duplicate",
          tree: paths.map((path) => ({
            path,
            type: "blob" as const,
            sizeBytes: 4_000,
            sha: "same-sha",
          })),
        },
      ],
    },
    remaining,
  );
};

const githubResponse = (body: unknown, status = 200, remaining = 40): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-limit": "60",
      "x-ratelimit-remaining": String(remaining),
      "x-ratelimit-reset": String(Math.floor((FIXTURE_NOW_MS + 3_600_000) / 1_000)),
    },
  });

const requestHref = (input: string | URL | Request): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const memoryDerivedCache = (): DerivedFeatureCache => {
  const entries = new Map<string, DerivedFeatureCacheEntry>();
  return {
    get(key) {
      return entries.get(stableStringify(key));
    },
    set(key, value) {
      entries.set(stableStringify(key), value);
    },
  };
};

describe("source path eligibility", () => {
  it.each([
    ["src/index.ts", true],
    ["internal/server.go", true],
    ["packages/core/src/engine.ts", true],
    ["node_modules/pkg/index.js", false],
    ["dist/index.js", false],
    ["out/main.js", false],
    ["src/client.generated.ts", false],
    ["src/index.d.ts", false],
    ["api/v1_pb2.py", false],
    ["internal/store.pb.go", false],
    ["__snapshots__/render.snap", false],
    ["test/fixtures/payload.ts", false],
    ["src/__mocks__/client.ts", false],
    ["db/migrations/0001_init.ts", false],
    ["third_party/lib/a.c", false],
    ["README.md", false],
    ["pnpm-lock.yaml", false],
  ])("classifies %s as eligible=%s", (path, expected) => {
    expect(isEligibleSourcePath(path)).toBe(expected);
  });

  it.each([
    ["tests/render.test.ts", true],
    ["src/render.spec.ts", true],
    ["internal/store_test.go", true],
    ["tests/test_ingest.py", true],
    ["e2e/checkout.ts", true],
    ["src/render.ts", false],
  ])("classifies %s as a test sample: %s", (path, expected) => {
    expect(isTestSamplePath(path)).toBe(expected);
  });
});

describe("representative file ranking", () => {
  it("prefers a moderate implementation file over a barrel, a config and a giant", () => {
    const ranked = rankSourceFiles([
      blob("src/index.ts", 4_000),
      blob("src/engine.ts", 4_000),
      blob("src/config.ts", 4_000),
      blob("src/monolith.ts", 400_000),
      blob("tiny.ts", 90),
    ]);
    expect(ranked[0]?.blob.path).toBe("src/engine.ts");
    const paths = ranked.map((entry) => entry.blob.path);
    expect(paths.indexOf("src/engine.ts")).toBeLessThan(paths.indexOf("src/index.ts"));
    expect(paths.indexOf("src/index.ts")).toBeLessThan(paths.indexOf("src/monolith.ts"));
  });

  it("ranks a test file below every implementation file of the same size", () => {
    const ranked = rankSourceFiles([
      blob("tests/engine.test.ts", 4_000),
      blob("src/engine.ts", 4_000),
    ]);
    expect(ranked[0]?.blob.path).toBe("src/engine.ts");
    expect(ranked[1]?.isTest).toBe(true);
  });

  it("is deterministic: input order cannot change the result", () => {
    const entries = [
      blob("src/a.ts", 3_000),
      blob("src/b.ts", 3_000),
      blob("src/c.ts", 3_000),
      blob("lib/d.ts", 3_000),
    ];
    const forward = rankSourceFiles(entries).map((entry) => entry.blob.path);
    const reversed = rankSourceFiles([...entries].reverse()).map((entry) => entry.blob.path);
    expect(reversed).toEqual(forward);
  });

  it("scores an implementation directory above a repository root file", () => {
    expect(sourceFileScore(blob("src/engine.ts", 4_000))).toBeGreaterThan(
      sourceFileScore(blob("engine.ts", 4_000)),
    );
  });
});

describe("representative repository selection", () => {
  it("uses the collector's representative order, not the newest push", async () => {
    const snapshot = await snapshotOf(PERSONAS.strongMaintainer);
    const selected = selectSampleRepositories(snapshot).map((repository) => repository.name);
    expect(selected).toHaveLength(3);
    // The collector already inspected these three, so their trees are known readable.
    expect(new Set(selected)).toEqual(new Set(snapshot.selectedRepositories));
  });

  it("never selects a fork, a template or an empty repository", async () => {
    const snapshot = await snapshotOf(PERSONAS.forkCollector);
    const selected = selectSampleRepositories(snapshot);
    expect(selected.every((repository) => !repository.fork)).toBe(true);
  });
});

describe("collectSourceSamples", () => {
  it("resolves one logical opportunity scope for sampling regardless of auth or telemetry", async () => {
    const snapshot = withSourceBudget(await snapshotOf(PERSONAS.strongMaintainer), 2);
    expect(resolveSourceOpportunityScope(snapshot)).toEqual({ sourceRequestAllowance: 2 });
    expect(resolveSourceOpportunityScope(snapshot, { maxRequests: 10 })).toEqual({
      sourceRequestAllowance: 10,
    });
    expect(resolveSourceOpportunityScope(snapshot, { maxRequests: -1 })).toEqual({
      sourceRequestAllowance: 0,
    });
  });

  it.each(["non-text", "redaction-threshold", "blob-unavailable"] as const)(
    "promotes a bounded backup after a %s source read",
    async (failureReason) => {
      const base = withSourceBudget(await snapshotOf(PERSONAS.strongMaintainer), 4);
      const repositories = selectSampleRepositories(base);
      const first = repositories[0];
      const second = repositories[1];
      const third = repositories[2];
      if (first === undefined || second === undefined || third === undefined) {
        throw new Error("three source repositories are required");
      }
      const trees = new Map([
        [
          first.name,
          [
            { path: "src/bad.ts", sha: "failed-read", sizeBytes: 4_000 },
            { path: "index.ts", sha: "backup", sizeBytes: 4_000 },
          ],
        ],
        [second.name, [{ path: "src/good-b.ts", sha: "good-b", sizeBytes: 4_000 }]],
        [third.name, [{ path: "src/good-c.ts", sha: "good-c", sizeBytes: 4_000 }]],
      ]);
      const snapshot: ProfileSnapshot = {
        ...base,
        inspections: base.inspections.map((inspection) => {
          const tree = trees.get(inspection.name);
          return tree === undefined
            ? inspection
            : {
                ...inspection,
                treeSha: `tree-${inspection.name}`,
                tree: tree.map((entry) => ({ ...entry, type: "blob" as const })),
              };
        }),
      };
      const attempted: string[] = [];
      const validSource = Buffer.from(
        "export function valid(value: string) { return value.trim(); }\n".repeat(30),
      ).toString("base64");
      const redactionRejected = Buffer.from(
        [
          "-----BEGIN RSA PRIVATE KEY-----",
          "a".repeat(2_000),
          "-----END RSA PRIVATE KEY-----",
          "export const value = true;",
        ].join("\n"),
      ).toString("base64");
      const set = await collectSourceSamples(snapshot, {
        fetchImpl: (input) => {
          const sha = requestHref(input).split("/").at(-1) ?? "";
          attempted.push(sha);
          if (sha !== "failed-read") {
            return Promise.resolve(githubResponse({ encoding: "base64", content: validSource }));
          }
          if (failureReason === "blob-unavailable") {
            return Promise.resolve(githubResponse({ message: "Not Found" }, 404));
          }
          return Promise.resolve(
            githubResponse({
              encoding: "base64",
              content:
                failureReason === "non-text"
                  ? Buffer.from([0, 1, 2]).toString("base64")
                  : redactionRejected,
            }),
          );
        },
      });

      expect(attempted).toEqual(["failed-read", "good-b", "good-c", "backup"]);
      expect(set.requestsUsed).toBe(4);
      expect(set.samples.map((sample) => sample.path)).toEqual([
        "src/good-b.ts",
        "src/good-c.ts",
        "index.ts",
      ]);
      expect(set.failures).toContainEqual(
        expect.objectContaining({ reason: failureReason, path: "src/bad.ts" }),
      );
    },
  );

  it("does not let four advertised oversized candidates hide a valid fifth file", async () => {
    const base = await duplicateShaSnapshot(["src/base.ts"], 5);
    const snapshot = {
      ...base,
      inspections: base.inspections.map((inspection) => ({
        ...inspection,
        tree: [
          ...Array.from({ length: 4 }, (_value, index) => ({
            path: `src/oversized-${String(index)}.ts`,
            type: "blob" as const,
            sizeBytes: MAX_SAMPLE_BYTES_PER_FILE + 1,
            sha: `oversized-${String(index)}`,
          })),
          {
            path: "index.ts",
            type: "blob" as const,
            sizeBytes: 4_000,
            sha: "valid-fifth",
          },
        ],
      })),
    };
    const calls: string[] = [];
    const set = await collectSourceSamples(snapshot, {
      fetchImpl: (input) => {
        calls.push(requestHref(input));
        return Promise.resolve(
          githubResponse({
            encoding: "base64",
            content: Buffer.from("export const valid = true;\n".repeat(40)).toString("base64"),
          }),
        );
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("valid-fifth");
    expect(set.requestsUsed).toBe(1);
    expect(set.samples.map((sample) => sample.path)).toEqual(["index.ts"]);
    expect(set.failures.filter((failure) => failure.reason === "oversized")).toHaveLength(4);
  });

  it("prefilters a tree entry advertised above the source ceiling without a blob request", async () => {
    const base = await duplicateShaSnapshot(["src/advertised-large.ts"]);
    const snapshot = {
      ...base,
      inspections: base.inspections.map((inspection) => ({
        ...inspection,
        tree: inspection.tree?.map((entry) => ({ ...entry, sizeBytes: 200_000_000 })) ?? null,
      })),
    };
    const calls: string[] = [];
    const set = await collectSourceSamples(snapshot, {
      fetchImpl: (input) => {
        calls.push(requestHref(input));
        return Promise.resolve(githubResponse({ encoding: "base64", content: "" }));
      },
    });
    expect(calls).toHaveLength(0);
    expect(set.requestsUsed).toBe(0);
    expect(set.samples).toEqual([]);
    expect(set.failures).toContainEqual(
      expect.objectContaining({ reason: "oversized", path: "src/advertised-large.ts" }),
    );
  });

  it("records a bounded oversized limitation when every advertised candidate is oversized", async () => {
    const base = await duplicateShaSnapshot(["src/base.ts"], 8);
    const snapshot = {
      ...base,
      inspections: base.inspections.map((inspection) => ({
        ...inspection,
        tree: Array.from({ length: 40 }, (_value, index) => ({
          path: `src/oversized-${String(index)}.ts`,
          type: "blob" as const,
          sizeBytes: MAX_SAMPLE_BYTES_PER_FILE + index + 1,
          sha: `oversized-${String(index)}`,
        })),
      })),
    };
    let calls = 0;
    const set = await collectSourceSamples(snapshot, {
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(githubResponse({}));
      },
    });
    expect(calls).toBe(0);
    expect(set.requestsUsed).toBe(0);
    expect(set.samples).toEqual([]);
    expect(set.zeroSampleReason).toBe("oversized");
    expect(set.failures).toHaveLength(8);
    expect(set.failures.every((failure) => failure.reason === "oversized")).toBe(true);
  });

  it("streams an unknown-size oversized response to its ceiling and still reads a later candidate", async () => {
    const base = await duplicateShaSnapshot(["src/base.ts"], 4);
    const snapshot = {
      ...base,
      inspections: base.inspections.map((inspection) => ({
        ...inspection,
        tree: [
          {
            path: "src/unknown-size.ts",
            type: "blob" as const,
            sizeBytes: 0,
            sha: "unknown-size",
          },
          {
            path: "index.ts",
            type: "blob" as const,
            sizeBytes: 4_000,
            sha: "valid-after-stream",
          },
        ],
      })),
    };
    let calls = 0;
    let canceled = false;
    const set = await collectSourceSamples(snapshot, {
      fetchImpl: (input) => {
        calls += 1;
        if (requestHref(input).includes("unknown-size")) {
          const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new TextEncoder().encode("x".repeat(8_000)));
            },
            cancel() {
              canceled = true;
            },
          });
          return Promise.resolve(new Response(stream));
        }
        return Promise.resolve(
          githubResponse({
            encoding: "base64",
            content: Buffer.from("export const recovered = true;\n".repeat(40)).toString("base64"),
          }),
        );
      },
    });
    expect(calls).toBe(2);
    expect(set.requestsUsed).toBe(2);
    expect(canceled).toBe(true);
    expect(set.failures).toContainEqual(
      expect.objectContaining({ reason: "oversized", path: "src/unknown-size.ts" }),
    );
    expect(set.samples.map((sample) => sample.path)).toEqual(["index.ts"]);
  });

  it("rejects an oversized blob envelope after one accepted HTTP call", async () => {
    const snapshot = await duplicateShaSnapshot(["src/dishonest-size.ts"]);
    const raw = "export const value = 1;\n".repeat(90_000);
    const set = await collectSourceSamples(snapshot, {
      fetchImpl: () =>
        Promise.resolve(
          githubResponse({
            size: Buffer.byteLength(raw),
            encoding: "base64",
            content: Buffer.from(raw).toString("base64"),
          }),
        ),
    });
    expect(set.requestsUsed).toBe(1);
    expect(set.samples).toEqual([]);
    expect(set.failures).toContainEqual(expect.objectContaining({ reason: "oversized" }));
  });

  it("rejects false-small API size before decoding an over-limit base64 allocation", async () => {
    const base = await duplicateShaSnapshot(["src/false-small.ts"]);
    const snapshot = {
      ...base,
      inspections: base.inspections.map((inspection) => ({
        ...inspection,
        tree: inspection.tree?.map((entry) => ({ ...entry, sizeBytes: 1 })) ?? null,
      })),
    };
    const raw = "x".repeat(MAX_SAMPLE_BYTES_PER_FILE + 1);
    const cache = memoryDerivedCache();
    let cacheWrites = 0;
    const set = await collectSourceSamples(snapshot, {
      derivedCache: {
        get: (key) => cache.get(key),
        set: (key, value) => {
          cacheWrites += 1;
          cache.set(key, value);
        },
      },
      fetchImpl: () =>
        Promise.resolve(
          githubResponse({
            size: 1,
            encoding: "base64",
            content: Buffer.from(raw).toString("base64"),
          }),
        ),
    });
    expect(set.requestsUsed).toBe(1);
    expect(set.samples).toEqual([]);
    expect(set.failures).toContainEqual(expect.objectContaining({ reason: "oversized" }));
    expect(cacheWrites).toBe(0);
  });

  it("accepts exactly 12,000 decoded bytes", async () => {
    const base = await duplicateShaSnapshot(["src/exact-limit.ts"]);
    const snapshot = {
      ...base,
      inspections: base.inspections.map((inspection) => ({
        ...inspection,
        tree:
          inspection.tree?.map((entry) => ({
            ...entry,
            sizeBytes: MAX_SAMPLE_BYTES_PER_FILE,
          })) ?? null,
      })),
    };
    const raw = "x\n".repeat(MAX_SAMPLE_BYTES_PER_FILE / 2);
    const set = await collectSourceSamples(snapshot, {
      fetchImpl: () =>
        Promise.resolve(
          githubResponse({
            size: MAX_SAMPLE_BYTES_PER_FILE,
            encoding: "base64",
            content: Buffer.from(raw).toString("base64"),
          }),
        ),
    });
    expect(set.requestsUsed).toBe(1);
    expect(set.failures).toEqual([]);
    expect(set.samples).toHaveLength(1);
    expect(set.samples[0]?.byteLength).toBe(MAX_SAMPLE_BYTES_PER_FILE);
  });

  it("rejects one decoded byte over the active file limit", async () => {
    const base = await duplicateShaSnapshot(["src/one-over.ts"]);
    const snapshot = {
      ...base,
      inspections: base.inspections.map((inspection) => ({
        ...inspection,
        tree:
          inspection.tree?.map((entry) => ({
            ...entry,
            sizeBytes: MAX_SAMPLE_BYTES_PER_FILE,
          })) ?? null,
      })),
    };
    const raw = "x".repeat(MAX_SAMPLE_BYTES_PER_FILE + 1);
    const set = await collectSourceSamples(snapshot, {
      fetchImpl: () =>
        Promise.resolve(
          githubResponse({
            size: MAX_SAMPLE_BYTES_PER_FILE + 1,
            encoding: "base64",
            content: Buffer.from(raw).toString("base64"),
          }),
        ),
    });
    expect(set.requestsUsed).toBe(1);
    expect(set.samples).toEqual([]);
    expect(set.failures).toContainEqual(expect.objectContaining({ reason: "oversized" }));
  });

  it("rejects malformed base64 without throwing or caching derived data", async () => {
    const snapshot = await duplicateShaSnapshot(["src/malformed.ts"]);
    let cacheWrites = 0;
    const set = await collectSourceSamples(snapshot, {
      derivedCache: {
        get: () => undefined,
        set: () => {
          cacheWrites += 1;
        },
      },
      fetchImpl: () =>
        Promise.resolve(githubResponse({ size: 3, encoding: "base64", content: "!!!!" })),
    });
    expect(set.requestsUsed).toBe(1);
    expect(set.samples).toEqual([]);
    expect(set.failures).toContainEqual(expect.objectContaining({ reason: "non-text" }));
    expect(cacheWrites).toBe(0);
  });

  it("reads bounded, redacted samples spread across repositories", async () => {
    const snapshot = await snapshotOf(PERSONAS.strongMaintainer);
    const first = await collectSourceSamples(snapshot, {
      fetchImpl: createFixtureFetch(PERSONAS.strongMaintainer),
    });

    expect(first.samples.length).toBeGreaterThanOrEqual(2);
    expect(first.samples.length).toBeLessThanOrEqual(4);
    expect(first.repositoriesRepresented).toBeGreaterThanOrEqual(2);
    expect(first.totalBytes).toBeLessThanOrEqual(MAX_SAMPLE_BYTES_TOTAL);
    for (const sample of first.samples) {
      expect(sample.byteLength).toBeLessThanOrEqual(MAX_SAMPLE_BYTES_PER_FILE);
      expect(sample.sourceUrl).toMatch(/^https:\/\/github\.com\//);
      expect(sample.sampleId).toMatch(/^s[0-9a-f]{32}$/);
    }
    // A test file never takes the first slot.
    expect(first.samples[0]?.isTest).toBe(false);

    const second = await collectSourceSamples(snapshot, {
      fetchImpl: createFixtureFetch(PERSONAS.strongMaintainer),
    });
    expect(second.sampleKey).toBe(first.sampleKey);
    expect(second.samples.map((sample) => sample.path)).toEqual(
      first.samples.map((sample) => sample.path),
    );
  });

  it("assigns every sample a unique receipt id", async () => {
    const snapshot = await snapshotOf(PERSONAS.strongMaintainer);
    const set = await collectSourceSamples(snapshot, {
      fetchImpl: createFixtureFetch(PERSONAS.strongMaintainer),
    });
    const ids = set.samples.map((sample) => sample.sampleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("redacts secret-shaped values before deterministic feature extraction", async () => {
    const persona = {
      ...PERSONAS.strongMaintainer,
      trees: {
        ...PERSONAS.strongMaintainer.trees,
        orchestrator: ["src/auth.ts"],
      },
      sourceFiles: {
        orchestrator: {
          "src/auth.ts": [
            "const apiKey = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';",
            "export const password = 'hunter2-not-really-a-password';",
            "export function authorize(request: Request) {",
            "  return request.headers.get('authorization');",
            "}",
            ...Array.from(
              { length: 60 },
              (_value, index) =>
                `export function handler${String(index)}(value: string) { return value.trim(); }`,
            ),
          ].join("\n"),
        },
      },
    };
    const snapshot = await snapshotOf(persona);
    const set = await collectSourceSamples(snapshot, { fetchImpl: createFixtureFetch(persona) });
    expect(set.samples.some((sample) => sample.path === "src/auth.ts")).toBe(true);
    expect(set.samples.find((sample) => sample.path === "src/auth.ts")?.redactions).toBeGreaterThan(
      0,
    );
    expect(JSON.stringify(set)).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
    expect(JSON.stringify(set)).not.toContain("hunter2-not-really-a-password");
    expect(JSON.stringify(set)).not.toContain('"content"');
  });

  it("skips a file that is almost entirely secret-shaped values", async () => {
    const key = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "a".repeat(2_000),
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const persona = {
      ...PERSONAS.strongMaintainer,
      trees: {
        ...PERSONAS.strongMaintainer.trees,
        orchestrator: ["src/auth.ts"],
      },
      sourceFiles: { orchestrator: { "src/auth.ts": `${key}\nexport const x = 1;\n` } },
    };
    const snapshot = await snapshotOf(persona);
    const set = await collectSourceSamples(snapshot, { fetchImpl: createFixtureFetch(persona) });
    expect(set.samples.some((sample) => sample.path === "src/auth.ts")).toBe(false);
    expect(set.failures.some((failure) => failure.reason === "redaction-threshold")).toBe(true);
  });

  it("reports a repository whose tree cannot be read without failing", async () => {
    const snapshot = await snapshotOf(PERSONAS.partialTreeFailure);
    const set = await collectSourceSamples(snapshot, {
      fetchImpl: createFixtureFetch(PERSONAS.partialTreeFailure),
    });
    expect(set.failures.length).toBeGreaterThan(0);
    expect(set.failures.some((failure) => failure.reason === "tree-unavailable")).toBe(true);
    expect(set.samples.length).toBeGreaterThan(0);
  });

  it("returns no samples for a profile with no readable source", async () => {
    const snapshot = await snapshotOf(PERSONAS.lowPublicEvidence);
    const set = await collectSourceSamples(snapshot, {
      fetchImpl: createFixtureFetch(PERSONAS.lowPublicEvidence),
    });
    expect(set.samples).toHaveLength(0);
    expect(set.zeroSampleReason).toBe("no-source-candidate");
  });

  it("carries a structured rate-limit reason instead of claiming source does not exist", async () => {
    const snapshot = await snapshotOf(PERSONAS.strongMaintainer);
    const rateLimited = {
      ...PERSONAS.strongMaintainer,
      failures: { "/git/blobs/": 403 },
      rateLimitRemaining: 0,
    };
    const set = await collectSourceSamples(snapshot, {
      fetchImpl: createFixtureFetch(rateLimited),
    });
    expect(set.samples).toHaveLength(0);
    expect(set.zeroSampleReason).toBe("rate-limited");
    expect(set.failures.every((failure) => typeof failure.detail === "string")).toBe(true);
  });

  it("fetches one duplicate blob once while rebuilding unique path-specific receipts", async () => {
    const snapshot = await duplicateShaSnapshot(["src/alpha.ts", "src/beta.ts"], 1);
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (input) => {
      calls.push(requestHref(input));
      return Promise.resolve(
        githubResponse({
          encoding: "base64",
          content: Buffer.from(
            "export function shared(value: string) { return value.trim(); }\n".repeat(30),
          ).toString("base64"),
        }),
      );
    };
    const cache = memoryDerivedCache();
    const first = await collectSourceSamples(snapshot, { fetchImpl, derivedCache: cache });
    expect(calls).toHaveLength(1);
    expect(first.samples.map((sample) => sample.path).toSorted()).toEqual([
      "src/alpha.ts",
      "src/beta.ts",
    ]);
    expect(new Set(first.samples.map((sample) => sample.sampleId)).size).toBe(2);
    expect(first.samples.every((sample) => sample.sourceUrl.includes(sample.path))).toBe(true);
    expect(first.failures).not.toContainEqual(
      expect.objectContaining({ reason: "request-budget-exhausted" }),
    );

    calls.length = 0;
    const second = await collectSourceSamples(snapshot, { fetchImpl, derivedCache: cache });
    expect(calls).toHaveLength(0);
    expect(second.samples).toEqual(first.samples);

    const uncachedCalls: string[] = [];
    const uncached = await collectSourceSamples(snapshot, {
      fetchImpl: (input) => {
        uncachedCalls.push(requestHref(input));
        return Promise.resolve(
          githubResponse({
            encoding: "base64",
            content: Buffer.from(
              "export function shared(value: string) { return value.trim(); }\n".repeat(30),
            ).toString("base64"),
          }),
        );
      },
      derivedCache: null,
    });
    expect(uncachedCalls).toHaveLength(1);
    expect(uncached.samples).toEqual(first.samples);
  });

  it("keeps one-request candidate selection and canonical samples invariant as caches warm", async () => {
    const base = await duplicateShaSnapshot(["src/alpha.ts", "src/beta.ts", "src/gamma.ts"], 1);
    const snapshot: ProfileSnapshot = {
      ...base,
      inspections: base.inspections.map((inspection) => ({
        ...inspection,
        tree:
          inspection.tree?.map((entry, index) => ({
            ...entry,
            sha: String(index + 1).padStart(40, "0"),
          })) ?? null,
      })),
    };
    const cache = memoryDerivedCache();
    const runs: SourceSampleSet[] = [];
    const calls: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      let count = 0;
      runs.push(
        await collectSourceSamples(snapshot, {
          derivedCache: cache,
          fetchImpl: () => {
            count += 1;
            return Promise.resolve(
              githubResponse({
                encoding: "base64",
                content: Buffer.from(
                  "export function stable(value: string) { return value.trim(); }\n".repeat(30),
                ).toString("base64"),
              }),
            );
          },
        }),
      );
      calls.push(count);
    }
    expect(runs.map((set) => set.samples.map((sample) => sample.path))).toEqual([
      runs[0]!.samples.map((sample) => sample.path),
      runs[0]!.samples.map((sample) => sample.path),
      runs[0]!.samples.map((sample) => sample.path),
    ]);
    expect(runs.map((set) => set.samples.map((sample) => sample.sampleId))).toEqual([
      runs[0]!.samples.map((sample) => sample.sampleId),
      runs[0]!.samples.map((sample) => sample.sampleId),
      runs[0]!.samples.map((sample) => sample.sampleId),
    ]);
    expect(runs.every((set) => set.samples.length === 1)).toBe(true);
    expect(runs.every((set) => set.sampleKey === runs[0]!.sampleKey)).toBe(true);
    expect(
      runs.every(
        (set) =>
          set.failures.map((failure) => failure.reason).join() ===
          runs[0]!.failures.map((failure) => failure.reason).join(),
      ),
    ).toBe(true);
    expect(calls).toEqual([1, 0, 0]);
  });

  it("applies refresh and no-cache policy to derived-feature reads and writes", async () => {
    const snapshot = await duplicateShaSnapshot(["src/refresh.ts"], 1);
    const backing = memoryDerivedCache();
    const body = {
      encoding: "base64",
      content: Buffer.from(
        "export function refreshed(value: string) { return value.trim(); }\n".repeat(30),
      ).toString("base64"),
    };
    await collectSourceSamples(snapshot, {
      derivedCache: backing,
      fetchImpl: () => Promise.resolve(githubResponse(body)),
    });

    let reads = 0;
    let writes = 0;
    let refreshCalls = 0;
    const observed: DerivedFeatureCache = {
      get(key) {
        reads += 1;
        return backing.get(key);
      },
      set(key, value) {
        writes += 1;
        backing.set(key, value);
      },
    };
    await collectSourceSamples(snapshot, {
      derivedCache: observed,
      cachePolicy: { read: false, write: true },
      fetchImpl: () => {
        refreshCalls += 1;
        return Promise.resolve(githubResponse(body));
      },
    });
    expect({ reads, writes, refreshCalls }).toEqual({ reads: 0, writes: 1, refreshCalls: 1 });

    writes = 0;
    let noCacheCalls = 0;
    await collectSourceSamples(snapshot, {
      derivedCache: observed,
      cachePolicy: { read: false, write: false },
      fetchImpl: () => {
        noCacheCalls += 1;
        return Promise.resolve(githubResponse(body));
      },
    });
    expect(reads).toBe(0);
    expect(writes).toBe(0);
    expect(noCacheCalls).toBe(1);
  });

  it("keeps language, test classification, and selection score path-specific for one SHA", async () => {
    const snapshot = await duplicateShaSnapshot([
      "src/implementation.ts",
      "tests/implementation.test.py",
    ]);
    let calls = 0;
    const set = await collectSourceSamples(snapshot, {
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(
          githubResponse({
            encoding: "base64",
            content: Buffer.from(
              "def shared(value: str):\n    if value:\n        return value.strip()\n".repeat(30),
            ).toString("base64"),
          }),
        );
      },
      derivedCache: null,
    });
    expect(calls).toBe(1);
    expect(set.samples).toHaveLength(2);
    const typescript = set.samples.find((sample) => sample.path.endsWith(".ts"));
    const python = set.samples.find((sample) => sample.path.endsWith(".py"));
    expect(typescript?.features.language).toBe("typescript");
    expect(python?.features.language).toBe("python");
    expect(typescript?.isTest).toBe(false);
    expect(python?.isTest).toBe(true);
    expect(typescript?.selectionScore).not.toBe(python?.selectionScore);
  });

  it("reports actual HTTP calls for non-text, redaction, and zero-slot failures", async () => {
    const baseSnapshot = await snapshotOf(PERSONAS.strongMaintainer);
    for (const content of [
      Buffer.from([0, 1, 2]).toString("base64"),
      Buffer.from(
        `-----BEGIN RSA PRIVATE KEY-----\n${"a".repeat(2_000)}\n-----END RSA PRIVATE KEY-----`,
      ).toString("base64"),
    ]) {
      let calls = 0;
      const set = await collectSourceSamples(withSourceBudget(baseSnapshot, 1), {
        fetchImpl: () => {
          calls += 1;
          return Promise.resolve(githubResponse({ encoding: "base64", content }));
        },
      });
      expect(calls).toBe(1);
      expect(set.requestsUsed).toBe(1);
    }

    let zeroCalls = 0;
    const zero = await collectSourceSamples(withSourceBudget(baseSnapshot, 0), {
      fetchImpl: () => {
        zeroCalls += 1;
        return Promise.resolve(githubResponse({}));
      },
    });
    expect(zeroCalls).toBe(0);
    expect(zero.requestsUsed).toBe(0);
  });

  it("cannot spend more source calls than the remaining allowance across three repositories", async () => {
    const snapshot = withSourceBudget(await snapshotOf(PERSONAS.strongMaintainer), 1);
    let calls = 0;
    const set = await collectSourceSamples(snapshot, {
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(
          githubResponse({
            encoding: "base64",
            content: Buffer.from("export const measured = true;\n".repeat(40)).toString("base64"),
          }),
        );
      },
    });
    expect(selectSampleRepositories(snapshot)).toHaveLength(3);
    expect(calls).toBe(1);
    expect(set.requestsUsed).toBe(1);
    expect(set.repositoriesRepresented).toBeLessThanOrEqual(1);
  });

  it("stops the entire source pass after the first rate-limit response", async () => {
    const snapshot = withSourceBudget(await snapshotOf(PERSONAS.strongMaintainer), 4);
    let calls = 0;
    const set = await collectSourceSamples(snapshot, {
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(githubResponse({ message: "API rate limit exceeded" }, 403, 0));
      },
    });
    expect(calls).toBe(1);
    expect(set.requestsUsed).toBe(1);
    expect(set.zeroSampleReason).toBe("rate-limited");
    expect(set.samples).toEqual([]);
  });

  it("preserves earlier samples and never reads a known rate-limit body or later candidate", async () => {
    const snapshot = withSourceBudget(await snapshotOf(PERSONAS.strongMaintainer), 4);
    let calls = 0;
    let canceled = false;
    const set = await collectSourceSamples(snapshot, {
      fetchImpl: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(
            githubResponse({
              encoding: "base64",
              content: Buffer.from("export const first = true;\n".repeat(40)).toString("base64"),
            }),
          );
        }
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("x".repeat(2_000_000)));
          },
          cancel() {
            canceled = true;
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 403,
            headers: { "x-ratelimit-remaining": "0" },
          }),
        );
      },
    });
    expect(calls).toBe(2);
    expect(set.requestsUsed).toBe(2);
    expect(set.samples).toHaveLength(1);
    expect(set.failures).toContainEqual(expect.objectContaining({ reason: "rate-limited" }));
    expect(set.failures).not.toContainEqual(expect.objectContaining({ reason: "oversized" }));
    expect(canceled).toBe(true);
  });
});

describe("source receipt identity", () => {
  const identity = {
    repositoryId: 1,
    repository: "owner/repo",
    revision: "tree-1",
    blobSha: "blob-1",
    rawPath: "src/café.ts",
  } as const;

  it("is deterministic, collision-resistant across immutable identity fields, and render-safe", () => {
    const expected = sourceReceiptId(identity);
    expect(sourceReceiptId(identity)).toBe(expected);
    expect(expected).toMatch(/^s[0-9a-f]{32}$/);
    expect(sourceReceiptId({ ...identity, rawPath: "src/other.ts" })).not.toBe(expected);
    expect(sourceReceiptId({ ...identity, blobSha: "blob-2" })).not.toBe(expected);
    expect(sourceReceiptId({ ...identity, repository: "other/repo" })).not.toBe(expected);
    expect(sourceReceiptId({ ...identity, repositoryId: 2 })).not.toBe(expected);
    expect(sourceReceiptId({ ...identity, revision: "tree-2" })).not.toBe(expected);
    expect(Array.from(expected).some((character) => character.charCodeAt(0) < 32)).toBe(false);
  });

  it("keeps visually equivalent NFC and NFD Git paths distinct", () => {
    const nfc = sourceReceiptId({ ...identity, rawPath: "src/café.ts", blobSha: "blob-nfc" });
    const nfd = sourceReceiptId({
      ...identity,
      rawPath: "src/cafe\u0301.ts",
      blobSha: "blob-nfd",
    });
    expect(nfd).not.toBe(nfc);
  });

  it("uses unambiguous structured fields rather than delimiter concatenation", () => {
    const left = sourceReceiptId({ ...identity, blobSha: "blob:a", rawPath: "b.ts" });
    const right = sourceReceiptId({ ...identity, blobSha: "blob", rawPath: "a:b.ts" });
    expect(right).not.toBe(left);
  });
});
