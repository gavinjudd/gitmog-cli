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

import { digest, stableStringify } from "@gitmog/github";

import {
  QUALITY_ATTRIBUTION_VERSION,
  QUALITY_CACHE_VERSION,
  QUALITY_DIMENSION_FORMULA_VERSION,
  QUALITY_DIMENSION_IDS,
  QUALITY_JUDGE_RESULT_VERSION,
  QUALITY_PARSER_CONTRACT_VERSION,
  QUALITY_REQUEST_PLAN_VERSION,
  QUALITY_REQUEST_TELEMETRY_VERSION,
  QUALITY_SOURCE_SELECTION_VERSION,
  type QualityJudgeResult,
  type QualityRequestBudget,
  type QualityRequestPlan,
  type QualityRequestTelemetry,
} from "./types.js";

export const DEFAULT_QUALITY_RESULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_RESULT_BYTES = 512 * 1024;
const MAX_CACHE_ENTRIES = 200;
const MAX_STRING = 2_048;
const FORBIDDEN_KEYS = new Set([
  "source",
  "content",
  "rawsource",
  "excerpt",
  "credential",
  "token",
  "authorization",
  "headers",
  "cookie",
  "__proto__",
  "constructor",
  "prototype",
]);

export interface QualityResultCache {
  get(key: string): QualityJudgeResult | undefined;
  set(key: string, value: QualityJudgeResult): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

export interface FileQualityResultCacheOptions {
  readonly directory: string;
  readonly ttlMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly afterWrite?: (() => void) | undefined;
}

export interface QualityResultCacheKeyInput {
  readonly snapshotKey: string;
  readonly login: string;
  readonly immutableRepositories: readonly {
    readonly repository: string;
    readonly treeSha: string | null;
  }[];
  readonly sourceRequestCap: number;
  readonly attributionRequestCap: number;
}

type StableQualityJudgeResult = Omit<QualityJudgeResult, "requestBudget" | "requestTelemetry">;

interface StoredQualityResult {
  readonly expiresAt: number;
  readonly checksum: string;
  readonly value: StableQualityJudgeResult;
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const exactRecord = (
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> => {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};

const boundedString = (value: unknown, maximum = MAX_STRING): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximum &&
  !Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  });

const finite = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;

const integer = (value: unknown, minimum = 0, maximum = 1_000_000): value is number =>
  finite(value, minimum, maximum) && Number.isSafeInteger(value);

const checksum = (value: unknown): string =>
  createHash("sha256").update(stableStringify(value)).digest("hex");

/** Defense in depth: cache values can carry safe receipts, never source-shaped fields. */
export function isQualityCacheSafe(value: unknown): boolean {
  if (Array.isArray(value)) return value.length <= 2_000 && value.every(isQualityCacheSafe);
  if (!isPlainRecord(value)) return value === null || typeof value !== "object";
  return Object.entries(value).every(
    ([key, nested]) => !FORBIDDEN_KEYS.has(key.toLowerCase()) && isQualityCacheSafe(nested),
  );
}

const isDimension = (value: unknown): boolean =>
  exactRecord(value, [
    "available",
    "previewScore",
    "previewWeight",
    "measuredPoints",
    "observations",
  ]) &&
  typeof value.available === "boolean" &&
  (value.previewScore === null || finite(value.previewScore, 0, 100)) &&
  integer(value.previewWeight, 0, 29) &&
  (value.measuredPoints === null || finite(value.measuredPoints, 0, 29)) &&
  integer(value.observations);

const isDimensions = (value: unknown): boolean =>
  exactRecord(value, QUALITY_DIMENSION_IDS) &&
  QUALITY_DIMENSION_IDS.every((id) => isDimension(value[id]));

const isFinding = (value: unknown): boolean =>
  exactRecord(value, ["id", "dimension", "kind", "summary", "receiptIds"]) &&
  boundedString(value.id, 32) &&
  typeof value.dimension === "string" &&
  QUALITY_DIMENSION_IDS.includes(value.dimension as (typeof QUALITY_DIMENSION_IDS)[number]) &&
  (value.kind === "strength" || value.kind === "weakness") &&
  boundedString(value.summary) &&
  Array.isArray(value.receiptIds) &&
  value.receiptIds.length <= 12 &&
  value.receiptIds.every((id) => boundedString(id, 32));

const isReading = (value: unknown, attributed: boolean): boolean => {
  const keys = [
    "status",
    "previewScore",
    "coverage",
    "dimensions",
    "strengths",
    "weaknesses",
    "repositories",
    "files",
    "sourceBytes",
    "nonBlankLines",
    "languages",
    ...(attributed ? ["attributionStatus", "attributionCoverage", "attributionMethodVersion"] : []),
  ];
  if (!exactRecord(value, keys)) return false;
  if (
    !["ready", "partial", "insufficient"].includes(String(value.status)) ||
    (value.previewScore !== null && !finite(value.previewScore, 0, 100)) ||
    !finite(value.coverage, 0, 100) ||
    !isDimensions(value.dimensions) ||
    !Array.isArray(value.strengths) ||
    value.strengths.length > 3 ||
    !value.strengths.every(isFinding) ||
    !Array.isArray(value.weaknesses) ||
    value.weaknesses.length > 3 ||
    !value.weaknesses.every(isFinding) ||
    !integer(value.repositories, 0, 3) ||
    !integer(value.files, 0, 18) ||
    !integer(value.sourceBytes, 0, 300 * 1024) ||
    !integer(value.nonBlankLines) ||
    !Array.isArray(value.languages) ||
    value.languages.length > 2 ||
    !value.languages.every((language) => language === "typescript" || language === "javascript")
  ) {
    return false;
  }
  return (
    !attributed ||
    (["ready", "partial", "insufficient", "not-attributable"].includes(
      String(value.attributionStatus),
    ) &&
      finite(value.attributionCoverage, 0, 100) &&
      value.attributionMethodVersion === QUALITY_ATTRIBUTION_VERSION)
  );
};

const isRequestBudget = (value: unknown): boolean =>
  exactRecord(value, [
    "sourcePlanned",
    "sourceRequests",
    "sourceCacheHits",
    "attributionPlanned",
    "attributionRequests",
    "attributionCacheHits",
    "completeOpportunity",
    "minimumUsefulOpportunity",
    "wholeResultCacheHit",
  ]) &&
  Object.entries(value).every(([key, entry]) =>
    key === "wholeResultCacheHit" ? typeof entry === "boolean" : integer(entry, 0, 100),
  );

const isRequestPlan = (value: unknown): boolean =>
  exactRecord(value, [
    "version",
    "sourcePlanned",
    "attributionPlanned",
    "completeOpportunity",
    "minimumUsefulOpportunity",
    "sourceRequestCap",
    "attributionRequestCap",
  ]) &&
  value.version === QUALITY_REQUEST_PLAN_VERSION &&
  Object.entries(value).every(([key, entry]) =>
    key === "version" ? typeof entry === "string" : integer(entry, 0, 100),
  );

const isRequestTelemetry = (value: unknown): boolean =>
  exactRecord(value, [
    "version",
    "sourceRequests",
    "attributionRequests",
    "sourceCacheHits",
    "attributionCacheHits",
    "wholeResultCacheHit",
  ]) &&
  value.version === QUALITY_REQUEST_TELEMETRY_VERSION &&
  Object.entries(value).every(([key, entry]) =>
    key === "version"
      ? typeof entry === "string"
      : key === "wholeResultCacheHit"
        ? typeof entry === "boolean"
        : integer(entry, 0, 100),
  );

const isReceipt = (value: unknown): boolean =>
  exactRecord(value, [
    "id",
    "repository",
    "commitSha",
    "path",
    "lineStart",
    "lineEnd",
    "language",
    "parserVersion",
    "metric",
    "observed",
    "applicability",
    "attributionStatus",
    "sourceUrl",
  ]) &&
  boundedString(value.id, 32) &&
  boundedString(value.repository, 256) &&
  typeof value.commitSha === "string" &&
  /^[0-9a-f]{40}$/u.test(value.commitSha) &&
  boundedString(value.path, 1_024) &&
  integer(value.lineStart, 1) &&
  integer(value.lineEnd, 1) &&
  value.lineEnd >= value.lineStart &&
  (value.language === "typescript" || value.language === "javascript") &&
  boundedString(value.parserVersion, 128) &&
  boundedString(value.metric, 128) &&
  finite(value.observed, -1_000_000, 1_000_000) &&
  boundedString(value.applicability) &&
  ["ready", "partial", "insufficient", "not-attributable"].includes(
    String(value.attributionStatus),
  ) &&
  boundedString(value.sourceUrl, 2_048) &&
  value.sourceUrl.startsWith("https://github.com/");

const isLimitation = (value: unknown): boolean =>
  exactRecord(value, ["code", "detail", "files"]) &&
  [
    "unsupported-language",
    "parse-failure",
    "parser-timeout",
    "source-budget",
    "source-unavailable",
    "attribution-budget",
    "insufficient-source",
    "insufficient-attribution",
  ].includes(String(value.code)) &&
  boundedString(value.detail) &&
  integer(value.files, 0, 18);

const stableQualityResultValidationCode = (value: unknown): string | null => {
  if (!isQualityCacheSafe(value)) return "unsafe-shape";
  if (
    !exactRecord(value, [
      "version",
      "status",
      "activation",
      "scoreInfluence",
      "limitationReason",
      "maintainedCodebase",
      "attributedCode",
      "requestPlan",
      "limitations",
      "receipts",
      "resultKey",
    ])
  )
    return "result-shape";
  if (value.version !== QUALITY_JUDGE_RESULT_VERSION) return "result-version";
  if (!["ready", "partial", "insufficient"].includes(String(value.status))) return "status";
  if (value.activation !== "preview-only" || value.scoreInfluence !== 0) return "activation";
  if (
    ![
      "request-budget-limited",
      "supported-language-limited",
      "eligible-source-limited",
      "attribution-limited",
      "mixed",
      "unknown",
    ].includes(String(value.limitationReason))
  )
    return "limitation-reason";
  if (!isReading(value.maintainedCodebase, false)) return "maintained-reading";
  if (!isReading(value.attributedCode, true)) return "attributed-reading";
  if (!isRequestPlan(value.requestPlan)) return "request-plan";
  if (
    !Array.isArray(value.limitations) ||
    value.limitations.length > 100 ||
    !value.limitations.every(isLimitation)
  )
    return "limitations";
  if (
    !Array.isArray(value.receipts) ||
    value.receipts.length > 72 ||
    !value.receipts.every(isReceipt)
  )
    return "receipts";
  if (
    typeof value.resultKey !== "string" ||
    !/^(?:[0-9a-f]{32}|[0-9a-f]{64})$/u.test(value.resultKey)
  )
    return "result-key";
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_CACHE_RESULT_BYTES)
    return "result-size";
  return null;
};

export const isStableQualityJudgeResult = (value: unknown): boolean =>
  stableQualityResultValidationCode(value) === null;

const stableResultFor = (value: QualityJudgeResult): StableQualityJudgeResult => ({
  version: value.version,
  status: value.status,
  activation: value.activation,
  scoreInfluence: value.scoreInfluence,
  limitationReason: value.limitationReason,
  maintainedCodebase: value.maintainedCodebase,
  attributedCode: value.attributedCode,
  requestPlan: value.requestPlan,
  limitations: value.limitations,
  receipts: value.receipts,
  resultKey: value.resultKey,
});

const withRequestTelemetry = (
  value: StableQualityJudgeResult,
  telemetry: QualityRequestTelemetry,
): QualityJudgeResult => ({
  version: value.version,
  status: value.status,
  activation: value.activation,
  scoreInfluence: value.scoreInfluence,
  limitationReason: value.limitationReason,
  maintainedCodebase: value.maintainedCodebase,
  attributedCode: value.attributedCode,
  requestPlan: value.requestPlan,
  requestTelemetry: telemetry,
  requestBudget: {
    sourcePlanned: value.requestPlan.sourcePlanned,
    sourceRequests: telemetry.sourceRequests,
    sourceCacheHits: telemetry.sourceCacheHits,
    attributionPlanned: value.requestPlan.attributionPlanned,
    attributionRequests: telemetry.attributionRequests,
    attributionCacheHits: telemetry.attributionCacheHits,
    completeOpportunity: value.requestPlan.completeOpportunity,
    minimumUsefulOpportunity: value.requestPlan.minimumUsefulOpportunity,
    wholeResultCacheHit: telemetry.wholeResultCacheHit,
  },
  limitations: value.limitations,
  receipts: value.receipts,
  resultKey: value.resultKey,
});

export function qualityResultValidationCode(value: unknown): string | null {
  if (!isQualityCacheSafe(value)) return "unsafe-shape";
  if (
    !exactRecord(value, [
      "version",
      "status",
      "activation",
      "scoreInfluence",
      "limitationReason",
      "maintainedCodebase",
      "attributedCode",
      "requestPlan",
      "requestTelemetry",
      "requestBudget",
      "limitations",
      "receipts",
      "resultKey",
    ])
  ) {
    return "result-shape";
  }
  const { requestTelemetry, requestBudget, ...stable } = value;
  const stableCode = stableQualityResultValidationCode(stable);
  if (stableCode !== null) return stableCode;
  if (!isRequestTelemetry(requestTelemetry)) return "request-telemetry";
  if (!isRequestBudget(requestBudget)) return "request-budget";
  const plan = stable.requestPlan as QualityRequestPlan;
  const telemetry = requestTelemetry as QualityRequestTelemetry;
  const budget = requestBudget as QualityRequestBudget;
  if (
    budget.sourcePlanned !== plan.sourcePlanned ||
    budget.attributionPlanned !== plan.attributionPlanned ||
    budget.completeOpportunity !== plan.completeOpportunity ||
    budget.minimumUsefulOpportunity !== plan.minimumUsefulOpportunity ||
    budget.sourceRequests !== telemetry.sourceRequests ||
    budget.sourceCacheHits !== telemetry.sourceCacheHits ||
    budget.attributionRequests !== telemetry.attributionRequests ||
    budget.attributionCacheHits !== telemetry.attributionCacheHits ||
    budget.wholeResultCacheHit !== telemetry.wholeResultCacheHit
  ) {
    return "request-accounting";
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_CACHE_RESULT_BYTES) {
    return "result-size";
  }
  return null;
}

export function isQualityJudgeResult(value: unknown): value is QualityJudgeResult {
  return qualityResultValidationCode(value) === null;
}

export function qualityResultCacheKey(input: QualityResultCacheKeyInput): string {
  return digest({
    cacheVersion: QUALITY_CACHE_VERSION,
    parserVersion: QUALITY_PARSER_CONTRACT_VERSION,
    formulaVersion: QUALITY_DIMENSION_FORMULA_VERSION,
    sampleVersion: QUALITY_SOURCE_SELECTION_VERSION,
    attributionVersion: QUALITY_ATTRIBUTION_VERSION,
    resultVersion: QUALITY_JUDGE_RESULT_VERSION,
    snapshotKey: input.snapshotKey,
    login: input.login.toLowerCase(),
    immutableRepositories: input.immutableRepositories.map((repository) => ({
      repository: repository.repository.normalize("NFC"),
      treeSha: repository.treeSha,
    })),
    sourceRequestCap: input.sourceRequestCap,
    attributionRequestCap: input.attributionRequestCap,
  });
}

export function createFileQualityResultCache(
  options: FileQualityResultCacheOptions,
): QualityResultCache {
  const now = options.now ?? Date.now;
  const pathFor = (key: string): string => join(options.directory, `${checksum(key)}.quality.json`);
  const files = (): readonly string[] => {
    try {
      return readdirSync(options.directory)
        .filter((name) => /^[0-9a-f]{64}\.quality\.json$/u.test(name))
        .sort((left, right) => left.localeCompare(right));
    } catch {
      return [];
    }
  };
  const get = (key: string): QualityJudgeResult | undefined => {
    const path = pathFor(key);
    if (!existsSync(path)) return undefined;
    try {
      const stored: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (
        !exactRecord(stored, ["expiresAt", "checksum", "value"]) ||
        !integer(stored.expiresAt, 0, Number.MAX_SAFE_INTEGER) ||
        stored.expiresAt <= now() ||
        typeof stored.checksum !== "string" ||
        !/^[0-9a-f]{64}$/u.test(stored.checksum) ||
        stored.checksum !== checksum(stored.value) ||
        stableQualityResultValidationCode(stored.value) !== null
      ) {
        rmSync(path, { force: true });
        return undefined;
      }
      try {
        const accessed = new Date(now());
        utimesSync(path, accessed, accessed);
      } catch {
        // Recency is operational only and never changes the cached result.
      }
      return withRequestTelemetry(stored.value as StableQualityJudgeResult, {
        version: QUALITY_REQUEST_TELEMETRY_VERSION,
        sourceRequests: 0,
        attributionRequests: 0,
        sourceCacheHits: 0,
        attributionCacheHits: 0,
        wholeResultCacheHit: true,
      });
    } catch {
      rmSync(path, { force: true });
      return undefined;
    }
  };
  const set = (key: string, value: QualityJudgeResult): void => {
    if (!isQualityJudgeResult(value)) return;
    const stableValue = stableResultFor(value);
    const path = pathFor(key);
    const temporary = `${path}.tmp`;
    try {
      mkdirSync(options.directory, { recursive: true });
      const stored: StoredQualityResult = {
        expiresAt: now() + (options.ttlMs ?? DEFAULT_QUALITY_RESULT_TTL_MS),
        checksum: checksum(stableValue),
        value: stableValue,
      };
      writeFileSync(temporary, JSON.stringify(stored), "utf8");
      renameSync(temporary, path);
      options.afterWrite?.();
      for (const name of files().slice(0, Math.max(0, files().length - MAX_CACHE_ENTRIES))) {
        rmSync(join(options.directory, name), { force: true });
      }
    } catch {
      rmSync(temporary, { force: true });
    }
  };
  return {
    get,
    set,
    delete(key) {
      rmSync(pathFor(key), { force: true });
    },
    clear() {
      for (const name of files()) rmSync(join(options.directory, name), { force: true });
    },
    get size() {
      return files().length;
    },
  };
}
