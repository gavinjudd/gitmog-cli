import { GITHUB_REST_BASE_URL } from "./endpoints.js";

export const REQUEST_PLAN_VERSION = "1.0.0-first-run-budget";
export const COMPLETE_PROFILE_REQUESTS = 16;
export const MINIMUM_USEFUL_PROFILE_REQUESTS = 6;
export const MAXIMUM_SOURCE_REQUESTS_PER_PROFILE = 4;
export const QUALITY_REQUEST_PLAN_VERSION = "1.0.0-separate-quality-opportunity";
export const COMPLETE_QUALITY_SOURCE_REQUESTS_PER_PROFILE = 21;
export const COMPLETE_QUALITY_ATTRIBUTION_REQUESTS_PER_PROFILE = 12;
export const MINIMUM_USEFUL_QUALITY_REQUESTS_PER_PROFILE = 5;

export type AuthenticationState = "anonymous" | "explicit" | "device";
export type RateLimitClass = "none" | "primary" | "secondary" | "unknown";
export type BudgetDisposition = "complete" | "limited" | "blocked" | "unknown";

export interface RequestPlanCacheState {
  readonly snapshotHit: boolean;
  readonly analysisHit: boolean;
  readonly qualityHit: boolean;
  readonly maximumSourceRequests: number;
}

export interface GithubCoreAllowance {
  readonly authenticated: boolean;
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly resetAt: string | null;
  readonly rateLimitClass: RateLimitClass;
  readonly retryAfterSeconds: number | null;
  readonly source: "headers" | "endpoint" | "unknown";
}

export interface GithubRequestPlan {
  readonly version: typeof REQUEST_PLAN_VERSION;
  readonly authenticationState: AuthenticationState;
  readonly profileCount: 1 | 2;
  readonly requiredMetadataRequests: number;
  readonly maximumMetadataRequests: number;
  readonly maximumSourceRequests: number;
  readonly cacheHits: {
    readonly snapshots: number;
    readonly analyses: number;
  };
  readonly expectedCurrentRequests: number;
  readonly minimumUsefulRequests: number;
  readonly completeSupportedRequests: number;
  readonly remaining: number | null;
  readonly resetAt: string | null;
  readonly rateLimitClass: RateLimitClass;
  readonly retryAfterSeconds: number | null;
  readonly disposition: BudgetDisposition;
  readonly limitedRunPossible: boolean;
  readonly collectionMayBegin: boolean;
  readonly perProfileRequestCaps: readonly [number] | readonly [number, number];
  /** @deprecated Prefer the position-specific caps above. */
  readonly perProfileRequestCap: number;
  readonly quality: {
    readonly version: typeof QUALITY_REQUEST_PLAN_VERSION;
    readonly enabled: boolean;
    readonly cacheHits: number;
    readonly disposition: BudgetDisposition;
    readonly expectedCurrentRequests: number;
    readonly minimumUsefulRequests: number;
    readonly completeSupportedRequests: number;
    readonly perProfileSourceRequestCaps: readonly [number] | readonly [number, number];
    readonly perProfileAttributionRequestCaps: readonly [number] | readonly [number, number];
  };
  readonly totalExpectedCurrentRequests: number;
}

export interface BuildRequestPlanInput {
  readonly authenticationState: AuthenticationState;
  readonly profiles:
    readonly [RequestPlanCacheState] | readonly [RequestPlanCacheState, RequestPlanCacheState];
  readonly allowance: GithubCoreAllowance;
  readonly qualityEnabled?: boolean | undefined;
}

const boundedSourceMaximum = (value: number): number =>
  Number.isSafeInteger(value)
    ? Math.max(0, Math.min(MAXIMUM_SOURCE_REQUESTS_PER_PROFILE, value))
    : MAXIMUM_SOURCE_REQUESTS_PER_PROFILE;

export function buildGithubRequestPlan(input: BuildRequestPlanInput): GithubRequestPlan {
  const profileCount = input.profiles.length;
  const missingSnapshots = input.profiles.filter((profile) => !profile.snapshotHit).length;
  const snapshotHits = profileCount - missingSnapshots;
  const analysisHits = input.profiles.filter((profile) => profile.analysisHit).length;
  const expectedCurrentRequests = input.profiles.reduce((total, profile) => {
    if (!profile.snapshotHit) return total + COMPLETE_PROFILE_REQUESTS;
    if (profile.analysisHit) return total;
    return total + boundedSourceMaximum(profile.maximumSourceRequests);
  }, 0);
  const minimumUsefulRequests = missingSnapshots * MINIMUM_USEFUL_PROFILE_REQUESTS;
  const remaining = input.allowance.remaining;
  const disposition: BudgetDisposition =
    expectedCurrentRequests === 0
      ? "complete"
      : remaining === null
        ? "unknown"
        : remaining >= expectedCurrentRequests
          ? "complete"
          : remaining >= minimumUsefulRequests
            ? "limited"
            : "blocked";
  const expectedCaps = input.profiles.map((profile) =>
    !profile.snapshotHit
      ? COMPLETE_PROFILE_REQUESTS
      : boundedSourceMaximum(profile.maximumSourceRequests),
  );
  const minimumCaps = input.profiles.map((profile) =>
    profile.snapshotHit ? 0 : MINIMUM_USEFUL_PROFILE_REQUESTS,
  );
  const perProfileRequestCaps = [...expectedCaps];
  if (disposition === "blocked" || disposition === "unknown") {
    perProfileRequestCaps.fill(0);
  } else if (disposition === "limited" && remaining !== null) {
    for (let index = 0; index < perProfileRequestCaps.length; index += 1) {
      perProfileRequestCaps[index] = minimumCaps[index] ?? 0;
    }
    let unassigned = remaining - perProfileRequestCaps.reduce((total, cap) => total + cap, 0);
    while (unassigned > 0) {
      let changed = false;
      for (let index = 0; index < perProfileRequestCaps.length && unassigned > 0; index += 1) {
        const expected = expectedCaps[index] ?? 0;
        const current = perProfileRequestCaps[index] ?? 0;
        if (current >= expected) continue;
        perProfileRequestCaps[index] = current + 1;
        unassigned -= 1;
        changed = true;
      }
      if (!changed) break;
    }
  }
  const typedCaps = perProfileRequestCaps as unknown as
    readonly [number] | readonly [number, number];
  const perProfileRequestCap = Math.max(...perProfileRequestCaps);
  const qualityEnabled = input.qualityEnabled !== false;
  const qualityCacheHits = qualityEnabled
    ? input.profiles.filter((profile) => profile.qualityHit).length
    : 0;
  const qualityMissIndexes = input.profiles
    .map((profile, index) => ({ profile, index }))
    .filter(({ profile }) => qualityEnabled && !profile.qualityHit)
    .map(({ index }) => index);
  const qualityComplete = qualityEnabled
    ? qualityMissIndexes.length *
      (COMPLETE_QUALITY_SOURCE_REQUESTS_PER_PROFILE +
        COMPLETE_QUALITY_ATTRIBUTION_REQUESTS_PER_PROFILE)
    : 0;
  const qualityMinimum = qualityEnabled
    ? qualityMissIndexes.length * MINIMUM_USEFUL_QUALITY_REQUESTS_PER_PROFILE
    : 0;
  const canonicalAllocated =
    disposition === "complete"
      ? expectedCurrentRequests
      : disposition === "limited"
        ? perProfileRequestCaps.reduce((total, cap) => total + cap, 0)
        : 0;
  const qualityAvailable =
    remaining === null || disposition === "blocked" || disposition === "unknown"
      ? 0
      : Math.max(0, remaining - canonicalAllocated);
  const qualityDisposition: BudgetDisposition =
    !qualityEnabled || qualityComplete === 0
      ? "complete"
      : remaining === null
        ? "unknown"
        : qualityAvailable >= qualityComplete
          ? "complete"
          : qualityAvailable >= qualityMinimum
            ? "limited"
            : "blocked";
  const qualitySourceCaps = Array.from({ length: profileCount }, () => 0);
  const qualityAttributionCaps = Array.from({ length: profileCount }, () => 0);
  for (let index = 0; index < profileCount; index += 1) {
    if (input.profiles[index]?.qualityHit === true) {
      qualitySourceCaps[index] = COMPLETE_QUALITY_SOURCE_REQUESTS_PER_PROFILE;
      qualityAttributionCaps[index] = COMPLETE_QUALITY_ATTRIBUTION_REQUESTS_PER_PROFILE;
    }
  }
  if (qualityDisposition === "complete" && qualityEnabled) {
    for (const index of qualityMissIndexes) {
      qualitySourceCaps[index] = COMPLETE_QUALITY_SOURCE_REQUESTS_PER_PROFILE;
      qualityAttributionCaps[index] = COMPLETE_QUALITY_ATTRIBUTION_REQUESTS_PER_PROFILE;
    }
  } else if (qualityDisposition === "limited" && qualityEnabled) {
    for (const index of qualityMissIndexes) {
      qualitySourceCaps[index] = MINIMUM_USEFUL_QUALITY_REQUESTS_PER_PROFILE;
    }
    let unassigned =
      qualityAvailable - qualityMissIndexes.length * MINIMUM_USEFUL_QUALITY_REQUESTS_PER_PROFILE;
    while (unassigned > 0) {
      let changed = false;
      for (const index of qualityMissIndexes) {
        if (unassigned <= 0) break;
        if ((qualitySourceCaps[index] ?? 0) < COMPLETE_QUALITY_SOURCE_REQUESTS_PER_PROFILE) {
          qualitySourceCaps[index] = (qualitySourceCaps[index] ?? 0) + 1;
          unassigned -= 1;
          changed = true;
        }
      }
      if (!changed) break;
    }
    while (unassigned > 0) {
      let changed = false;
      for (const index of qualityMissIndexes) {
        if (unassigned <= 0) break;
        if (
          (qualityAttributionCaps[index] ?? 0) < COMPLETE_QUALITY_ATTRIBUTION_REQUESTS_PER_PROFILE
        ) {
          qualityAttributionCaps[index] = (qualityAttributionCaps[index] ?? 0) + 1;
          unassigned -= 1;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }
  const qualityAllocated =
    qualityMissIndexes.reduce((total, index) => total + (qualitySourceCaps[index] ?? 0), 0) +
    qualityMissIndexes.reduce((total, index) => total + (qualityAttributionCaps[index] ?? 0), 0);

  return {
    version: REQUEST_PLAN_VERSION,
    authenticationState: input.authenticationState,
    profileCount,
    requiredMetadataRequests: missingSnapshots * MINIMUM_USEFUL_PROFILE_REQUESTS,
    maximumMetadataRequests: missingSnapshots * (COMPLETE_PROFILE_REQUESTS - 1),
    maximumSourceRequests: input.profiles.reduce(
      (total, profile) => total + boundedSourceMaximum(profile.maximumSourceRequests),
      0,
    ),
    cacheHits: { snapshots: snapshotHits, analyses: analysisHits },
    expectedCurrentRequests,
    minimumUsefulRequests,
    completeSupportedRequests: profileCount * COMPLETE_PROFILE_REQUESTS,
    remaining,
    resetAt: input.allowance.resetAt,
    rateLimitClass: input.allowance.rateLimitClass,
    retryAfterSeconds: input.allowance.retryAfterSeconds,
    disposition,
    limitedRunPossible: disposition === "limited",
    collectionMayBegin: disposition === "complete" || disposition === "limited",
    perProfileRequestCaps: typedCaps,
    perProfileRequestCap,
    quality: {
      version: QUALITY_REQUEST_PLAN_VERSION,
      enabled: qualityEnabled,
      cacheHits: qualityCacheHits,
      disposition: qualityDisposition,
      expectedCurrentRequests: qualityComplete,
      minimumUsefulRequests: qualityMinimum,
      completeSupportedRequests: qualityEnabled
        ? profileCount *
          (COMPLETE_QUALITY_SOURCE_REQUESTS_PER_PROFILE +
            COMPLETE_QUALITY_ATTRIBUTION_REQUESTS_PER_PROFILE)
        : 0,
      perProfileSourceRequestCaps: qualitySourceCaps as unknown as
        readonly [number] | readonly [number, number],
      perProfileAttributionRequestCaps: qualityAttributionCaps as unknown as
        readonly [number] | readonly [number, number],
    },
    totalExpectedCurrentRequests: expectedCurrentRequests + qualityAllocated,
  };
}

export interface ReadGithubAllowanceOptions {
  readonly token?: string | undefined;
  readonly fetchImpl?: typeof globalThis.fetch | undefined;
  readonly signal?: AbortSignal | undefined;
}

export type GithubAllowanceResult =
  | { readonly ok: true; readonly allowance: GithubCoreAllowance }
  | {
      readonly ok: false;
      readonly error: "network" | "timeout" | "malformed" | "upstream";
    };

const integerHeader = (headers: Headers, name: string): number | null => {
  const value = headers.get(name);
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const resetAtFromSeconds = (seconds: number | null): string | null =>
  seconds === null ? null : new Date(seconds * 1000).toISOString();

const classifyLimit = (
  status: number,
  remaining: number | null,
  retryAfterSeconds: number | null,
): RateLimitClass => {
  if (status !== 403 && status !== 429) return "none";
  if (remaining === 0) return "primary";
  if (retryAfterSeconds !== null || status === 429) return "secondary";
  return "unknown";
};

export async function readGithubCoreAllowance(
  options: ReadGithubAllowanceOptions = {},
): Promise<GithubAllowanceResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "gitmog-request-plan",
  };
  const token = options.token?.trim();
  if (token !== undefined && token !== "") headers.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetchImpl(`${GITHUB_REST_BASE_URL}/rate_limit`, {
      headers,
      redirect: "error",
      signal: options.signal ?? AbortSignal.timeout(8_000),
    });
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "";
    return {
      ok: false,
      error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
    };
  }

  const headerRemaining = integerHeader(response.headers, "x-ratelimit-remaining");
  const headerLimit = integerHeader(response.headers, "x-ratelimit-limit");
  const headerReset = integerHeader(response.headers, "x-ratelimit-reset");
  const retryAfterSeconds = integerHeader(response.headers, "retry-after");
  const rateLimitClass = classifyLimit(response.status, headerRemaining, retryAfterSeconds);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (rateLimitClass === "primary" || rateLimitClass === "secondary") {
      return {
        ok: true,
        allowance: {
          authenticated: token !== undefined && token !== "",
          limit: headerLimit,
          remaining: headerRemaining ?? 0,
          resetAt: resetAtFromSeconds(headerReset),
          rateLimitClass,
          retryAfterSeconds,
          source: "headers",
        },
      };
    }
    return { ok: false, error: "upstream" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "malformed" };
  }
  const core =
    typeof body === "object" &&
    body !== null &&
    typeof (body as { resources?: unknown }).resources === "object" &&
    (body as { resources: unknown }).resources !== null
      ? ((body as { resources: { core?: unknown } }).resources.core ?? null)
      : null;
  if (typeof core !== "object" || core === null) return { ok: false, error: "malformed" };
  const limit = (core as { limit?: unknown }).limit;
  const remaining = (core as { remaining?: unknown }).remaining;
  const reset = (core as { reset?: unknown }).reset;
  if (
    !Number.isSafeInteger(limit) ||
    !Number.isSafeInteger(remaining) ||
    !Number.isSafeInteger(reset) ||
    Number(limit) < 0 ||
    Number(remaining) < 0 ||
    Number(reset) < 0
  ) {
    return { ok: false, error: "malformed" };
  }
  return {
    ok: true,
    allowance: {
      authenticated: token !== undefined && token !== "",
      limit: Number(limit),
      remaining: Number(remaining),
      resetAt: resetAtFromSeconds(Number(reset)),
      rateLimitClass: "none",
      retryAfterSeconds: null,
      source: "endpoint",
    },
  };
}

export function allowanceFromKnownHeaders(input: {
  readonly authenticated: boolean;
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly resetAt: string | null;
}): GithubCoreAllowance {
  return {
    ...input,
    rateLimitClass: input.remaining === 0 ? "primary" : "none",
    retryAfterSeconds: null,
    source: "headers",
  };
}
