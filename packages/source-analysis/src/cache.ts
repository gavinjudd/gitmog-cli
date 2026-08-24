import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  CODE_DNA_SAMPLE_VERSION,
  SOURCE_SAMPLE_FAILURE_REASONS,
  stableStringify,
  type CodeSampleReceipt,
  type DerivedFeatureCache,
  type DerivedFeatureCacheEntry,
  type DerivedFeatureCacheKey,
  type SnapshotCache,
  type SourceSampleFailureReason,
} from "@gitmog/github";
import {
  CODE_AXIS_ENGINE_VERSION,
  CODE_AXIS_IDS,
  CODE_DNA_IDS,
  CODE_DNA_VERSION,
  CODE_SIGNAL_CODES,
  type AxisContribution,
  type AxisCoverage,
  type CodeAxisId,
  type CodeAxisReading,
  type CodeDnaCandidate,
  type CodeDnaLabel,
  type CodeDnaOutcome,
  type SourceStyleFeatureReading,
} from "@gitmog/personality";
import type { SourceFeatures, SupportedFeatureLanguage } from "@gitmog/analyzers";

export const DEFAULT_DERIVED_FEATURE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_CODE_DNA_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STRING = 2_048;
const MAX_ID = 256;
const MAX_COUNT = 1_000_000;
type CacheableCodeDna = Extract<CodeDnaOutcome, { status: "ready" | "partial" }> & {
  readonly cacheDisposition: "stable";
};

export interface FileAnalysisCacheOptions {
  readonly directory: string;
  readonly ttlMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly afterWrite?: (() => void) | undefined;
}

interface Stored<T> {
  readonly expiresAt: number;
  readonly checksum: string;
  readonly value: T;
}

const hash = (value: unknown): string =>
  createHash("sha256").update(stableStringify(value)).digest("hex");

export const derivedFeatureKey = (key: DerivedFeatureCacheKey): string => hash(key);

const FORBIDDEN_KEYS = new Set([
  "source",
  "content",
  "rawsource",
  "excerpt",
  "credential",
  "token",
  "prompt",
  "messages",
  "reasoning",
  "hiddenreasoning",
  "authorization",
  "headers",
  "cookie",
  "__proto__",
  "constructor",
  "prototype",
]);

/** Defense in depth. Exact parsers below remain the authority. */
export function isDerivedCacheSafe(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(isDerivedCacheSafe);
  if (typeof value !== "object" || value === null) return true;
  return Object.entries(value as Record<string, unknown>).every(
    ([key, nested]) => !FORBIDDEN_KEYS.has(key.toLowerCase()) && isDerivedCacheSafe(nested),
  );
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const exactRecord = (
  value: unknown,
  allowed: readonly string[],
): value is Record<string, unknown> => {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...allowed].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};

const finite = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;

const integer = (value: unknown, minimum = 0, maximum = MAX_COUNT): value is number =>
  finite(value, minimum, maximum) && Number.isInteger(value);

const boundedString = (value: unknown, maximum = MAX_STRING, allowEmpty = false): value is string =>
  typeof value === "string" &&
  value.length <= maximum &&
  (allowEmpty || value.length > 0) &&
  !Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  });

const stringArray = (
  value: unknown,
  maximumItems: number,
  maximumString = MAX_ID,
): value is readonly string[] =>
  Array.isArray(value) &&
  value.length <= maximumItems &&
  value.every((entry) => boundedString(entry, maximumString)) &&
  new Set(value).size === value.length;

const enumValue = <T extends string>(value: unknown, allowed: ReadonlySet<T>): value is T =>
  typeof value === "string" && allowed.has(value as T);

const FEATURE_LANGUAGES = new Set<SupportedFeatureLanguage>([
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "java",
  "csharp",
  "ruby",
  "php",
  "swift",
  "kotlin",
  "c",
  "cpp",
  "unknown",
]);
const FEATURE_IDS = new Set(CODE_SIGNAL_CODES);
const AXIS_IDS = new Set(CODE_AXIS_IDS);
const DNA_IDS = new Set(CODE_DNA_IDS);
const SOURCE_FAILURE_REASONS = new Set<SourceSampleFailureReason>(SOURCE_SAMPLE_FAILURE_REASONS);
const STABLE_SOURCE_FAILURES = new Set<SourceSampleFailureReason>([
  "no-source-candidate",
  "request-budget-exhausted",
  "oversized",
  "non-text",
  "redaction-threshold",
  "unsupported-language",
]);

const FEATURE_KEYS = [
  "language",
  "languageSupported",
  "totalLines",
  "nonBlankLines",
  "commentLines",
  "commentRatio",
  "averageLineLength",
  "maximumLineLength",
  "importCount",
  "functionCount",
  "classOrTypeCount",
  "typeAnnotationCount",
  "validationMarkers",
  "guardMarkers",
  "errorHandlingMarkers",
  "asyncMarkers",
  "maximumNestingDepth",
  "genericMarkers",
  "factoryMarkers",
  "protocolMarkers",
  "dataLibraryMarkers",
  "algorithmMarkers",
  "testMarkers",
  "configurationLines",
  "configurationRatio",
] as const;

const COUNT_FEATURE_KEYS = FEATURE_KEYS.filter(
  (key) =>
    ![
      "language",
      "languageSupported",
      "commentRatio",
      "configurationRatio",
      "averageLineLength",
    ].includes(key),
);

const isSourceFeatures = (value: unknown): value is SourceFeatures => {
  if (!exactRecord(value, FEATURE_KEYS)) return false;
  return (
    enumValue(value.language, FEATURE_LANGUAGES) &&
    typeof value.languageSupported === "boolean" &&
    finite(value.commentRatio, 0, 1) &&
    finite(value.configurationRatio, 0, 1) &&
    integer(value.averageLineLength, 0, 100_000) &&
    COUNT_FEATURE_KEYS.every((key) => integer(value[key], 0, MAX_COUNT))
  );
};

const DERIVED_KEY_KEYS = [
  "repositoryId",
  "repository",
  "commitSha",
  "blobSha",
  "normalizedPath",
  "language",
  "byteLimit",
  "analyzerVersion",
  "sourceFeatureVersion",
  "redactionVersion",
] as const;

const isDerivedFeatureCacheKey = (value: unknown): value is DerivedFeatureCacheKey =>
  exactRecord(value, DERIVED_KEY_KEYS) &&
  integer(value.repositoryId, 1, Number.MAX_SAFE_INTEGER) &&
  boundedString(value.repository, MAX_ID) &&
  boundedString(value.commitSha, MAX_ID) &&
  boundedString(value.blobSha, MAX_ID) &&
  boundedString(value.normalizedPath, 1_024) &&
  !value.normalizedPath.includes("\\") &&
  !value.normalizedPath.split("/").some((segment) => segment === "..") &&
  enumValue(value.language, FEATURE_LANGUAGES) &&
  integer(value.byteLimit, 1, 24_000) &&
  boundedString(value.analyzerVersion, 256) &&
  boundedString(value.sourceFeatureVersion, 256) &&
  boundedString(value.redactionVersion, 256);

const DERIVED_ENTRY_KEYS = [
  "key",
  "features",
  "coverage",
  "redactionCount",
  "byteLength",
  "truncated",
  "commentLinesRemoved",
  "stringsShortened",
] as const;

/** Exact, fail-closed parser for one persisted path-specific derived feature vector. */
export function isDerivedFeatureEntry(value: unknown): value is DerivedFeatureCacheEntry {
  if (!isDerivedCacheSafe(value) || !exactRecord(value, DERIVED_ENTRY_KEYS)) return false;
  return (
    isDerivedFeatureCacheKey(value.key) &&
    isSourceFeatures(value.features) &&
    exactRecord(value.coverage, ["languageSupported", "nonBlankLines"]) &&
    typeof value.coverage.languageSupported === "boolean" &&
    integer(value.coverage.nonBlankLines) &&
    value.coverage.languageSupported === value.features.languageSupported &&
    value.coverage.nonBlankLines === value.features.nonBlankLines &&
    integer(value.redactionCount, 0, 10_000) &&
    integer(value.byteLength, 0, 24_000) &&
    typeof value.truncated === "boolean" &&
    integer(value.commentLinesRemoved) &&
    integer(value.stringsShortened)
  );
}

const RECEIPT_KEYS = [
  "sampleId",
  "repository",
  "repositoryUrl",
  "primaryLanguage",
  "pushedAt",
  "treeSha",
  "path",
  "blobSha",
  "sourceUrl",
  "byteLength",
  "truncated",
  "isTest",
  "redactions",
  "commentLinesRemoved",
  "stringsShortened",
  "selectionScore",
] as const;

const isReceipt = (value: unknown): value is CodeSampleReceipt =>
  exactRecord(value, RECEIPT_KEYS) &&
  typeof value.sampleId === "string" &&
  /^s[0-9a-f]{32}$/.test(value.sampleId) &&
  boundedString(value.repository, MAX_ID) &&
  boundedString(value.repositoryUrl, MAX_STRING) &&
  value.repositoryUrl.startsWith("https://") &&
  (value.primaryLanguage === null || boundedString(value.primaryLanguage, 64)) &&
  boundedString(value.pushedAt, 64) &&
  boundedString(value.treeSha, MAX_ID) &&
  boundedString(value.path, 1_024) &&
  boundedString(value.blobSha, MAX_ID) &&
  boundedString(value.sourceUrl, MAX_STRING) &&
  value.sourceUrl.startsWith("https://") &&
  integer(value.byteLength, 0, 24_000) &&
  typeof value.truncated === "boolean" &&
  typeof value.isTest === "boolean" &&
  integer(value.redactions, 0, 10_000) &&
  integer(value.commentLinesRemoved) &&
  integer(value.stringsShortened) &&
  finite(value.selectionScore, -100, 100);

const isCoverage = (value: unknown): value is AxisCoverage =>
  exactRecord(value, [
    "sampleCount",
    "repositoryCount",
    "supportedSampleCount",
    "supportedShare",
    "totalNonBlankLines",
    "supportedLanguages",
    "unsupportedLanguages",
  ]) &&
  integer(value.sampleCount, 0, 4) &&
  integer(value.repositoryCount, 0, 3) &&
  integer(value.supportedSampleCount, 0, 4) &&
  finite(value.supportedShare, 0, 1) &&
  integer(value.totalNonBlankLines, 0, MAX_COUNT) &&
  stringArray(value.supportedLanguages, 32, 64) &&
  stringArray(value.unsupportedLanguages, 32, 64);

const isContribution = (value: unknown): value is AxisContribution =>
  exactRecord(value, [
    "id",
    "family",
    "value",
    "weight",
    "contribution",
    "explanation",
    "direction",
    "sampleIds",
  ]) &&
  enumValue(value.id, FEATURE_IDS) &&
  enumValue(value.family, AXIS_IDS) &&
  finite(value.value, 0, 1) &&
  finite(value.weight, 0, 100) &&
  finite(value.contribution, 0, 100) &&
  boundedString(value.explanation, 512) &&
  (value.direction === "first-pole" || value.direction === "second-pole") &&
  stringArray(value.sampleIds, 8);

const isAxis = (value: unknown, expectedId: CodeAxisId): value is CodeAxisReading =>
  exactRecord(value, [
    "id",
    "score",
    "confidence",
    "direction",
    "sampleIds",
    "signalCodes",
    "featureIds",
    "contributions",
    "coverage",
    "limitations",
    "axisEngineVersion",
  ]) &&
  value.id === expectedId &&
  finite(value.score, 0, 100) &&
  finite(value.confidence, 0, 100) &&
  ["first-pole", "neutral", "second-pole"].includes(String(value.direction)) &&
  stringArray(value.sampleIds, 8) &&
  Array.isArray(value.signalCodes) &&
  value.signalCodes.length <= CODE_SIGNAL_CODES.length &&
  value.signalCodes.every((entry) => enumValue(entry, FEATURE_IDS)) &&
  Array.isArray(value.featureIds) &&
  value.featureIds.length <= CODE_SIGNAL_CODES.length &&
  value.featureIds.every((entry) => enumValue(entry, FEATURE_IDS)) &&
  Array.isArray(value.contributions) &&
  value.contributions.length <= CODE_SIGNAL_CODES.length &&
  value.contributions.every(isContribution) &&
  isCoverage(value.coverage) &&
  stringArray(value.limitations, 32, 512) &&
  value.axisEngineVersion === CODE_AXIS_ENGINE_VERSION;

const isAxes = (value: unknown): boolean =>
  exactRecord(value, CODE_AXIS_IDS) && CODE_AXIS_IDS.every((id) => isAxis(value[id], id));

const isLabel = (value: unknown): value is CodeDnaLabel =>
  exactRecord(value, [
    "id",
    "name",
    "copy",
    "confidence",
    "featureIds",
    "sampleIds",
    "axisEngineVersion",
  ]) &&
  enumValue(value.id, DNA_IDS) &&
  boundedString(value.name, 128) &&
  exactRecord(value.copy, ["clean", "spicy", "unhinged"]) &&
  boundedString(value.copy.clean, 512) &&
  boundedString(value.copy.spicy, 512) &&
  boundedString(value.copy.unhinged, 512) &&
  finite(value.confidence, 0, 100) &&
  Array.isArray(value.featureIds) &&
  value.featureIds.length <= CODE_SIGNAL_CODES.length &&
  value.featureIds.every((entry) => enumValue(entry, FEATURE_IDS)) &&
  stringArray(value.sampleIds, 8) &&
  value.axisEngineVersion === CODE_AXIS_ENGINE_VERSION;

const isCandidate = (value: unknown): value is CodeDnaCandidate =>
  exactRecord(value, ["id", "distance", "eligible", "rejection", "featureIds", "sampleIds"]) &&
  enumValue(value.id, DNA_IDS) &&
  finite(value.distance, 0, 2) &&
  typeof value.eligible === "boolean" &&
  (value.rejection === null || boundedString(value.rejection, 512)) &&
  Array.isArray(value.featureIds) &&
  value.featureIds.length <= CODE_SIGNAL_CODES.length &&
  value.featureIds.every((entry) => enumValue(entry, FEATURE_IDS)) &&
  stringArray(value.sampleIds, 8);

const isFeatureReading = (value: unknown): value is SourceStyleFeatureReading =>
  exactRecord(value, ["id", "strength", "sampleIds"]) &&
  enumValue(value.id, FEATURE_IDS) &&
  finite(value.strength, 0, 1) &&
  stringArray(value.sampleIds, 8);

const COMMON_DNA_KEYS = [
  "status",
  "version",
  "sampleVersion",
  "axisEngineVersion",
  "sampleKey",
  "axes",
  "labelCandidates",
  "confidence",
  "sourceConfidence",
  "featureIds",
  "featureContributions",
  "samples",
  "repositoriesRepresented",
  "limitations",
  "cacheDisposition",
  "sourceFailureReasons",
] as const;

/** Exact, fail-closed parser for persisted ready/partial Code DNA outcomes. */
export function isCodeDnaCacheEntry(value: unknown): value is CacheableCodeDna {
  if (!isDerivedCacheSafe(value) || !isPlainRecord(value)) return false;
  const expected =
    value.status === "ready"
      ? [...COMMON_DNA_KEYS, "label"]
      : value.status === "partial"
        ? [...COMMON_DNA_KEYS, "reason", ...(Object.hasOwn(value, "label") ? ["label"] : [])]
        : null;
  if (expected === null || !exactRecord(value, expected)) return false;
  const structurallyValid =
    value.version === CODE_DNA_VERSION &&
    value.sampleVersion === CODE_DNA_SAMPLE_VERSION &&
    value.axisEngineVersion === CODE_AXIS_ENGINE_VERSION &&
    boundedString(value.sampleKey, MAX_ID) &&
    isAxes(value.axes) &&
    Array.isArray(value.labelCandidates) &&
    value.labelCandidates.length <= 32 &&
    value.labelCandidates.every(isCandidate) &&
    finite(value.confidence, 0, 100) &&
    finite(value.sourceConfidence, 0, 100) &&
    Array.isArray(value.featureIds) &&
    value.featureIds.length <= CODE_SIGNAL_CODES.length &&
    value.featureIds.every((entry) => enumValue(entry, FEATURE_IDS)) &&
    Array.isArray(value.featureContributions) &&
    value.featureContributions.length <= CODE_SIGNAL_CODES.length &&
    value.featureContributions.every(isFeatureReading) &&
    Array.isArray(value.samples) &&
    value.samples.length <= 4 &&
    value.samples.every(isReceipt) &&
    integer(value.repositoriesRepresented, 0, 3) &&
    stringArray(value.limitations, 64, 512) &&
    value.cacheDisposition === "stable" &&
    Array.isArray(value.sourceFailureReasons) &&
    value.sourceFailureReasons.length <= SOURCE_SAMPLE_FAILURE_REASONS.length &&
    value.sourceFailureReasons.every((entry) => enumValue(entry, SOURCE_FAILURE_REASONS)) &&
    value.sourceFailureReasons.every((entry) => STABLE_SOURCE_FAILURES.has(entry)) &&
    (value.status === "ready"
      ? isLabel(value.label)
      : boundedString(value.reason, 512) &&
        (!Object.hasOwn(value, "label") || isLabel(value.label)));
  if (!structurallyValid) return false;

  const parsed = value as unknown as CacheableCodeDna;
  const knownSampleIds = new Set(parsed.samples.map((sample) => sample.sampleId));
  if (knownSampleIds.size !== parsed.samples.length) return false;
  const referencesKnownSamples = (ids: readonly string[]): boolean =>
    ids.every((id) => knownSampleIds.has(id));
  const axesReferenceKnownSamples = CODE_AXIS_IDS.every((axis) => {
    const reading = parsed.axes[axis];
    return (
      referencesKnownSamples(reading.sampleIds) &&
      reading.contributions.every((entry) => referencesKnownSamples(entry.sampleIds))
    );
  });
  const labelReferencesKnownSamples =
    !Object.hasOwn(parsed, "label") || referencesKnownSamples(parsed.label?.sampleIds ?? []);
  return (
    axesReferenceKnownSamples &&
    labelReferencesKnownSamples &&
    parsed.labelCandidates.every((entry) => referencesKnownSamples(entry.sampleIds)) &&
    parsed.featureContributions.every((entry) => referencesKnownSamples(entry.sampleIds)) &&
    parsed.repositoriesRepresented ===
      new Set(parsed.samples.map((sample) => sample.repository)).size
  );
}

const STORED_KEYS = ["expiresAt", "checksum", "value"] as const;

function createFileCache<T>(
  options: FileAnalysisCacheOptions,
  suffix: string,
  ttl: number,
  validate: (value: unknown) => value is T,
) {
  const now = options.now ?? Date.now;
  const pathFor = (key: string): string => join(options.directory, `${hash(key)}${suffix}`);
  const files = (): readonly string[] => {
    try {
      return readdirSync(options.directory)
        .filter((name) => name.endsWith(suffix))
        .sort((left, right) => left.localeCompare(right));
    } catch {
      return [];
    }
  };
  const get = (key: string): T | undefined => {
    const path = pathFor(key);
    if (!existsSync(path)) return undefined;
    try {
      const stored: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (
        !exactRecord(stored, STORED_KEYS) ||
        !finite(stored.expiresAt, 0, Number.MAX_SAFE_INTEGER) ||
        !boundedString(stored.checksum, 128) ||
        stored.expiresAt <= now() ||
        stored.checksum !== hash(stored.value) ||
        !isDerivedCacheSafe(stored.value) ||
        !validate(stored.value)
      ) {
        rmSync(path, { force: true });
        return undefined;
      }
      try {
        const accessedAt = new Date(now());
        utimesSync(path, accessedAt, accessedAt);
      } catch {
        // Recency is best effort and never changes the cached evidence.
      }
      return stored.value;
    } catch {
      rmSync(path, { force: true });
      return undefined;
    }
  };
  const set = (key: string, value: T): void => {
    if (!isDerivedCacheSafe(value) || !validate(value)) return;
    const path = pathFor(key);
    const temporary = `${path}.tmp`;
    try {
      mkdirSync(options.directory, { recursive: true });
      const stored: Stored<T> = {
        expiresAt: now() + (options.ttlMs ?? ttl),
        checksum: hash(value),
        value,
      };
      writeFileSync(temporary, JSON.stringify(stored), "utf8");
      renameSync(temporary, path);
      options.afterWrite?.();
    } catch {
      rmSync(temporary, { force: true });
      /* Cache failure only costs a later recomputation. */
    }
  };
  return { get, set, files, pathFor };
}

export function createFileDerivedFeatureCache(
  options: FileAnalysisCacheOptions,
): DerivedFeatureCache {
  const cache = createFileCache<DerivedFeatureCacheEntry>(
    options,
    ".features.json",
    DEFAULT_DERIVED_FEATURE_TTL_MS,
    isDerivedFeatureEntry,
  );
  return {
    get(key) {
      if (!isDerivedFeatureCacheKey(key)) return undefined;
      const value = cache.get(derivedFeatureKey(key));
      return value !== undefined && stableStringify(value.key) === stableStringify(key)
        ? value
        : undefined;
    },
    set(key, value) {
      if (
        isDerivedFeatureCacheKey(key) &&
        isDerivedFeatureEntry(value) &&
        stableStringify(value.key) === stableStringify(key)
      ) {
        cache.set(derivedFeatureKey(key), value);
      }
    },
  };
}

export function createFileCodeDnaCache(
  options: FileAnalysisCacheOptions,
): SnapshotCache<CacheableCodeDna> {
  const cache = createFileCache<CacheableCodeDna>(
    options,
    ".dna.json",
    DEFAULT_CODE_DNA_TTL_MS,
    isCodeDnaCacheEntry,
  );
  return {
    get: cache.get,
    set: cache.set,
    delete(key) {
      rmSync(cache.pathFor(key), { force: true });
    },
    clear() {
      for (const name of cache.files()) rmSync(join(options.directory, name), { force: true });
    },
    get size() {
      return cache.files().length;
    },
  };
}
