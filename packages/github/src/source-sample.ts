import { Buffer } from "node:buffer";

import {
  SOURCE_FEATURE_VERSION,
  SOURCE_REDACTION_VERSION,
  SOURCE_SIMPLIFICATION_VERSION,
  extractSourceFeatures,
  featureLanguageOf,
  redactSecretShapedValues,
  simplifySourceForFeatures,
} from "@gitmog/analyzers";

import { digest } from "./digest.js";
import { GithubHttpClient, type GithubHttpOptions } from "./http.js";
import { isEligibleRepository, selectionScore } from "./select.js";
import type {
  CodeSample,
  DerivedFeatureCache,
  DerivedFeatureCacheEntry,
  DerivedFeatureCacheKey,
  GithubError,
  PersistentCachePolicy,
  ProfileSnapshot,
  RepositorySummary,
  SourceSampleFailure,
  SourceSampleFailureReason,
  SourceSampleSet,
  SourceOpportunityScope,
} from "./types.js";

/** Sampling contract version. Any selection change invalidates profile analysis. */
export const CODE_DNA_SAMPLE_VERSION = "6.1.0-failure-fallback-opportunities";
export const SOURCE_SAMPLE_VERSION = CODE_DNA_SAMPLE_VERSION;
export const SOURCE_ANALYZER_VERSION = `1.0.0-bounded-public-source:${SOURCE_SIMPLIFICATION_VERSION}`;

const MAX_REPOSITORIES = 3;
const MIN_REPOSITORIES = 2;
/** Three moderate implementation files from different projects beat one large file. */
const PREFERRED_FILES = 3;
const MAX_FILES = 4;
/** Candidate examination remains bounded after deterministic metadata filtering. */
const MAX_CANDIDATES_PER_REPOSITORY = 12;
/** Metadata failures are useful receipts, but can never grow with a whole bounded tree. */
const MAX_METADATA_FAILURES = 8;
const MAX_SOURCE_FAILURES = 16;
export const MAX_SAMPLE_BYTES_PER_FILE = 12_000;
export const MAX_SAMPLE_BYTES_TOTAL = 24_000;
/** A 12,000-byte blob needs at most 16,000 base64 characters. GitHub may wrap
 * base64 at 60 columns (534 JSON escape bytes); 4 KiB bounds the remaining JSON
 * keys and metadata. The raw source-blob response therefore stops at 20,630 bytes. */
export const MAX_SOURCE_BLOB_BASE64_CHARS = Math.ceil(MAX_SAMPLE_BYTES_PER_FILE / 3) * 4;
const MAX_SOURCE_BLOB_LINEBREAK_JSON_BYTES = Math.ceil(MAX_SOURCE_BLOB_BASE64_CHARS / 60) * 2;
const MAX_SOURCE_BLOB_JSON_METADATA_BYTES = 4 * 1024;
export const MAX_SOURCE_BLOB_RESPONSE_BYTES =
  MAX_SOURCE_BLOB_BASE64_CHARS +
  MAX_SOURCE_BLOB_LINEBREAK_JSON_BYTES +
  MAX_SOURCE_BLOB_JSON_METADATA_BYTES;
/** At most one secondary test sample, and never in the first slot (ADR 0009 D6). */
const MAX_TEST_SAMPLES = 1;

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".clj",
  ".cljs",
  ".cpp",
  ".cs",
  ".dart",
  ".ex",
  ".exs",
  ".fs",
  ".fsx",
  ".go",
  ".h",
  ".hpp",
  ".hs",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".lua",
  ".m",
  ".mm",
  ".php",
  ".pl",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".scala",
  ".sh",
  ".sol",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
  ".zig",
]);

const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  "__generated__",
  "__mocks__",
  "__snapshots__",
  "build",
  "coverage",
  "deps",
  "dist",
  "fixtures",
  "generated",
  "migrations",
  "mocks",
  "node_modules",
  "out",
  "target",
  "third_party",
  "vendor",
]);

const EXCLUDED_SUFFIXES = [
  ".d.ts",
  ".generated.js",
  ".generated.ts",
  ".gen.go",
  ".pb.go",
  ".min.js",
  ".min.css",
  ".snap",
  "_pb2.py",
  ".spec.snap",
];

/** Implementation directories. A file under one of these is much more likely to be the
 * work than a root-level script or a config shim. */
const IMPLEMENTATION_ROOTS = new Set([
  "src",
  "lib",
  "app",
  "pkg",
  "internal",
  "cmd",
  "source",
  "core",
  "packages",
  "apps",
]);

const TEST_SEGMENTS = new Set(["test", "tests", "spec", "specs", "__tests__", "e2e"]);

const BARREL_NAMES = new Set([
  "index.ts",
  "index.js",
  "index.tsx",
  "index.jsx",
  "index.mjs",
  "mod.rs",
  "lib.rs",
  "__init__.py",
  "doc.go",
]);

const CONFIG_NAMES = new Set([
  "config.ts",
  "config.js",
  "constants.ts",
  "constants.js",
  "settings.py",
  "conftest.py",
  "setup.py",
  "types.ts",
  "types.d.ts",
  "env.ts",
]);

export interface SourceTreeBlob {
  readonly path: string;
  readonly sha: string;
  readonly sizeBytes: number;
}

export interface CollectSourceSampleOptions extends GithubHttpOptions {
  readonly derivedCache?: DerivedFeatureCache | null | undefined;
  readonly cachePolicy?: PersistentCachePolicy | undefined;
}

/** Resolves the logical source-selection scope shared by sampling and whole-profile
 * cache identity. Actual HTTP calls and cache hits never enter this contract. */
export function resolveSourceOpportunityScope(
  snapshot: Pick<ProfileSnapshot, "budget">,
  options: Pick<CollectSourceSampleOptions, "maxRequests"> = {},
): SourceOpportunityScope {
  const configured =
    options.maxRequests ?? Math.max(0, snapshot.budget.maxRequests - snapshot.budget.usedRequests);
  return {
    sourceRequestAllowance: Number.isSafeInteger(configured) && configured >= 0 ? configured : 0,
  };
}

type BlobReadResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly error: GithubError }
  | { readonly ok: false; readonly reason: "oversized" | "non-text" };

const blobReadKey = (repository: RepositorySummary, blobSha: string): string =>
  `${repository.id}:${repository.fullName.toLowerCase()}:${blobSha}`;

const normalizeSourcePath = (path: string): string =>
  path
    .normalize("NFC")
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/{2,}/g, "/");

const segmentsOf = (path: string): readonly string[] =>
  path.replaceAll("\\", "/").toLowerCase().split("/");

export const isTestSamplePath = (path: string): boolean => {
  const parts = segmentsOf(path);
  const name = parts.at(-1) ?? "";
  return (
    parts.some((part) => TEST_SEGMENTS.has(part)) ||
    /(?:[._-](?:test|spec)s?)\.[a-z]+$/.test(name) ||
    /^test_/.test(name)
  );
};

export function isEligibleSourcePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const parts = normalized.split("/");
  if (parts.some((part) => EXCLUDED_SEGMENTS.has(part))) return false;
  if (EXCLUDED_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return false;
  const dot = normalized.lastIndexOf(".");
  return dot >= 0 && SOURCE_EXTENSIONS.has(normalized.slice(dot));
}

/**
 * Deterministic representativeness score for one blob. Additive and legible on purpose:
 * every term is a statement about how likely this file is to be the author's actual work
 * rather than scaffolding (ADR 0009 D6). A hash breaks exact ties only — it no longer
 * chooses the file.
 */
export function sourceFileScore(entry: SourceTreeBlob): number {
  const parts = segmentsOf(entry.path);
  const name = parts.at(-1) ?? "";
  const root = parts[0] ?? "";
  let score = 0;

  if (IMPLEMENTATION_ROOTS.has(root)) score += 3;
  else if (parts.length === 1) score -= 1;
  if (parts.length >= 2 && parts.length <= 4) score += 1;
  if (parts.length > 5) score -= 1;

  // A moderate file is the sweet spot: big enough to have structure, small enough that
  // one file cannot dominate the whole reading.
  const kilobytes = entry.sizeBytes / 1024;
  if (kilobytes >= 1.5 && kilobytes <= 10) score += 3;
  else if (kilobytes > 10 && kilobytes <= 24) score += 1.5;
  else if (kilobytes >= 0.6 && kilobytes < 1.5) score += 0.5;
  else if (kilobytes > 24) score -= 1;
  else score -= 2.5;

  if (BARREL_NAMES.has(name)) score -= 3;
  if (CONFIG_NAMES.has(name)) score -= 2;
  if (isTestSamplePath(entry.path)) score -= 2.5;
  if (featureLanguageOf(entry.path) === "unknown") score -= 1.5;
  if (/^[a-z0-9]+\.(?:ts|js|py|go|rs|rb|php|java|kt|swift|cs)$/.test(name)) score += 0.5;

  return score;
}

export interface SelectedSourceFile {
  readonly blob: SourceTreeBlob;
  readonly score: number;
  readonly isTest: boolean;
}

/**
 * Ranks eligible blobs. Deterministic: path order from the API cannot influence the
 * result, because ties resolve on a hash of the path rather than on array position.
 */
export function rankSourceFiles(entries: readonly SourceTreeBlob[]): readonly SelectedSourceFile[] {
  return (
    entries
      // GitHub may omit a blob size. Normalization represents that unknown value as zero;
      // the streamed reader, not metadata, remains authoritative in that case.
      .filter(
        (entry) =>
          isEligibleSourcePath(entry.path) &&
          Number.isSafeInteger(entry.sizeBytes) &&
          entry.sizeBytes >= 0,
      )
      .map((entry) => ({
        blob: entry,
        score: sourceFileScore(entry),
        isTest: isTestSamplePath(entry.path),
      }))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        const leftHash = digest(left.blob.path).slice(0, 12);
        const rightHash = digest(right.blob.path).slice(0, 12);
        return leftHash.localeCompare(rightHash);
      })
  );
}

/**
 * Repository candidates, in the collector's own representative order. Reusing
 * `selectionScore` means source analysis reads the repositories the scorecard already treats
 * as representative, instead of whatever was pushed most recently (ADR 0009 D6).
 */
export function selectSampleRepositories(snapshot: ProfileSnapshot): readonly RepositorySummary[] {
  const referenceMs = Date.parse(`${snapshot.referenceDate}T00:00:00.000Z`);
  const preferred = new Set(snapshot.selectedRepositories);
  return snapshot.repositories
    .filter((repository) => isEligibleRepository(repository) && repository.pushedAt !== null)
    .map((repository) => ({
      repository,
      // Repositories the collector already inspected come first: their trees are known
      // to be readable, so a request is much less likely to be wasted.
      score: selectionScore(repository, referenceMs) + (preferred.has(repository.name) ? 5 : 0),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.repository.name.localeCompare(right.repository.name);
    })
    .slice(0, MAX_REPOSITORIES)
    .map((entry) => entry.repository);
}

export async function collectSourceSamples(
  snapshot: ProfileSnapshot,
  options: CollectSourceSampleOptions = {},
): Promise<SourceSampleSet> {
  const { sourceRequestAllowance } = resolveSourceOpportunityScope(snapshot, options);
  const client = new GithubHttpClient({
    ...options,
    maxRequests: sourceRequestAllowance,
    userAgent: options.userAgent ?? "gitmog-source-analysis",
  });
  const repositories = selectSampleRepositories(snapshot);
  const samples: CodeSample[] = [];
  const failures: SourceSampleFailure[] = [];
  let metadataFailureCount = 0;
  let treeTruncated = false;
  let totalBytes = 0;
  const blobReads = new Map<string, Promise<BlobReadResult>>();
  const cachePolicy = options.cachePolicy ?? { read: true, write: true };
  const recordFailure = (value: SourceSampleFailure, metadata = false): void => {
    if (failures.length >= MAX_SOURCE_FAILURES) return;
    if (metadata && metadataFailureCount >= MAX_METADATA_FAILURES) return;
    failures.push(value);
    if (metadata) metadataFailureCount += 1;
  };

  // Trees are reused from the canonical collection. Only immutable blobs can spend the
  // remaining profile budget, spread across repositories so one project cannot dominate.
  const ranked: {
    readonly repository: RepositorySummary;
    readonly treeSha: string;
    readonly files: readonly SelectedSourceFile[];
  }[] = [];

  for (const repository of repositories) {
    const inspection = snapshot.inspections.find(
      (entry) => entry.fullName.toLowerCase() === repository.fullName.toLowerCase(),
    );
    if (inspection?.tree === null || inspection === undefined || inspection.treeSha === null) {
      recordFailure(
        failure(
          "tree-unavailable",
          "The collected repository tree was unavailable.",
          repository.fullName,
        ),
      );
      continue;
    }
    if (inspection.treeTruncated) {
      treeTruncated = true;
      recordFailure(
        failure(
          "incomplete-github-response",
          "The collected repository tree response was incomplete.",
          repository.fullName,
        ),
      );
    }
    const candidates = rankSourceFiles(
      inspection.tree
        .filter((entry) => entry.type === "blob" && entry.sha !== "")
        .map((entry) => ({ path: entry.path, sha: entry.sha, sizeBytes: entry.sizeBytes })),
    );
    const advertisedOversized = candidates.filter(
      (candidate) => candidate.blob.sizeBytes > MAX_SAMPLE_BYTES_PER_FILE,
    );
    for (const candidate of advertisedOversized) {
      recordFailure(
        failure(
          "oversized",
          `The selected source blob exceeds the ${String(MAX_SAMPLE_BYTES_PER_FILE)}-byte file ceiling.`,
          repository.fullName,
          candidate.blob.path,
        ),
        true,
      );
    }
    const files = candidates
      .filter((candidate) => candidate.blob.sizeBytes <= MAX_SAMPLE_BYTES_PER_FILE)
      .slice(0, MAX_CANDIDATES_PER_REPOSITORY);
    if (files.length === 0 && advertisedOversized.length === 0) {
      recordFailure(
        failure(
          "no-source-candidate",
          "No supported implementation source candidate was found.",
          repository.fullName,
        ),
      );
    }
    ranked.push({ repository, treeSha: inspection.treeSha, files });
  }

  // Build the complete bounded round-robin order before any cache lookup. Paths sharing
  // one blob retain separate path-specific opportunities. Persistent cache state can
  // save HTTP calls, but cannot reorder the traversal or expand its logical allowance.
  const candidateOrder: {
    readonly repository: RepositorySummary;
    readonly treeSha: string;
    readonly candidate: SelectedSourceFile;
  }[] = [];
  const cursor = new Map<string, number>();
  while (true) {
    let progressed = false;
    for (const entry of ranked) {
      const index = cursor.get(entry.repository.name) ?? 0;
      const candidate = entry.files[index];
      if (candidate === undefined) continue;
      cursor.set(entry.repository.name, index + 1);
      progressed = true;
      candidateOrder.push({ repository: entry.repository, treeSha: entry.treeSha, candidate });
    }
    if (!progressed) break;
  }

  const opportunityBlobs = new Set<string>();
  let successfulTests = 0;
  let opportunitiesExamined = 0;
  let opportunityBudgetExhausted = false;
  const targetFiles = ranked.length >= MIN_REPOSITORIES ? PREFERRED_FILES : MAX_FILES;

  // Traverse the fixed metadata order until enough files survive. Every distinct blob
  // that is actually examined consumes one logical opportunity even when its derived
  // features are cached, so warm caches cannot promote extra candidates. A rejected
  // read can still promote the next bounded opportunity when allowance remains.
  sampling: for (const entry of candidateOrder) {
    if (samples.length >= targetFiles) break;
    if (opportunitiesExamined >= MAX_SOURCE_FAILURES + MAX_FILES) break;
    // A failed implementation sample never promotes a test file into the primary slot,
    // and only one surviving test sample may supplement implementation evidence.
    if (entry.candidate.isTest && (successfulTests >= MAX_TEST_SAMPLES || samples.length === 0)) {
      continue;
    }
    const opportunityKey = blobReadKey(entry.repository, entry.candidate.blob.sha);
    if (!opportunityBlobs.has(opportunityKey)) {
      if (opportunityBlobs.size >= sourceRequestAllowance) {
        opportunityBudgetExhausted = true;
        continue;
      }
      opportunityBlobs.add(opportunityKey);
    }
    opportunitiesExamined += 1;
    const sample = await readBlob(
      client,
      entry.repository,
      entry.treeSha,
      entry.candidate,
      totalBytes,
      options.derivedCache,
      cachePolicy,
      blobReads,
    );
    if ("reason" in sample) {
      recordFailure(sample);
      if (sample.reason === "request-budget-exhausted" || sample.reason === "rate-limited") {
        break sampling;
      }
      continue;
    }
    totalBytes += sample.byteLength;
    samples.push(sample);
    if (sample.isTest) successfulTests += 1;
    if (!sample.features.languageSupported) {
      recordFailure(
        failure(
          "unsupported-language",
          "The selected source language is outside the bounded feature lanes.",
          entry.repository.fullName,
          entry.candidate.blob.path,
        ),
      );
    }
  }

  if (opportunityBudgetExhausted || (opportunityBlobs.size === 0 && candidateOrder.length > 0)) {
    recordFailure(
      failure(
        "request-budget-exhausted",
        opportunityBlobs.size === 0
          ? "The complete profile request budget allowed no source-blob opportunity."
          : "The complete profile request budget bounded the selected source-blob opportunities.",
      ),
    );
  }

  if (repositories.length === 0) {
    recordFailure(
      failure("no-source-candidate", "No eligible public repository could supply source."),
    );
  }
  if (samples.length === 0 && failures.length === 0) {
    recordFailure(
      failure("no-source-candidate", "No supported implementation source candidate was found."),
    );
  }

  const receipts = samples.map(({ features: _features, ...receipt }) => receipt);
  return {
    sampleVersion: CODE_DNA_SAMPLE_VERSION,
    sampleKey: digest({
      version: CODE_DNA_SAMPLE_VERSION,
      login: snapshot.profile.login,
      receipts,
    }),
    samples,
    repositoriesRepresented: new Set(samples.map((sample) => sample.repository)).size,
    treeTruncated,
    totalBytes,
    failures,
    zeroSampleReason: samples.length === 0 ? selectZeroSampleReason(failures) : null,
    requestsUsed: client.requestsUsed,
  };
}

async function readBlob(
  client: GithubHttpClient,
  repository: RepositorySummary,
  treeSha: string,
  candidate: SelectedSourceFile,
  bytesSoFar: number,
  derivedCache: DerivedFeatureCache | null | undefined,
  cachePolicy: PersistentCachePolicy,
  blobReads: Map<string, Promise<BlobReadResult>>,
): Promise<CodeSample | SourceSampleFailure> {
  const remaining = MAX_SAMPLE_BYTES_TOTAL - bytesSoFar;
  if (remaining < 512) {
    return failure(
      "request-budget-exhausted",
      "The bounded profile source-byte budget was exhausted.",
      repository.fullName,
      candidate.blob.path,
    );
  }

  const normalizedPath = normalizeSourcePath(candidate.blob.path);
  const language = featureLanguageOf(normalizedPath);
  const limit = Math.min(MAX_SAMPLE_BYTES_PER_FILE, remaining);
  const cacheKey: DerivedFeatureCacheKey = {
    repositoryId: repository.id,
    repository: repository.fullName,
    commitSha: treeSha,
    blobSha: candidate.blob.sha,
    normalizedPath,
    language,
    byteLimit: limit,
    analyzerVersion: SOURCE_ANALYZER_VERSION,
    sourceFeatureVersion: SOURCE_FEATURE_VERSION,
    redactionVersion: SOURCE_REDACTION_VERSION,
  };
  const memoKey = blobReadKey(repository, candidate.blob.sha);
  const memoized = blobReads.get(memoKey);
  if (memoized !== undefined) {
    const response = await memoized;
    return response.ok
      ? extractSample(
          response.content,
          limit,
          repository,
          treeSha,
          candidate,
          cacheKey,
          derivedCache,
          cachePolicy,
        )
      : "error" in response
        ? githubFailure(
            response.error,
            "blob-unavailable",
            repository.fullName,
            candidate.blob.path,
          )
        : failure(
            response.reason,
            response.reason === "oversized"
              ? `The selected source blob exceeds the ${String(limit)}-byte active ceiling.`
              : "The selected source blob was not readable text.",
            repository.fullName,
            candidate.blob.path,
          );
  }

  const cached = cachePolicy.read ? derivedCache?.get(cacheKey) : undefined;
  if (cached !== undefined) {
    return {
      ...receiptFor(repository, treeSha, candidate, cached),
      features: cached.features,
    };
  }

  if (!client.canSpend(1)) {
    return failure(
      "request-budget-exhausted",
      "The complete profile request budget was exhausted before this source blob.",
      repository.fullName,
      candidate.blob.path,
    );
  }

  const [owner] = repository.fullName.split("/");
  const base = `/repos/${encodeURIComponent(owner ?? "")}/${encodeURIComponent(repository.name)}`;
  const read = client
    .getBoundedJson<unknown>(
      `${base}/git/blobs/${candidate.blob.sha}`,
      MAX_SOURCE_BLOB_RESPONSE_BYTES,
    )
    .then((response): BlobReadResult => {
      if (!response.ok) return { ok: false, error: response.error };
      const decoded = decodeBlob(response.data, MAX_SAMPLE_BYTES_PER_FILE);
      return decoded.ok
        ? { ok: true, content: decoded.content }
        : { ok: false, reason: decoded.reason };
    });
  blobReads.set(memoKey, read);
  const response = await read;
  if (!response.ok) {
    return "error" in response
      ? githubFailure(response.error, "blob-unavailable", repository.fullName, candidate.blob.path)
      : failure(
          response.reason,
          response.reason === "oversized"
            ? `The selected source blob exceeds the ${String(limit)}-byte active ceiling.`
            : "The selected source blob was not readable text.",
          repository.fullName,
          candidate.blob.path,
        );
  }
  return extractSample(
    response.content,
    limit,
    repository,
    treeSha,
    candidate,
    cacheKey,
    derivedCache,
    cachePolicy,
  );
}

function extractSample(
  content: string,
  limit: number,
  repository: RepositorySummary,
  treeSha: string,
  candidate: SelectedSourceFile,
  cacheKey: DerivedFeatureCacheKey,
  derivedCache: DerivedFeatureCache | null | undefined,
  cachePolicy: PersistentCachePolicy,
): CodeSample | SourceSampleFailure {
  if (Buffer.byteLength(content, "utf8") > limit) {
    return failure(
      "oversized",
      `The selected source blob exceeds the ${String(limit)}-byte active ceiling.`,
      repository.fullName,
      candidate.blob.path,
    );
  }

  // Redaction and lexical extraction happen in this local scope. Raw text is never
  // returned, cached, logged, imported, evaluated, or executed.
  const redacted = redactSecretShapedValues(content);
  if (redacted.exhausted) {
    return failure(
      "redaction-threshold",
      "The selected file crossed the secret-shape redaction threshold.",
      repository.fullName,
      candidate.blob.path,
    );
  }
  const simplified = simplifySourceForFeatures(candidate.blob.path, redacted.text);
  const simplifiedBytes = Buffer.from(simplified.text, "utf8");
  const boundedBytes = simplifiedBytes.subarray(0, limit);
  // Avoid retaining the replacement character if the byte ceiling split a multi-byte
  // codepoint. The original blob decoder already applied the same text-validity check.
  const sourceText = boundedBytes.toString("utf8").replace(/\uFFFD$/, "");
  const byteLength = Buffer.byteLength(sourceText, "utf8");
  const features = extractSourceFeatures(candidate.blob.path, sourceText);
  const entry: DerivedFeatureCacheEntry = {
    key: cacheKey,
    features,
    coverage: {
      languageSupported: features.languageSupported,
      nonBlankLines: features.nonBlankLines,
    },
    redactionCount: redacted.redactions,
    byteLength,
    truncated: simplifiedBytes.length > limit,
    commentLinesRemoved: simplified.commentLinesRemoved,
    stringsShortened: simplified.stringsShortened,
  };
  if (cachePolicy.write) derivedCache?.set(cacheKey, entry);
  return { ...receiptFor(repository, treeSha, candidate, entry), features };
}

const receiptFor = (
  repository: RepositorySummary,
  treeSha: string,
  candidate: SelectedSourceFile,
  derived: DerivedFeatureCacheEntry,
): Omit<CodeSample, "features"> => ({
  sampleId: sourceReceiptId({
    repositoryId: repository.id,
    repository: repository.fullName,
    revision: treeSha,
    blobSha: candidate.blob.sha,
    rawPath: candidate.blob.path,
  }),
  repository: repository.fullName,
  repositoryUrl: repository.htmlUrl,
  primaryLanguage: repository.primaryLanguage,
  pushedAt: repository.pushedAt ?? repository.updatedAt,
  treeSha,
  path: candidate.blob.path,
  blobSha: candidate.blob.sha,
  sourceUrl: `${repository.htmlUrl}/blob/${treeSha}/${encodePath(candidate.blob.path)}`,
  byteLength: derived.byteLength,
  truncated: derived.truncated,
  isTest: candidate.isTest,
  redactions: derived.redactionCount,
  commentLinesRemoved: derived.commentLinesRemoved,
  stringsShortened: derived.stringsShortened,
  selectionScore: Math.round(candidate.score * 100) / 100,
});

export interface SourceReceiptIdentity {
  readonly repositoryId: number;
  readonly repository: string;
  readonly revision: string;
  readonly blobSha: string;
  readonly rawPath: string;
}

/** Public receipt identity. The object is stably serialized by `digest`, while the raw
 * Git path is encoded as exact UTF-8 bytes before hashing so NFC/NFD paths stay distinct. */
export const sourceReceiptId = (identity: SourceReceiptIdentity): string =>
  `s${digest({
    namespace: "gitmog.source-sample.receipt-id",
    version: CODE_DNA_SAMPLE_VERSION,
    repository: {
      id: identity.repositoryId,
      fullName: identity.repository,
    },
    revision: identity.revision,
    blobSha: identity.blobSha,
    rawPathUtf8: Buffer.from(identity.rawPath, "utf8").toString("hex"),
  }).slice(0, 32)}`;

const failure = (
  reason: SourceSampleFailureReason,
  detail: string,
  repository?: string,
  path?: string,
): SourceSampleFailure => ({
  reason,
  detail,
  ...(repository === undefined ? {} : { repository }),
  ...(path === undefined ? {} : { path }),
});

const githubFailure = (
  error: GithubError,
  unavailable: "tree-unavailable" | "blob-unavailable",
  repository: string,
  path: string | undefined,
): SourceSampleFailure => {
  const reason: SourceSampleFailureReason =
    error.code === "rate_limited"
      ? "rate-limited"
      : error.code === "response_too_large"
        ? "oversized"
        : error.message.toLowerCase().includes("budget exhausted")
          ? "request-budget-exhausted"
          : error.code === "not_found"
            ? unavailable
            : error.code === "timeout"
              ? "timeout"
              : error.code === "network_error"
                ? "transport-failure"
                : ["upstream_error", "malformed_response", "suspended"].includes(error.code)
                  ? "upstream-failure"
                  : "unknown";
  return failure(
    reason,
    `GitHub source sampling could not read the selected ${unavailable.startsWith("tree") ? "tree" : "blob"}.`,
    repository,
    path,
  );
};

const ZERO_REASON_PRIORITY: readonly SourceSampleFailureReason[] = Object.freeze([
  "rate-limited",
  "request-budget-exhausted",
  "timeout",
  "transport-failure",
  "upstream-failure",
  "incomplete-github-response",
  "tree-unavailable",
  "blob-unavailable",
  "oversized",
  "non-text",
  "redaction-threshold",
  "unsupported-language",
  "no-source-candidate",
  "unknown",
]);

const selectZeroSampleReason = (
  failures: readonly SourceSampleFailure[],
): SourceSampleFailureReason =>
  ZERO_REASON_PRIORITY.find((reason) => failures.some((entry) => entry.reason === reason)) ??
  "unknown";

function decodeBlob(
  raw: unknown,
  limit: number,
):
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly reason: "oversized" | "non-text" } {
  const invalid = { ok: false as const, reason: "non-text" as const };
  const oversized = { ok: false as const, reason: "oversized" as const };
  if (typeof raw !== "object" || raw === null) return invalid;
  const record = raw as Record<string, unknown>;
  if (record.encoding !== "base64" || typeof record.content !== "string") return invalid;
  if (
    record.size !== undefined &&
    (typeof record.size !== "number" || !Number.isSafeInteger(record.size) || record.size < 0)
  )
    return invalid;
  if (typeof record.size === "number" && record.size > limit) return oversized;
  if (record.content.length > MAX_SOURCE_BLOB_BASE64_CHARS + MAX_SOURCE_BLOB_LINEBREAK_JSON_BYTES)
    return oversized;
  if (/[^A-Za-z0-9+/=\r\n]/.test(record.content)) return invalid;
  const encoded = record.content.replaceAll("\n", "").replaceAll("\r", "");
  if (
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    encoded.length > MAX_SOURCE_BLOB_BASE64_CHARS ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    return encoded.length > MAX_SOURCE_BLOB_BASE64_CHARS ? oversized : invalid;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const expectedBytes = (encoded.length / 4) * 3 - padding;
  if (expectedBytes > limit) return oversized;
  if (typeof record.size === "number" && record.size !== expectedBytes) return invalid;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(encoded, "base64");
  } catch {
    return invalid;
  }
  if (bytes.length > limit) return oversized;
  if (bytes.length !== expectedBytes || bytes.toString("base64") !== encoded) return invalid;
  if (bytes.includes(0)) return invalid;
  const content = bytes.toString("utf8");
  const replacementCount = content.split("\uFFFD").length - 1;
  if (replacementCount > Math.max(2, content.length * 0.01)) return invalid;
  return { ok: true, content };
}

const encodePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
