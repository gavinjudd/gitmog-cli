import { describe, expect, it } from "vitest";

import { reconcileBattleRequestAccounting } from "../scripts/lib/request-accounting.mjs";

const quality = (
  sourceRequests: number,
  attributionRequests: number,
  wholeResultCacheHit = false,
) => ({
  requestPlan: {
    sourcePlanned: 21,
    attributionPlanned: 12,
    completeOpportunity: 33,
    minimumUsefulOpportunity: 5,
    sourceRequestCap: 21,
    attributionRequestCap: 12,
  },
  requestTelemetry: {
    sourceRequests,
    attributionRequests,
    sourceCacheHits: 0,
    attributionCacheHits: 0,
    wholeResultCacheHit,
  },
  requestBudget: {
    sourcePlanned: 21,
    sourceRequests,
    sourceCacheHits: 0,
    attributionPlanned: 12,
    attributionRequests,
    attributionCacheHits: 0,
    completeOpportunity: 33,
    minimumUsefulOpportunity: 5,
    wholeResultCacheHit,
  },
});

const payload = {
  sourceAnalysis: {
    requestBudget: {
      left: { metadata: 3, source: 2, total: 5 },
      right: { metadata: 4, source: 1, total: 5 },
      total: 10,
    },
  },
  qualityPreview: {
    left: quality(4, 2),
    right: quality(3, 1),
  },
};

describe("CLI request accounting", () => {
  it("reconciles canonical, Quality Preview, allowance, cache, and planned opportunity separately", () => {
    expect(
      reconcileBattleRequestAccounting({
        payload,
        observedFetches: 20,
        observedByUserAgent: {
          "gitmog-fast-scan": 10,
          "gitmog-quality-source": 7,
          "gitmog-quality-attribution": 3,
        },
        allowanceReads: 1,
      }),
    ).toEqual({
      canonicalRequests: { metadata: 7, source: 3, total: 10 },
      qualityRequests: { source: 7, attribution: 3, total: 10 },
      allowanceReads: 1,
      cacheHits: { source: 0, attribution: 0, wholeResult: 0 },
      plannedQualityOpportunity: {
        source: 42,
        attribution: 24,
        total: 66,
        sourceCap: 42,
        attributionCap: 24,
      },
      totalObservedFetches: 20,
      totalObservedOperations: 21,
    });
  });

  it("reports whole-result cache hits as zero current quality calls", () => {
    const warm = {
      ...payload,
      qualityPreview: { left: quality(0, 0, true), right: quality(0, 0, true) },
    };
    expect(
      reconcileBattleRequestAccounting({
        payload: warm,
        observedFetches: 10,
        observedByUserAgent: { "gitmog-fast-scan": 10 },
      }),
    ).toMatchObject({
      qualityRequests: { source: 0, attribution: 0, total: 0 },
      cacheHits: { wholeResult: 2 },
      totalObservedFetches: 10,
    });
  });

  it("fails when actual fetches, user-agent lanes, or compatibility fields diverge", () => {
    expect(() =>
      reconcileBattleRequestAccounting({
        payload,
        observedFetches: 19,
        observedByUserAgent: {
          "gitmog-fast-scan": 9,
          "gitmog-quality-source": 7,
          "gitmog-quality-attribution": 3,
        },
      }),
    ).toThrow(/Observed fetches did not reconcile/u);
    expect(() =>
      reconcileBattleRequestAccounting({
        payload,
        observedFetches: 20,
        observedByUserAgent: {
          "gitmog-fast-scan": 11,
          "gitmog-quality-source": 6,
          "gitmog-quality-attribution": 3,
        },
      }),
    ).toThrow(/Quality source request telemetry/u);
    const malformed = structuredClone(payload);
    malformed.qualityPreview.left.requestBudget.sourceRequests = 0;
    expect(() =>
      reconcileBattleRequestAccounting({
        payload: malformed,
        observedFetches: 20,
        observedByUserAgent: {
          "gitmog-fast-scan": 10,
          "gitmog-quality-source": 7,
          "gitmog-quality-attribution": 3,
        },
      }),
    ).toThrow(/compatibility request accounting diverged/u);
  });
});
