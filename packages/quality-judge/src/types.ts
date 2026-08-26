import type { QualityLimitationReason } from "@gitmog/github";

export const QUALITY_JUDGE_RESULT_VERSION = "0.4.0-preview.1";
export const QUALITY_PARSER_CONTRACT_VERSION = "1.0.0-typescript-ast";
export const QUALITY_SOURCE_SELECTION_VERSION = "1.0.0-stratified-public-source";
export const QUALITY_ATTRIBUTION_VERSION = "1.0.0-public-path-commits";
export const QUALITY_DIMENSION_FORMULA_VERSION = "1.0.0-preview-29-point";
export const QUALITY_VALIDATION_CONTRACT_VERSION = "1.0.0-engineering-validation";
export const QUALITY_PRESENTATION_VERSION = "1.1.0-readable-sample-preview";
export const QUALITY_CACHE_VERSION = "1.2.0-typed-limitation-reason";
export const QUALITY_REQUEST_PLAN_VERSION = "1.1.0-typed-limitation-reason";
export const QUALITY_REQUEST_TELEMETRY_VERSION = "1.0.0-current-invocation";

export const QUALITY_DIMENSION_IDS = Object.freeze([
  "correctnessDiscipline",
  "testQuality",
  "maintainability",
  "contractQuality",
  "architecture",
  "securityHygiene",
  "duplicationAndDeadPatterns",
] as const);

export type QualityDimensionId = (typeof QUALITY_DIMENSION_IDS)[number];
export type QualityStatus = "ready" | "partial" | "insufficient";
export type AttributionStatus = "ready" | "partial" | "insufficient" | "not-attributable";
export type QualityLanguage = "typescript" | "javascript";

export interface QualityDimension {
  readonly available: boolean;
  readonly previewScore: number | null;
  readonly previewWeight: number;
  readonly measuredPoints: number | null;
  readonly observations: number;
}

export type QualityDimensions = Readonly<Record<QualityDimensionId, QualityDimension>>;

export interface QualityFinding {
  readonly id: string;
  readonly dimension: QualityDimensionId;
  readonly kind: "strength" | "weakness";
  readonly summary: string;
  readonly receiptIds: readonly string[];
}

export interface QualityReceipt {
  readonly id: string;
  readonly repository: string;
  readonly commitSha: string;
  readonly path: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly language: QualityLanguage;
  readonly parserVersion: string;
  readonly metric: string;
  readonly observed: number;
  readonly applicability: string;
  readonly attributionStatus: AttributionStatus;
  readonly sourceUrl: string;
}

export interface QualityLimitation {
  readonly code:
    | "unsupported-language"
    | "parse-failure"
    | "parser-timeout"
    | "source-budget"
    | "source-unavailable"
    | "attribution-budget"
    | "insufficient-source"
    | "insufficient-attribution";
  readonly detail: string;
  readonly files: number;
}

export interface QualityRequestBudget {
  readonly sourcePlanned: number;
  readonly sourceRequests: number;
  readonly sourceCacheHits: number;
  readonly attributionPlanned: number;
  readonly attributionRequests: number;
  readonly attributionCacheHits: number;
  readonly completeOpportunity: number;
  readonly minimumUsefulOpportunity: number;
  readonly wholeResultCacheHit: boolean;
}

export interface QualityRequestPlan {
  readonly version: string;
  readonly sourcePlanned: number;
  readonly attributionPlanned: number;
  readonly completeOpportunity: number;
  readonly minimumUsefulOpportunity: number;
  readonly sourceRequestCap: number;
  readonly attributionRequestCap: number;
}

export interface QualityRequestTelemetry {
  readonly version: string;
  readonly sourceRequests: number;
  readonly attributionRequests: number;
  readonly sourceCacheHits: number;
  readonly attributionCacheHits: number;
  readonly wholeResultCacheHit: boolean;
}

export interface QualityReading {
  readonly status: QualityStatus;
  readonly previewScore: number | null;
  readonly coverage: number;
  readonly dimensions: QualityDimensions;
  readonly strengths: readonly QualityFinding[];
  readonly weaknesses: readonly QualityFinding[];
  readonly repositories: number;
  readonly files: number;
  readonly sourceBytes: number;
  readonly nonBlankLines: number;
  readonly languages: readonly QualityLanguage[];
}

export interface AttributedQualityReading extends QualityReading {
  readonly attributionStatus: AttributionStatus;
  readonly attributionCoverage: number;
  readonly attributionMethodVersion: string;
}

export interface QualityJudgeResult {
  readonly version: string;
  readonly status: QualityStatus;
  readonly activation: "preview-only";
  readonly scoreInfluence: 0;
  readonly limitationReason: QualityLimitationReason;
  readonly maintainedCodebase: QualityReading;
  readonly attributedCode: AttributedQualityReading;
  readonly requestPlan: QualityRequestPlan;
  readonly requestTelemetry: QualityRequestTelemetry;
  /** Compatibility view. Prefer requestPlan and requestTelemetry for new consumers. */
  readonly requestBudget: QualityRequestBudget;
  readonly limitations: readonly QualityLimitation[];
  readonly receipts: readonly QualityReceipt[];
  readonly resultKey: string;
}

export interface QualityJudgePair {
  readonly left: QualityJudgeResult;
  readonly right: QualityJudgeResult;
}

/** Process-only parser input. Callers must never serialize, cache, log, or persist `source`. */
export interface QualitySourceInput {
  /** Stable collector opportunity order. Synthetic callers may omit it and use immutable identity order. */
  readonly selectionOrder?: number | undefined;
  readonly repository: string;
  readonly commitSha: string;
  readonly blobSha: string;
  readonly path: string;
  readonly sourceUrl: string;
  readonly source: string;
  readonly byteLength: number;
  readonly isTest: boolean;
  readonly attribution: {
    readonly status: "attributed" | "not-attributed" | "not-checked";
    readonly commitSha: string | null;
  };
}

export interface ParsedLocationMetric {
  readonly metric: string;
  readonly observed: number;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly applicability: string;
}

export interface ParsedQualityFeatures {
  readonly language: QualityLanguage;
  readonly parserVersion: string;
  readonly byteLength: number;
  readonly nonBlankLines: number;
  readonly nodeCount: number;
  readonly tokenCount: number;
  readonly importCount: number;
  readonly symbolCount: number;
  readonly functionCount: number;
  readonly highComplexityFunctions: number;
  readonly longFunctions: number;
  readonly maximumComplexity: number;
  readonly maximumNesting: number;
  readonly validationCount: number;
  readonly errorHandlingCount: number;
  readonly swallowedErrors: number;
  readonly assertionCount: number;
  readonly testCaseCount: number;
  readonly failurePathAssertions: number;
  readonly skippedTestCount: number;
  readonly exportedContractCount: number;
  readonly typedContractCount: number;
  readonly unsafeAnyCount: number;
  readonly dynamicEvaluationCount: number;
  readonly unsafeShellCount: number;
  readonly secretLiteralCount: number;
  readonly unreachableStatementCount: number;
  readonly localImports: readonly string[];
  readonly tokenShingles: readonly string[];
  readonly metrics: readonly ParsedLocationMetric[];
}

export type ParseQualityResult =
  | { readonly ok: true; readonly features: ParsedQualityFeatures }
  | {
      readonly ok: false;
      readonly reason:
        | "unsupported-language"
        | "oversized"
        | "malformed-source"
        | "timeout"
        | "node-limit"
        | "depth-limit"
        | "token-limit"
        | "import-limit"
        | "symbol-limit"
        | "cancelled"
        | "isolation-failure";
    };
