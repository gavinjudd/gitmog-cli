import {
  MAXIMUM_SOURCE_REQUESTS_PER_PROFILE,
  REQUEST_BUDGETS,
  buildGithubRequestPlan,
  readGithubCoreAllowance,
  resolveSourceOpportunityScope,
  snapshotCacheKey,
  type AuthenticationState,
  type GithubAllowanceResult,
  type GithubCoreAllowance,
  type GithubRequestPlan,
  type ProfileSnapshot,
  type RequestPlanCacheState,
  type SnapshotCache,
} from "@gitmog/github";
import { codeDnaCacheKey, type CodeDnaOutcome } from "@gitmog/personality";
import {
  qualityResultCacheKey,
  type QualityJudgeResult,
  type QualityResultCache,
} from "@gitmog/quality-judge";

export type ExplicitTokenResult =
  | { readonly ok: true; readonly token: string | undefined }
  | { readonly ok: false; readonly error: "conflicting_tokens" };

/** Resolves explicit token aliases without exposing either value or silently choosing
 * between conflicting credentials. */
export function resolveExplicitGithubToken(
  env: Readonly<Record<string, string | undefined>>,
): ExplicitTokenResult {
  const github = env.GITHUB_TOKEN?.trim() || undefined;
  const gh = env.GH_TOKEN?.trim() || undefined;
  if (github !== undefined && gh !== undefined && github !== gh) {
    return { ok: false, error: "conflicting_tokens" };
  }
  return { ok: true, token: github ?? gh };
}

export interface RequestPlanCaches {
  readonly snapshots: SnapshotCache<ProfileSnapshot> | null;
  readonly analyses: Pick<SnapshotCache<CodeDnaOutcome>, "get"> | null;
  readonly quality: Pick<QualityResultCache, "get"> | null;
  readonly read: boolean;
}

export interface PlanInvocationOptions {
  readonly handles: readonly [string] | readonly [string, string];
  readonly authenticationState: AuthenticationState;
  readonly token?: string | undefined;
  readonly caches: RequestPlanCaches;
  readonly fetchImpl?: typeof globalThis.fetch | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly qualityEnabled?: boolean | undefined;
  readonly readAllowance?:
    | ((options: {
        readonly token?: string | undefined;
        readonly fetchImpl?: typeof globalThis.fetch | undefined;
        readonly signal?: AbortSignal | undefined;
      }) => Promise<GithubAllowanceResult>)
    | undefined;
}

export type PlanInvocationResult =
  | { readonly ok: true; readonly plan: GithubRequestPlan }
  | {
      readonly ok: false;
      readonly error: "network" | "timeout" | "malformed" | "upstream";
      readonly plan: GithubRequestPlan;
    };

const UNKNOWN_ALLOWANCE: GithubCoreAllowance = {
  authenticated: false,
  limit: null,
  remaining: null,
  resetAt: null,
  rateLimitClass: "unknown",
  retryAfterSeconds: null,
  source: "unknown",
};

const cacheStateFor = (
  handle: string,
  caches: RequestPlanCaches,
  authenticationState: AuthenticationState,
): RequestPlanCacheState => {
  if (!caches.read) {
    return {
      snapshotHit: false,
      analysisHit: false,
      qualityHit: false,
      maximumSourceRequests: MAXIMUM_SOURCE_REQUESTS_PER_PROFILE,
    };
  }
  const key = snapshotCacheKey({
    login: handle,
    authenticated: false,
    maxInspectedRepositories: REQUEST_BUDGETS.anonymous.inspectedRepositories,
  });
  const snapshot = caches.snapshots?.get(key);
  if (snapshot === undefined) {
    return {
      snapshotHit: false,
      analysisHit: false,
      qualityHit: false,
      maximumSourceRequests: MAXIMUM_SOURCE_REQUESTS_PER_PROFILE,
    };
  }
  const opportunity = resolveSourceOpportunityScope(snapshot);
  const analysis = caches.analyses?.get(codeDnaCacheKey(snapshot.snapshotKey, opportunity));
  const qualityKey = qualityResultCacheKey({
    snapshotKey: snapshot.snapshotKey,
    login: snapshot.profile.login,
    immutableRepositories: snapshot.inspections
      .map((inspection) => ({ repository: inspection.fullName, treeSha: inspection.treeSha }))
      .toSorted((left, right) => left.repository.localeCompare(right.repository)),
    sourceRequestCap: authenticationState === "anonymous" ? 5 : 21,
    attributionRequestCap: authenticationState === "anonymous" ? 0 : 12,
  });
  const quality: QualityJudgeResult | undefined = caches.quality?.get(qualityKey);
  return {
    snapshotHit: true,
    analysisHit: analysis !== undefined,
    qualityHit: quality !== undefined,
    maximumSourceRequests: opportunity.sourceRequestAllowance,
  };
};

export async function planGithubInvocation(
  options: PlanInvocationOptions,
): Promise<PlanInvocationResult> {
  const profiles = options.handles.map((handle) =>
    cacheStateFor(handle, options.caches, options.authenticationState),
  ) as unknown as
    readonly [RequestPlanCacheState] | readonly [RequestPlanCacheState, RequestPlanCacheState];
  const provisional = buildGithubRequestPlan({
    authenticationState: options.authenticationState,
    profiles,
    allowance: {
      ...UNKNOWN_ALLOWANCE,
      authenticated: options.authenticationState !== "anonymous",
    },
    qualityEnabled: options.qualityEnabled,
  });
  if (
    provisional.expectedCurrentRequests === 0 &&
    provisional.quality.expectedCurrentRequests === 0 &&
    (provisional.quality.disposition === "complete" ||
      provisional.quality.cacheHits === provisional.profileCount)
  ) {
    return { ok: true, plan: provisional };
  }

  const readAllowance = options.readAllowance ?? readGithubCoreAllowance;
  const allowance = await readAllowance({
    ...(options.token === undefined ? {} : { token: options.token }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!allowance.ok) {
    if (provisional.expectedCurrentRequests === 0 && provisional.disposition === "complete") {
      return {
        ok: true,
        plan: buildGithubRequestPlan({
          authenticationState: options.authenticationState,
          profiles,
          allowance: {
            ...UNKNOWN_ALLOWANCE,
            authenticated: options.authenticationState !== "anonymous",
            remaining: 0,
          },
          qualityEnabled: options.qualityEnabled,
        }),
      };
    }
    return { ok: false, error: allowance.error, plan: provisional };
  }
  return {
    ok: true,
    plan: buildGithubRequestPlan({
      authenticationState: options.authenticationState,
      profiles,
      allowance: allowance.allowance,
      qualityEnabled: options.qualityEnabled,
    }),
  };
}

export function formatLocalReset(resetAt: string | null, timeZone?: string): string {
  if (resetAt === null) return "unknown";
  const time = Date.parse(resetAt);
  if (!Number.isFinite(time)) return resetAt;
  return new Date(time).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "long",
    ...(timeZone === undefined ? {} : { timeZone }),
  });
}
