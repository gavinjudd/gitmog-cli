import { describe, expect, it } from "vitest";

import {
  buildGithubRequestPlan,
  readGithubCoreAllowance,
  type GithubCoreAllowance,
  type RequestPlanCacheState,
} from "../src/request-plan.js";

const allowance = (remaining: number | null): GithubCoreAllowance => ({
  authenticated: false,
  limit: 60,
  remaining,
  resetAt: "2026-08-24T00:00:00.000Z",
  rateLimitClass: remaining === 0 ? "primary" : "none",
  retryAfterSeconds: null,
  source: "endpoint",
});

const miss: RequestPlanCacheState = {
  snapshotHit: false,
  analysisHit: false,
  qualityHit: false,
  maximumSourceRequests: 4,
  supportedSourceOpportunity: null,
  eligibleFileOpportunity: null,
  attributionOpportunity: null,
  cachedQualityLimitationReason: null,
};
const warm: RequestPlanCacheState = {
  snapshotHit: true,
  analysisHit: true,
  qualityHit: true,
  maximumSourceRequests: 1,
  supportedSourceOpportunity: true,
  eligibleFileOpportunity: true,
  attributionOpportunity: true,
  cachedQualityLimitationReason: null,
};

describe("buildGithubRequestPlan", () => {
  it("separates budget, supported-language, eligible-source, and mixed quality limits", () => {
    const planFor = (profile: RequestPlanCacheState) =>
      buildGithubRequestPlan({
        authenticationState: "anonymous",
        profiles: [profile],
        allowance: allowance(20),
      }).quality;
    expect(
      planFor({
        ...miss,
        eligibleFileOpportunity: false,
        supportedSourceOpportunity: false,
        attributionOpportunity: false,
      }),
    ).toMatchObject({
      limitationReason: "eligible-source-limited",
      signInMayImprove: false,
      eligibleFileOpportunity: false,
      supportedSourceOpportunity: false,
    });
    expect(
      planFor({
        ...miss,
        eligibleFileOpportunity: true,
        supportedSourceOpportunity: false,
        attributionOpportunity: false,
      }),
    ).toMatchObject({
      limitationReason: "supported-language-limited",
      signInMayImprove: false,
    });
    expect(
      planFor({
        ...miss,
        eligibleFileOpportunity: true,
        supportedSourceOpportunity: true,
        attributionOpportunity: true,
      }),
    ).toMatchObject({
      limitationReason: "request-budget-limited",
      signInMayImprove: true,
      plannedAdditionalCalls: 0,
    });
    expect(
      planFor({
        ...miss,
        eligibleFileOpportunity: true,
        supportedSourceOpportunity: true,
        attributionOpportunity: true,
        cachedQualityLimitationReason: "supported-language-limited",
      }),
    ).toMatchObject({ limitationReason: "mixed", signInMayImprove: true });
  });

  it.each([
    [33, "complete", [16, 16]],
    [32, "complete", [16, 16]],
    [31, "limited", [16, 15]],
    [12, "limited", [6, 6]],
    [11, "blocked", [0, 0]],
  ] as const)("classifies anonymous remaining %i as %s", (remaining, disposition, caps) => {
    const plan = buildGithubRequestPlan({
      authenticationState: "anonymous",
      profiles: [miss, miss],
      allowance: allowance(remaining),
    });
    expect(plan.disposition).toBe(disposition);
    expect(plan.perProfileRequestCaps).toEqual(caps);
    expect(plan.expectedCurrentRequests).toBe(32);
    expect(plan.minimumUsefulRequests).toBe(12);
  });

  it("reuses the exact anonymous quality tier without an allowance", () => {
    const plan = buildGithubRequestPlan({
      authenticationState: "anonymous",
      profiles: [warm, warm],
      allowance: { ...allowance(null), rateLimitClass: "unknown", source: "unknown" },
    });
    expect(plan.disposition).toBe("complete");
    expect(plan.expectedCurrentRequests).toBe(0);
    expect(plan.perProfileRequestCaps).toEqual([1, 1]);
    expect(plan.quality).toMatchObject({
      cacheHits: 2,
      disposition: "limited",
      expectedCurrentRequests: 0,
      perProfileSourceRequestCaps: [5, 5],
      perProfileAttributionRequestCaps: [0, 0],
    });
    expect(plan.totalExpectedCurrentRequests).toBe(0);
  });

  it("allocates quality source and attribution after the canonical plan", () => {
    const limited = buildGithubRequestPlan({
      authenticationState: "anonymous",
      profiles: [miss, miss],
      allowance: allowance(60),
    });
    expect(limited.quality).toMatchObject({
      cacheHits: 0,
      disposition: "limited",
      expectedCurrentRequests: 10,
      minimumUsefulRequests: 10,
      completeSupportedRequests: 66,
      perProfileSourceRequestCaps: [5, 5],
      perProfileAttributionRequestCaps: [0, 0],
    });
    expect(limited.totalExpectedCurrentRequests).toBe(42);

    const complete = buildGithubRequestPlan({
      authenticationState: "explicit",
      profiles: [miss, miss],
      allowance: { ...allowance(98), authenticated: true, limit: 5_000 },
    });
    expect(complete.quality).toMatchObject({
      disposition: "complete",
      perProfileSourceRequestCaps: [21, 21],
      perProfileAttributionRequestCaps: [12, 12],
    });
    expect(complete.totalExpectedCurrentRequests).toBe(98);
  });

  it("keeps cached profile quality opponent-independent", () => {
    const cachedQuality = { ...miss, qualityHit: true };
    const plan = buildGithubRequestPlan({
      authenticationState: "explicit",
      profiles: [cachedQuality, miss],
      allowance: { ...allowance(98), authenticated: true, limit: 5_000 },
    });
    expect(plan.quality).toMatchObject({
      cacheHits: 1,
      disposition: "complete",
      expectedCurrentRequests: 33,
      completeSupportedRequests: 66,
      perProfileSourceRequestCaps: [21, 21],
      perProfileAttributionRequestCaps: [12, 12],
    });
  });

  it("keeps logical quality caps invariant across canonical cache states", () => {
    const cold = buildGithubRequestPlan({
      authenticationState: "anonymous",
      profiles: [miss, miss],
      allowance: allowance(60),
    });
    const cachedCanonical = buildGithubRequestPlan({
      authenticationState: "anonymous",
      profiles: [
        { ...warm, qualityHit: false },
        { ...warm, qualityHit: false },
      ],
      allowance: allowance(60),
    });
    expect(cachedCanonical.quality.perProfileSourceRequestCaps).toEqual(
      cold.quality.perProfileSourceRequestCaps,
    );
    expect(cachedCanonical.quality.perProfileAttributionRequestCaps).toEqual(
      cold.quality.perProfileAttributionRequestCaps,
    );
    expect(cachedCanonical.quality.disposition).toBe(cold.quality.disposition);
  });
});

describe("readGithubCoreAllowance", () => {
  it("uses the official rate-limit resource without requesting OAuth scopes", async () => {
    const requests: Request[] = [];
    const result = await readGithubCoreAllowance({
      token: "not-printed",
      fetchImpl: (input, init) => {
        requests.push(new Request(input, init));
        return Promise.resolve(
          Response.json({
            resources: { core: { limit: 5000, remaining: 4999, reset: 1_788_000_000 } },
          }),
        );
      },
    });
    expect(result.ok).toBe(true);
    expect(requests[0]?.url).toBe("https://api.github.com/rate_limit");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer not-printed");
    expect(requests[0]?.url).not.toContain("scope");
    if (result.ok) expect(result.allowance.remaining).toBe(4999);
  });

  it.each([
    [403, "0", null, "primary"],
    [429, "12", "15", "secondary"],
    [429, null, null, "secondary"],
  ] as const)("classifies %i responses", async (status, remaining, retryAfter, expected) => {
    const headers = new Headers({ "x-ratelimit-limit": "60", "x-ratelimit-reset": "1788000000" });
    if (remaining !== null) headers.set("x-ratelimit-remaining", remaining);
    if (retryAfter !== null) headers.set("retry-after", retryAfter);
    const result = await readGithubCoreAllowance({
      fetchImpl: () => Promise.resolve(new Response(null, { status, headers })),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.allowance.rateLimitClass).toBe(expected);
  });

  it("fails closed on malformed allowance data", async () => {
    const result = await readGithubCoreAllowance({
      fetchImpl: () =>
        Promise.resolve(Response.json({ resources: { core: { remaining: "many" } } })),
    });
    expect(result).toEqual({ ok: false, error: "malformed" });
  });
});
