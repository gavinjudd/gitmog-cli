import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeQualitySourceFiles } from "../src/sync-analyze.js";
import {
  createFileQualityResultCache,
  isQualityCacheSafe,
  isQualityJudgeResult,
  qualityResultValidationCode,
  qualityResultCacheKey,
} from "../src/cache.js";

const rawMarker = "process-only-quality-cache-marker";
const result = analyzeQualitySourceFiles([
  {
    repository: "example/project",
    commitSha: "1".repeat(40),
    blobSha: "2".repeat(40),
    path: "src/example.ts",
    sourceUrl: `https://github.com/example/project/blob/${"1".repeat(40)}/src/example.ts`,
    source:
      'export function validate(value: unknown): boolean { return value === "process-only-quality-cache-marker"; }',
    byteLength: 104,
    isTest: false,
    attribution: { status: "attributed", commitSha: "3".repeat(40) },
  },
  {
    repository: "example/project",
    commitSha: "1".repeat(40),
    blobSha: "4".repeat(40),
    path: "tests/example.test.ts",
    sourceUrl: `https://github.com/example/project/blob/${"1".repeat(40)}/tests/example.test.ts`,
    source: "test('rejects bad input', () => { expect(validate(null)).toBe(false); });",
    byteLength: 75,
    isTest: true,
    attribution: { status: "attributed", commitSha: "5".repeat(40) },
  },
]);

const key = qualityResultCacheKey({
  snapshotKey: "snapshot-a",
  login: "example",
  immutableRepositories: [{ repository: "example/project", treeSha: "6".repeat(40) }],
  sourceRequestCap: 21,
  attributionRequestCap: 12,
});

describe("Quality Preview cache", () => {
  it("persists only validated derived results and never raw source", () => {
    const directory = mkdtempSync(join(tmpdir(), "gitmog-quality-cache-"));
    const cache = createFileQualityResultCache({
      directory,
      now: () => 1_800_000_000_000,
    });
    try {
      expect(isQualityJudgeResult(result)).toBe(true);
      cache.set(key, result);
      expect(cache.size).toBe(1);
      const cached = cache.get(key);
      expect(cached).toBeDefined();
      expect(cached?.resultKey).toBe(result.resultKey);
      expect(cached?.maintainedCodebase).toEqual(result.maintainedCodebase);
      expect(cached?.attributedCode).toEqual(result.attributedCode);
      expect(cached?.limitations).toEqual(result.limitations);
      expect(cached?.receipts).toEqual(result.receipts);
      expect(cached?.requestPlan).toEqual(result.requestPlan);
      expect(cached?.requestTelemetry).toEqual({
        version: "1.0.0-current-invocation",
        sourceRequests: 0,
        attributionRequests: 0,
        sourceCacheHits: 0,
        attributionCacheHits: 0,
        wholeResultCacheHit: true,
      });
      const files = readdirSync(directory);
      expect(files).toHaveLength(1);
      const stored = readFileSync(join(directory, files[0] as string), "utf8");
      expect(stored).not.toContain(rawMarker);
      expect(stored).not.toContain('"source"');
      expect(stored).not.toContain('"content"');
      expect(stored).not.toContain('"requestTelemetry"');
      expect(stored).not.toContain('"requestBudget"');
      expect(stored).not.toContain('"sourceRequests"');
      expect(stored).not.toContain('"attributionRequests"');
      expect(stored).not.toContain('"wholeResultCacheHit"');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects source-shaped cache values and versions identity by immutable inputs", () => {
    expect(isQualityCacheSafe({ source: rawMarker })).toBe(false);
    expect(
      qualityResultCacheKey({
        snapshotKey: "snapshot-a",
        login: "example",
        immutableRepositories: [{ repository: "example/project", treeSha: "7".repeat(40) }],
        sourceRequestCap: 21,
        attributionRequestCap: 12,
      }),
    ).not.toBe(key);
    expect(
      qualityResultCacheKey({
        snapshotKey: "snapshot-a",
        login: "example",
        immutableRepositories: [{ repository: "example/project", treeSha: "6".repeat(40) }],
        sourceRequestCap: 5,
        attributionRequestCap: 0,
      }),
    ).not.toBe(key);
  });

  it("fails closed for the prior result and cache schema", () => {
    const {
      requestPlan: _requestPlan,
      requestTelemetry: _requestTelemetry,
      ...priorShape
    } = result;
    expect(
      qualityResultValidationCode({
        ...priorShape,
        version: "0.3.0-preview.1",
      }),
    ).not.toBeNull();
  });
});
