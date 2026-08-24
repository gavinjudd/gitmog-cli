import {
  collectProfileSnapshot,
  collectQualitySource,
  normalizeGithubLogin,
  type CollectProfileOptions,
  type GithubError,
  type PersistentCachePolicy,
  type ProfileSnapshot,
} from "@gitmog/github";
import { readCodeDna, type CodeDnaOptions, type CodeDnaOutcome } from "@gitmog/personality";
import {
  analyzeBattleSource,
  type SourceAnalysisResult,
  type StoryResult,
} from "@gitmog/source-analysis";
import {
  buildBattle,
  DEFAULT_ROAST_MODE,
  parseRoastMode,
  scoreProfileFastScan,
  type BattleResult,
  type ProfileScorecard,
  type RoastMode,
} from "@gitmog/scoring";
import {
  analyzeQualitySourceFiles,
  qualityResultCacheKey,
  type QualityJudgePair,
  type QualityJudgeResult,
  type QualityLimitation,
  type QualityResultCache,
} from "@gitmog/quality-judge";

import type { BattleError } from "./errors.js";

export type BattleServiceResult =
  | {
      readonly ok: true;
      readonly battle: BattleResult;
      readonly sourceAnalysis: SourceAnalysisResult;
      readonly story: StoryResult;
      readonly qualityPreview: QualityJudgePair;
    }
  | { readonly ok: false; readonly error: BattleError };

export type CanonicalBattleServiceResult =
  | { readonly ok: true; readonly battle: BattleResult }
  | { readonly ok: false; readonly error: BattleError };

export interface BattleSnapshots {
  readonly left: ProfileSnapshot;
  readonly right: ProfileSnapshot;
}

export type PreparedBattleResult =
  | {
      readonly ok: true;
      readonly battle: BattleResult;
      readonly snapshots: BattleSnapshots;
      readonly metadataRequestsUsed: { readonly left: number; readonly right: number };
    }
  | { readonly ok: false; readonly error: BattleError };

export type ProfileServiceResult =
  | {
      readonly ok: true;
      readonly profile: ProfileScorecard;
      readonly snapshot: ProfileSnapshot;
      readonly sourceAnalysis: CodeDnaOutcome;
      readonly requestBudget: {
        readonly metadata: number;
        readonly source: number;
        readonly total: number;
        readonly cap: number;
      };
      readonly qualityPreview: QualityJudgeResult;
    }
  | { readonly ok: false; readonly error: BattleError };

export type CanonicalProfileServiceResult =
  | {
      readonly ok: true;
      readonly profile: ProfileScorecard;
      readonly snapshot: ProfileSnapshot;
    }
  | { readonly ok: false; readonly error: BattleError };

export type AnalysisProgressEvent =
  | {
      readonly type: "profile-collection-start";
      readonly mode: "profile" | "battle";
      readonly handles: readonly string[];
    }
  | { readonly type: "repository-ranking-start"; readonly cached: boolean }
  | {
      readonly type: "profile-collection-complete";
      readonly metadataRequests: number;
      readonly cachedProfiles: number;
    }
  | {
      readonly type: "repository-ranking-complete";
      readonly eligibleRepositories: number;
      readonly inspectedRepositories: number;
      readonly cached: boolean;
    }
  | { readonly type: "scoring-start" }
  | {
      readonly type: "scoring-complete";
      readonly scores: readonly number[];
      readonly winner: BattleResult["winner"] | "profile";
    }
  | { readonly type: "source-analysis-start" }
  | {
      readonly type: "source-analysis-complete";
      readonly status: SourceAnalysisResult["status"] | CodeDnaOutcome["status"];
      readonly files: number;
      readonly repositories: number;
      readonly requests: number;
      readonly rateLimited: boolean;
    }
  | { readonly type: "story-start" }
  | { readonly type: "story-complete" }
  | { readonly type: "quality-analysis-start" }
  | {
      readonly type: "quality-analysis-complete";
      readonly status: "ready" | "partial" | "insufficient";
      readonly files: number;
      readonly repositories: number;
      readonly sourceRequests: number;
      readonly attributionRequests: number;
    };

export type AnalysisProgressReporter = (event: AnalysisProgressEvent) => void;

type PreparedProfileResult =
  | {
      readonly ok: true;
      readonly profile: ProfileScorecard;
      readonly snapshot: ProfileSnapshot;
      readonly metadataRequestsUsed: number;
    }
  | { readonly ok: false; readonly error: BattleError };

export interface BattleRequest {
  readonly left: string;
  readonly right: string;
  readonly roast?: string | null | undefined;
  /** Read from the environment by the caller. Never logged, never rendered. */
  readonly token?: string | undefined;
  /** Only set by a surface that has a URL to share. A CLI leaves it undefined. */
  readonly siteUrl?: string | undefined;
  readonly fetchImpl?: typeof globalThis.fetch | undefined;
  readonly now?: (() => number) | undefined;
  /** Operational cap selected by the pre-collection request plan. It cannot exceed the
   * fixed supported profile ceiling and never changes scoring formulas. */
  readonly maxRequests?: number | undefined;
  readonly requestCaps?: { readonly left: number; readonly right: number } | undefined;
  readonly cache?: CollectProfileOptions["cache"];
  readonly cachePolicy?: PersistentCachePolicy | undefined;
  readonly sourceAnalysis?:
    Pick<CodeDnaOptions, "cache" | "cachePolicy" | "derivedCache"> | undefined;
  readonly onProgress?: AnalysisProgressReporter | undefined;
  readonly quality?:
    | {
        readonly enabled: boolean;
        readonly sourceRequestCaps?: { readonly left: number; readonly right: number } | undefined;
        readonly attributionRequestCaps?:
          { readonly left: number; readonly right: number } | undefined;
        readonly cache?: QualityResultCache | null | undefined;
        readonly cachePolicy?: PersistentCachePolicy | undefined;
      }
    | undefined;
}

export interface ProfileRequest {
  readonly handle: string;
  readonly token?: string | undefined;
  readonly fetchImpl?: typeof globalThis.fetch | undefined;
  readonly now?: (() => number) | undefined;
  readonly maxRequests?: number | undefined;
  readonly cache?: CollectProfileOptions["cache"];
  readonly cachePolicy?: PersistentCachePolicy | undefined;
  readonly sourceAnalysis?:
    Pick<CodeDnaOptions, "cache" | "cachePolicy" | "derivedCache"> | undefined;
  readonly onProgress?: AnalysisProgressReporter | undefined;
  readonly quality?:
    | {
        readonly enabled: boolean;
        readonly sourceRequestCap?: number | undefined;
        readonly attributionRequestCap?: number | undefined;
        readonly cache?: QualityResultCache | null | undefined;
        readonly cachePolicy?: PersistentCachePolicy | undefined;
      }
    | undefined;
}

const qualityLimitations = (
  limitations: readonly {
    readonly code: string;
    readonly detail: string;
    readonly files: number;
  }[],
): readonly QualityLimitation[] =>
  limitations.map((limitation) => ({
    code:
      limitation.code === "source-budget"
        ? "source-budget"
        : limitation.code === "attribution-budget"
          ? "attribution-budget"
          : "source-unavailable",
    detail: limitation.detail,
    files: limitation.files,
  }));

const insufficientQuality = (detail: string): QualityJudgeResult =>
  analyzeQualitySourceFiles([], {
    collectionLimitations: [{ code: "source-unavailable", detail, files: 0 }],
    requestBudget: {
      sourcePlanned: 0,
      sourceRequests: 0,
      attributionPlanned: 0,
      attributionRequests: 0,
    },
  });

async function runQualityPreview(
  snapshot: ProfileSnapshot,
  request: Pick<BattleRequest, "token" | "fetchImpl"> & {
    readonly quality?:
      | {
          readonly cache?: QualityResultCache | null | undefined;
          readonly cachePolicy?: PersistentCachePolicy | undefined;
        }
      | undefined;
  },
  caps: { readonly source: number; readonly attribution: number },
): Promise<QualityJudgeResult> {
  if (caps.source <= 0)
    return insufficientQuality(
      "Quality Preview was disabled or the bounded request plan allowed no source collection.",
    );
  const cacheKey = qualityResultCacheKey({
    snapshotKey: snapshot.snapshotKey,
    login: snapshot.profile.login,
    immutableRepositories: snapshot.inspections
      .map((inspection) => ({
        repository: inspection.fullName,
        treeSha: inspection.treeSha,
      }))
      .toSorted((left, right) => left.repository.localeCompare(right.repository)),
    sourceRequestCap: caps.source,
    attributionRequestCap: caps.attribution,
  });
  if (request.quality?.cachePolicy?.read !== false) {
    const cached = request.quality?.cache?.get(cacheKey);
    if (cached !== undefined) return cached;
  }
  try {
    const collected = await collectQualitySource(snapshot, {
      ...(request.token === undefined || request.token === "" ? {} : { token: request.token }),
      ...(request.fetchImpl === undefined ? {} : { fetchImpl: request.fetchImpl }),
      sourceRequestCap: caps.source,
      attributionRequestCap: caps.attribution,
    });
    const result = analyzeQualitySourceFiles(collected.files, {
      collectionLimitations: qualityLimitations(collected.limitations),
      requestBudget: {
        sourcePlanned: caps.source,
        sourceRequests: collected.sourceRequests,
        attributionPlanned: caps.attribution,
        attributionRequests: collected.attributionRequests,
      },
    });
    if (request.quality?.cachePolicy?.write !== false) {
      request.quality?.cache?.set(cacheKey, result);
    }
    return result;
  } catch {
    return insufficientQuality(
      "Quality Preview stopped safely without affecting the canonical result.",
    );
  }
}

const reportProgress = (
  reporter: AnalysisProgressReporter | undefined,
  event: AnalysisProgressEvent,
): void => {
  try {
    reporter?.(event);
  } catch {
    // Presentation telemetry is deliberately unable to break canonical analysis.
  }
};

const readingWasRateLimited = (reading: CodeDnaOutcome): boolean =>
  reading.status === "insufficient"
    ? reading.sourceFailureReason === "rate-limited"
    : reading.sourceFailureReasons.includes("rate-limited");

const fromGithubError = (error: GithubError, handle: string): BattleError => ({
  // Source-blob envelope limits are a collector detail; keep the public battle error taxonomy stable.
  code: error.code === "response_too_large" ? "upstream_error" : error.code,
  message: error.message,
  handle,
  ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
  ...(error.resetAt === undefined ? {} : { resetAt: error.resetAt }),
  ...(error.rateLimitClass === undefined ? {} : { rateLimitClass: error.rateLimitClass }),
  ...(error.remaining === undefined ? {} : { remaining: error.remaining }),
});

export function parseHandles(
  left: string,
  right: string,
):
  | { readonly ok: true; readonly left: string; readonly right: string }
  | { readonly ok: false; readonly error: BattleError } {
  const parsedLeft = normalizeGithubLogin(left);
  if (parsedLeft === null) {
    return {
      ok: false,
      error: {
        code: "invalid_handle",
        message: `"${left.slice(0, 40)}" is not a GitHub handle.`,
        handle: left.slice(0, 40),
      },
    };
  }
  const parsedRight = normalizeGithubLogin(right);
  if (parsedRight === null) {
    return {
      ok: false,
      error: {
        code: "invalid_handle",
        message: `"${right.slice(0, 40)}" is not a GitHub handle.`,
        handle: right.slice(0, 40),
      },
    };
  }
  if (parsedLeft.toLowerCase() === parsedRight.toLowerCase()) {
    return {
      ok: false,
      error: {
        code: "same_handle",
        message: "Both handles are the same account.",
        handle: parsedLeft,
      },
    };
  }
  return { ok: true, left: parsedLeft, right: parsedRight };
}

export function resolveRoast(value: string | null | undefined): RoastMode {
  return parseRoastMode(value ?? null) ?? DEFAULT_ROAST_MODE;
}

/** A profile with no public repositories and no public activity cannot be scored
 * defensibly, and saying so is better than printing a number. */
const hasScorableEvidence = (snapshot: ProfileSnapshot): boolean =>
  snapshot.eligibleRepositoryCount > 0 || snapshot.events.length > 0;

const collectOptionsFor = (
  request: Pick<
    BattleRequest,
    "token" | "fetchImpl" | "now" | "maxRequests" | "cache" | "cachePolicy"
  >,
): CollectProfileOptions => ({
  ...(request.token === undefined || request.token === "" ? {} : { token: request.token }),
  ...(request.fetchImpl === undefined ? {} : { fetchImpl: request.fetchImpl }),
  ...(request.now === undefined ? {} : { now: request.now }),
  ...(request.maxRequests === undefined ? {} : { maxRequests: request.maxRequests }),
  ...(request.cache === undefined ? {} : { cache: request.cache }),
  ...(request.cachePolicy === undefined ? {} : { cachePolicy: request.cachePolicy }),
});

/** Canonical-only profile preparation with current-invocation request telemetry. */
async function prepareProfile(request: ProfileRequest): Promise<PreparedProfileResult> {
  const handle = normalizeGithubLogin(request.handle);
  if (handle === null) {
    return {
      ok: false,
      error: {
        code: "invalid_handle",
        message: `"${request.handle.slice(0, 40)}" is not a GitHub handle.`,
        handle: request.handle.slice(0, 40),
      },
    };
  }
  reportProgress(request.onProgress, {
    type: "profile-collection-start",
    mode: "profile",
    handles: [handle],
  });
  let rankingCached = false;
  const collected = await collectProfileSnapshot(handle, {
    ...collectOptionsFor(request),
    onRepositoryRankingStart: ({ cached }) => {
      rankingCached = cached;
      reportProgress(request.onProgress, { type: "repository-ranking-start", cached });
    },
  });
  if (!collected.ok) return { ok: false, error: fromGithubError(collected.error, handle) };
  if (!hasScorableEvidence(collected.snapshot)) {
    return {
      ok: false,
      error: {
        code: "insufficient_evidence",
        message: `${collected.snapshot.profile.login} has no public repositories and no public activity to score.`,
        handle: collected.snapshot.profile.login,
      },
    };
  }
  reportProgress(request.onProgress, {
    type: "profile-collection-complete",
    metadataRequests: collected.requestsUsed,
    cachedProfiles: collected.requestsUsed === 0 ? 1 : 0,
  });
  reportProgress(request.onProgress, {
    type: "repository-ranking-complete",
    eligibleRepositories: collected.snapshot.eligibleRepositoryCount,
    inspectedRepositories: collected.snapshot.inspections.length,
    cached: rankingCached,
  });
  reportProgress(request.onProgress, { type: "scoring-start" });
  const profile = scoreProfileFastScan(collected.snapshot);
  reportProgress(request.onProgress, {
    type: "scoring-complete",
    scores: [profile.overallScore],
    winner: "profile",
  });
  return {
    ok: true,
    profile,
    snapshot: collected.snapshot,
    metadataRequestsUsed: collected.requestsUsed,
  };
}

/** Canonical-only profile collection. It never reads source blobs or derives Code DNA. */
export async function runCanonicalProfile(
  request: ProfileRequest,
): Promise<CanonicalProfileServiceResult> {
  const prepared = await prepareProfile(request);
  return prepared.ok
    ? { ok: true, profile: prepared.profile, snapshot: prepared.snapshot }
    : prepared;
}

/** Complete CLI profile analysis: canonical score plus bounded source analysis. */
export async function runProfile(request: ProfileRequest): Promise<ProfileServiceResult> {
  const prepared = await prepareProfile(request);
  if (!prepared.ok) return prepared;
  let sourceRequests = 0;
  reportProgress(request.onProgress, { type: "source-analysis-start" });
  const sourceAnalysis = await readCodeDna(prepared.snapshot, {
    ...(request.token === undefined || request.token === "" ? {} : { token: request.token }),
    ...(request.fetchImpl === undefined ? {} : { fetchImpl: request.fetchImpl }),
    ...request.sourceAnalysis,
    ...(request.maxRequests === undefined
      ? {}
      : { maxRequests: Math.max(0, request.maxRequests - prepared.metadataRequestsUsed) }),
    onRequestsUsed: (requests) => {
      sourceRequests = requests;
    },
  });
  reportProgress(request.onProgress, {
    type: "source-analysis-complete",
    status: sourceAnalysis.status,
    files: sourceAnalysis.samples.length,
    repositories: new Set(sourceAnalysis.samples.map((sample) => sample.repository)).size,
    requests: sourceRequests,
    rateLimited: readingWasRateLimited(sourceAnalysis),
  });
  reportProgress(request.onProgress, { type: "quality-analysis-start" });
  const qualityPreview = await runQualityPreview(
    prepared.snapshot,
    request,
    request.quality?.enabled === false
      ? { source: 0, attribution: 0 }
      : {
          source: request.quality?.sourceRequestCap ?? 21,
          attribution: request.quality?.attributionRequestCap ?? 12,
        },
  );
  reportProgress(request.onProgress, {
    type: "quality-analysis-complete",
    status: qualityPreview.status,
    files: qualityPreview.maintainedCodebase.files,
    repositories: qualityPreview.maintainedCodebase.repositories,
    sourceRequests: qualityPreview.requestBudget.sourceRequests,
    attributionRequests: qualityPreview.requestBudget.attributionRequests,
  });
  return {
    ok: true,
    profile: prepared.profile,
    snapshot: prepared.snapshot,
    sourceAnalysis,
    qualityPreview,
    requestBudget: {
      metadata: prepared.metadataRequestsUsed,
      source: sourceRequests,
      total: prepared.metadataRequestsUsed + sourceRequests,
      cap: prepared.snapshot.budget.maxRequests,
    },
  };
}

/**
 * Builds the numeric battle and returns the already-collected snapshots to the mandatory
 * bounded source-analysis stage.
 */
export async function prepareBattle(request: BattleRequest): Promise<PreparedBattleResult> {
  const handles = parseHandles(request.left, request.right);
  if (!handles.ok) return handles;

  const roast = resolveRoast(request.roast);
  const collectOptions = collectOptionsFor(request);
  const leftCollectOptions = {
    ...collectOptions,
    ...(request.requestCaps === undefined ? {} : { maxRequests: request.requestCaps.left }),
  };
  const rightCollectOptions = {
    ...collectOptions,
    ...(request.requestCaps === undefined ? {} : { maxRequests: request.requestCaps.right }),
  };
  reportProgress(request.onProgress, {
    type: "profile-collection-start",
    mode: "battle",
    handles: [handles.left, handles.right],
  });
  let rankingStarts = 0;
  let rankingCached = true;
  const onRepositoryRankingStart = ({ cached }: { readonly cached: boolean }): void => {
    rankingCached &&= cached;
    rankingStarts += 1;
    if (rankingStarts === 2) {
      reportProgress(request.onProgress, {
        type: "repository-ranking-start",
        cached: rankingCached,
      });
    }
  };

  const [leftResult, rightResult] = await Promise.all([
    collectProfileSnapshot(handles.left, { ...leftCollectOptions, onRepositoryRankingStart }),
    collectProfileSnapshot(handles.right, { ...rightCollectOptions, onRepositoryRankingStart }),
  ]);

  if (!leftResult.ok) return { ok: false, error: fromGithubError(leftResult.error, handles.left) };
  if (!rightResult.ok) {
    return { ok: false, error: fromGithubError(rightResult.error, handles.right) };
  }

  for (const snapshot of [leftResult.snapshot, rightResult.snapshot]) {
    if (!hasScorableEvidence(snapshot)) {
      return {
        ok: false,
        error: {
          code: "insufficient_evidence",
          message: `${snapshot.profile.login} has no public repositories and no public activity to score.`,
          handle: snapshot.profile.login,
        },
      };
    }
  }

  const metadataRequests = leftResult.requestsUsed + rightResult.requestsUsed;
  reportProgress(request.onProgress, {
    type: "profile-collection-complete",
    metadataRequests,
    cachedProfiles: Number(leftResult.requestsUsed === 0) + Number(rightResult.requestsUsed === 0),
  });
  reportProgress(request.onProgress, {
    type: "repository-ranking-complete",
    eligibleRepositories:
      leftResult.snapshot.eligibleRepositoryCount + rightResult.snapshot.eligibleRepositoryCount,
    inspectedRepositories:
      leftResult.snapshot.inspections.length + rightResult.snapshot.inspections.length,
    cached: rankingCached,
  });
  reportProgress(request.onProgress, { type: "scoring-start" });

  const cards: [ProfileScorecard, ProfileScorecard] = [
    scoreProfileFastScan(leftResult.snapshot),
    scoreProfileFastScan(rightResult.snapshot),
  ];
  const battle = buildBattle(cards[0], cards[1], {
    roast,
    ...(request.siteUrl === undefined ? {} : { siteUrl: request.siteUrl }),
  });
  reportProgress(request.onProgress, {
    type: "scoring-complete",
    scores: [battle.left.overallScore, battle.right.overallScore],
    winner: battle.winner,
  });
  return {
    ok: true,
    battle,
    snapshots: { left: leftResult.snapshot, right: rightResult.snapshot },
    metadataRequestsUsed: {
      left: leftResult.requestsUsed,
      right: rightResult.requestsUsed,
    },
  };
}

/** Complete CLI battle: canonical score plus bounded source and authored story. */
export async function runBattle(request: BattleRequest): Promise<BattleServiceResult> {
  const prepared = await prepareBattle(request);
  if (!prepared.ok) return prepared;
  const { battle, snapshots, metadataRequestsUsed } = prepared;
  reportProgress(request.onProgress, { type: "source-analysis-start" });
  const analysis = await analyzeBattleSource({
    battle,
    snapshots,
    metadataRequestsUsed,
    ...(request.token === undefined || request.token === "" ? {} : { token: request.token }),
    ...(request.fetchImpl === undefined ? {} : { fetchImpl: request.fetchImpl }),
    ...request.sourceAnalysis,
    ...(request.requestCaps === undefined
      ? {}
      : {
          sourceRequestCaps: {
            left: Math.max(0, request.requestCaps.left - metadataRequestsUsed.left),
            right: Math.max(0, request.requestCaps.right - metadataRequestsUsed.right),
          },
        }),
    onSourceAnalysisComplete: (sourceAnalysis) => {
      const samples = [...sourceAnalysis.left.samples, ...sourceAnalysis.right.samples];
      const readings = [sourceAnalysis.left.codeDna, sourceAnalysis.right.codeDna];
      reportProgress(request.onProgress, {
        type: "source-analysis-complete",
        status: sourceAnalysis.status,
        files: samples.length,
        repositories: new Set(samples.map((sample) => sample.repository)).size,
        requests:
          sourceAnalysis.requestBudget.left.source + sourceAnalysis.requestBudget.right.source,
        rateLimited: readings.some(readingWasRateLimited),
      });
    },
    onStoryStart: () => {
      reportProgress(request.onProgress, { type: "story-start" });
    },
    onStoryComplete: () => {
      reportProgress(request.onProgress, { type: "story-complete" });
    },
  });
  reportProgress(request.onProgress, { type: "quality-analysis-start" });
  const qualityCaps =
    request.quality?.enabled === false
      ? { sourceRequestCaps: { left: 0, right: 0 }, attributionRequestCaps: { left: 0, right: 0 } }
      : {
          sourceRequestCaps: request.quality?.sourceRequestCaps ?? { left: 21, right: 21 },
          attributionRequestCaps: request.quality?.attributionRequestCaps ?? {
            left: 12,
            right: 12,
          },
        };
  const [leftQuality, rightQuality] = await Promise.all([
    runQualityPreview(snapshots.left, request, {
      source: qualityCaps.sourceRequestCaps.left,
      attribution: qualityCaps.attributionRequestCaps.left,
    }),
    runQualityPreview(snapshots.right, request, {
      source: qualityCaps.sourceRequestCaps.right,
      attribution: qualityCaps.attributionRequestCaps.right,
    }),
  ]);
  const qualityPreview: QualityJudgePair = { left: leftQuality, right: rightQuality };
  reportProgress(request.onProgress, {
    type: "quality-analysis-complete",
    status:
      leftQuality.status === "ready" && rightQuality.status === "ready"
        ? "ready"
        : leftQuality.status === "insufficient" && rightQuality.status === "insufficient"
          ? "insufficient"
          : "partial",
    files: leftQuality.maintainedCodebase.files + rightQuality.maintainedCodebase.files,
    repositories:
      leftQuality.maintainedCodebase.repositories + rightQuality.maintainedCodebase.repositories,
    sourceRequests:
      leftQuality.requestBudget.sourceRequests + rightQuality.requestBudget.sourceRequests,
    attributionRequests:
      leftQuality.requestBudget.attributionRequests +
      rightQuality.requestBudget.attributionRequests,
  });
  return {
    ok: true,
    battle,
    ...analysis,
    qualityPreview,
  };
}

/** Canonical-only battle orchestration for retained non-CLI consumers. */
export async function runCanonicalBattle(
  request: BattleRequest,
): Promise<CanonicalBattleServiceResult> {
  const prepared = await prepareBattle(request);
  return prepared.ok ? { ok: true, battle: prepared.battle } : prepared;
}

/** `alice-vs-bob` — the canonical battle identifier, shared by the CLI's cache keys and
 * any URL-shaped surface. */
export function parseMatchup(
  matchup: string,
): { readonly left: string; readonly right: string } | null {
  const parts = decodeURIComponent(matchup).split("-vs-");
  if (parts.length !== 2) return null;
  const [left, right] = parts;
  if (left === undefined || right === undefined) return null;
  return { left, right };
}
