import type { SourceFeatures } from "@gitmog/analyzers";

import type { RateLimitClass } from "./request-plan.js";

/** One explicit policy for a persistent cache layer. In-command memoization is not
 * persistent state and deliberately remains available when both values are false. */
export interface PersistentCachePolicy {
  readonly read: boolean;
  readonly write: boolean;
}

/** Canonical logical source opportunities available to one profile analysis.
 * This is selection scope, not current-invocation HTTP telemetry. */
export interface SourceOpportunityScope {
  readonly sourceRequestAllowance: number;
}

export const NORMAL_PERSISTENT_CACHE_POLICY: PersistentCachePolicy = Object.freeze({
  read: true,
  write: true,
});

/** Version home for the exact normalized snapshot object persisted by the CLI. */
export const PROFILE_SNAPSHOT_SCHEMA_VERSION = "2.0.0-default-full-profile-snapshot";

/** GitHub's public-events endpoint admits at most 100 items per page. The
 * authenticated collector is the widest snapshot producer at three pages, so this
 * product is the single persistence bound for every cache consumer. */
export const EVENTS_PER_PAGE = 100;
export const MAX_EVENT_PAGES = 3;
export const MAX_PROFILE_EVENTS = MAX_EVENT_PAGES * EVENTS_PER_PAGE;

/** Public GitHub evidence, normalized. Every field here is visible to an anonymous
 * browser on github.com. Nothing derived from a token's extra permissions belongs in
 * this file. */

export interface GithubProfile {
  readonly login: string;
  readonly id: number;
  readonly name: string | null;
  readonly avatarUrl: string;
  readonly htmlUrl: string;
  readonly bio: string | null;
  readonly publicRepos: number;
  readonly followers: number;
  readonly createdAt: string;
  readonly accountType: string;
}

export interface RepositorySummary {
  readonly id: number;
  readonly name: string;
  readonly fullName: string;
  readonly htmlUrl: string;
  readonly description: string | null;
  readonly fork: boolean;
  readonly archived: boolean;
  readonly disabled: boolean;
  readonly isTemplate: boolean;
  readonly mirror: boolean;
  readonly sizeKb: number;
  readonly stars: number;
  readonly forks: number;
  readonly openIssues: number;
  readonly primaryLanguage: string | null;
  readonly topics: readonly string[];
  readonly homepage: string | null;
  readonly licenseSpdxId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly pushedAt: string | null;
  readonly defaultBranch: string;
}

export interface RepositoryTreeEntry {
  readonly path: string;
  readonly type: "blob" | "tree" | "commit";
  readonly sizeBytes: number;
  readonly sha: string;
}

/**
 * One bounded public source blob after in-memory redaction and deterministic feature
 * extraction. Raw source is discarded before this object is returned.
 */
export interface CodeSample {
  readonly sampleId: string;
  readonly repository: string;
  readonly repositoryUrl: string;
  readonly primaryLanguage: string | null;
  readonly pushedAt: string;
  readonly treeSha: string;
  readonly path: string;
  readonly blobSha: string;
  readonly sourceUrl: string;
  readonly features: SourceFeatures;
  readonly byteLength: number;
  readonly truncated: boolean;
  /** True when this file was taken as a secondary ritual sample rather than as
   * implementation evidence. */
  readonly isTest: boolean;
  /** How many secret-shaped values were replaced. The values themselves are gone. */
  readonly redactions: number;
  /** Straightforward comment-only lines omitted from the lexical feature sample. */
  readonly commentLinesRemoved: number;
  /** Long single-line strings replaced by a stable length marker. */
  readonly stringsShortened: number;
  readonly selectionScore: number;
}

/** Safe-to-render subset of a sample. It deliberately contains no source bytes. */
export type CodeSampleReceipt = Omit<CodeSample, "features">;

export interface DerivedFeatureCacheKey {
  readonly repositoryId: number;
  readonly repository: string;
  readonly commitSha: string;
  readonly blobSha: string;
  readonly normalizedPath: string;
  readonly language: SourceFeatures["language"];
  /** The deterministic text window used for this path-specific feature vector. */
  readonly byteLimit: number;
  readonly analyzerVersion: string;
  readonly sourceFeatureVersion: string;
  readonly redactionVersion: string;
}

export interface DerivedFeatureCacheEntry {
  readonly key: DerivedFeatureCacheKey;
  readonly features: SourceFeatures;
  readonly coverage: { readonly languageSupported: boolean; readonly nonBlankLines: number };
  readonly redactionCount: number;
  readonly byteLength: number;
  readonly truncated: boolean;
  readonly commentLinesRemoved: number;
  readonly stringsShortened: number;
}

export interface DerivedFeatureCache {
  get(key: DerivedFeatureCacheKey): DerivedFeatureCacheEntry | undefined;
  set(key: DerivedFeatureCacheKey, value: DerivedFeatureCacheEntry): void;
}

export const SOURCE_SAMPLE_FAILURE_REASONS = Object.freeze([
  "no-source-candidate",
  "rate-limited",
  "request-budget-exhausted",
  "tree-unavailable",
  "blob-unavailable",
  "oversized",
  "non-text",
  "redaction-threshold",
  "unsupported-language",
  "timeout",
  "transport-failure",
  "upstream-failure",
  "incomplete-github-response",
  "unknown",
] as const);
export type SourceSampleFailureReason = (typeof SOURCE_SAMPLE_FAILURE_REASONS)[number];

export interface SourceSampleFailure {
  readonly reason: SourceSampleFailureReason;
  readonly repository?: string | undefined;
  readonly path?: string | undefined;
  /** Safe diagnostic written by Git Mog; never contains source or response-body text. */
  readonly detail: string;
}

export interface SourceSampleSet {
  readonly sampleVersion: string;
  readonly sampleKey: string;
  readonly samples: readonly CodeSample[];
  readonly repositoriesRepresented: number;
  /** A truncated tree means the ranking saw only part of the repository. */
  readonly treeTruncated: boolean;
  readonly totalBytes: number;
  readonly failures: readonly SourceSampleFailure[];
  /** Deterministically selected from `failures` when no sample survived. */
  readonly zeroSampleReason: SourceSampleFailureReason | null;
  readonly requestsUsed: number;
}

export interface RepositoryInspection {
  readonly name: string;
  readonly fullName: string;
  readonly htmlUrl: string;
  readonly languageBytes: Readonly<Record<string, number>>;
  readonly releaseCount: number;
  readonly latestReleaseAt: string | null;
  readonly tree: readonly RepositoryTreeEntry[] | null;
  readonly treeSha: string | null;
  readonly treeTruncated: boolean;
  /** Endpoint names that failed for this repository. The rest of the inspection is
   * still usable; the scorecard degrades coverage instead of failing the battle. */
  readonly failures: readonly string[];
}

/**
 * The subset of a public event the fast scan reads. Payloads are flattened here so no
 * raw GitHub response object reaches the scoring layer.
 *
 * `PushEvent` payloads on the *public* events endpoint no longer carry `commits`,
 * `size` or `distinct_size` — verified against the live API on 2026-08-13. A push is
 * therefore one observation, not a commit count, and commit-level evidence comes from
 * `ProfileSnapshot.commitSample` instead.
 */
export interface PublicEvent {
  readonly type: string;
  readonly repoFullName: string;
  readonly createdAt: string;
  readonly action: string | null;
  readonly merged: boolean;
  readonly isBotActor: boolean;
}

export interface RepositoryCommit {
  readonly sha: string;
  readonly message: string;
  readonly authoredAt: string;
  /** More than one parent is a merge commit. Exact, unlike matching on the message. */
  readonly parentCount: number;
  readonly authorName: string;
  readonly isBotAuthor: boolean;
}

/** Up to one page of commits from the single most representative repository, which is
 * the only tokenless way left to see real commit messages. */
export interface CommitSample {
  readonly repository: string;
  readonly repositoryUrl: string;
  readonly commits: readonly RepositoryCommit[];
  readonly truncated: boolean;
}

export interface EventWindow {
  readonly oldest: string | null;
  readonly newest: string | null;
  /** True when the page cap stopped collection before the API ran out of events. */
  readonly truncated: boolean;
}

export interface RateLimitStatus {
  readonly authenticated: boolean;
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly resetAt: string | null;
}

export interface CollectionBudget {
  readonly maxRequests: number;
  readonly usedRequests: number;
  readonly maxInspectedRepositories: number;
  readonly inspectedRepositories: number;
  readonly exhausted: boolean;
}

export interface ProfileSnapshot {
  /** Stable digest of the evidence below plus `referenceDate`. Identical GitHub data
   * collected twice on the same UTC day produces the same key. */
  readonly snapshotKey: string;
  readonly collectedAt: string;
  /** `collectedAt` truncated to the UTC day. Scoring reads no clock and derives every
   * age from this. See ADR 0004 D5. */
  readonly referenceDate: string;
  readonly profile: GithubProfile;
  readonly repositories: readonly RepositorySummary[];
  readonly repositoryListComplete: boolean;
  readonly eligibleRepositoryCount: number;
  readonly selectedRepositories: readonly string[];
  readonly inspections: readonly RepositoryInspection[];
  readonly events: readonly PublicEvent[];
  readonly eventsAvailable: boolean;
  readonly eventWindow: EventWindow;
  readonly commitSample: CommitSample | null;
  readonly budget: CollectionBudget;
  readonly rateLimit: RateLimitStatus;
  /** Human-readable statements about what could not be collected. Rendered verbatim
   * in the product's coverage panel. */
  readonly degradations: readonly string[];
}

export type GithubErrorCode =
  | "invalid_handle"
  | "not_found"
  | "suspended"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "malformed_response"
  | "response_too_large"
  | "upstream_error";

export interface GithubError {
  readonly code: GithubErrorCode;
  readonly message: string;
  readonly retryAfterSeconds?: number;
  readonly resetAt?: string;
  readonly rateLimitClass?: RateLimitClass;
  readonly remaining?: number | null;
}

export type CollectionResult =
  | {
      readonly ok: true;
      readonly snapshot: ProfileSnapshot;
      /** Actual metadata HTTP calls made by this collection invocation. */
      readonly requestsUsed: number;
    }
  | { readonly ok: false; readonly error: GithubError };
