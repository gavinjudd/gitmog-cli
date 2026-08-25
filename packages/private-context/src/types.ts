import type { QualityDimensions, QualityLanguage, QualityStatus } from "@gitmog/quality-judge";

export const PRIVATE_CONTEXT_RESULT_VERSION = "1.1.0-selected-sample-presentation";
export const PRIVATE_CONTEXT_REQUEST_VERSION = "1.0.0-bounded-private-rest";
export const PRIVATE_CONTEXT_MAX_REPOSITORIES = 5;
export const PRIVATE_CONTEXT_MAX_REQUESTS = 64;
export const PRIVATE_CONTEXT_MAX_REQUESTS_PER_REPOSITORY = 12;

export interface PrivateContextAppConfig {
  readonly version: "1.0.0";
  readonly name: "Git Mog Private Context" | "Git Mog Private Context CLI";
  readonly slug: string;
  readonly appId: string;
  readonly clientId: string;
  readonly deviceFlow: true;
  readonly permissions: {
    readonly metadata: "read";
    readonly contents: "read";
  };
  readonly installationSelectionRequired: "selected";
  readonly privateKeys: 0;
  readonly clientSecrets: 0;
}

export type PrivateContextStatus = "ready" | "partial" | "insufficient" | "unavailable";
export type PrivateRepositoryRelationship =
  | "maintained-and-attributed"
  | "maintained-only"
  | "attributed-only"
  | "insufficient"
  | "unavailable";

export interface PrivateQualityReading {
  readonly status: QualityStatus;
  readonly previewScore: number | null;
  readonly scope: "selected-sample";
  readonly classification: "informational";
  readonly scoreInfluence: 0;
  readonly publicWinnerInfluence: 0;
  readonly persisted: false;
  readonly coverage: number;
  readonly dimensions: QualityDimensions;
  readonly repositories: number;
  readonly files: number;
  readonly sourceBytes: number;
  readonly nonBlankLines: number;
  readonly languages: readonly QualityLanguage[];
}

export interface PrivateContextLimitation {
  readonly code:
    | "repository-limit"
    | "request-budget"
    | "repository-request-budget"
    | "source-unavailable"
    | "supported-language"
    | "attribution"
    | "parser"
    | "insufficient";
  readonly detail: string;
  readonly count: number;
}

export interface PrivateAggregateReceipt {
  readonly id: `P${number}`;
  readonly claim: string;
  readonly metric:
    | "ci-repositories"
    | "sustained-repositories"
    | "quality-coverage"
    | "attributed-files"
    | "test-assertions";
  readonly observed: number;
  readonly total: number;
}

export interface PrivateRequestTelemetry {
  readonly version: typeof PRIVATE_CONTEXT_REQUEST_VERSION;
  readonly requests: number;
  readonly requestCap: typeof PRIVATE_CONTEXT_MAX_REQUESTS;
  readonly requestCapPerRepository: typeof PRIVATE_CONTEXT_MAX_REQUESTS_PER_REPOSITORY;
  readonly identityRequests: number;
  readonly installationRequests: number;
  readonly repositoryListRequests: number;
  readonly repositoryMetadataRequests: number;
  readonly sourceRequests: number;
  readonly attributionRequests: number;
}

export interface PrivateContextResult {
  readonly version: typeof PRIVATE_CONTEXT_RESULT_VERSION;
  readonly mode: "selected-private-repositories";
  readonly status: PrivateContextStatus;
  readonly subject: string;
  readonly relationship: PrivateRepositoryRelationship;
  readonly scoreInfluence: 0;
  readonly publicWinnerInfluence: 0;
  readonly persisted: false;
  readonly repositorySelection: {
    readonly installedPrivateRepositories: number;
    readonly consideredRepositories: number;
    readonly analyzedRepositories: number;
    readonly maintainedRepositories: number;
    readonly attributableRepositories: number;
  };
  readonly repositorySignals: {
    readonly activeRepositories: number | null;
    readonly substantialRepositories: number | null;
    readonly repositoriesWithTests: number | null;
    readonly repositoriesWithCi: number | null;
    readonly repositoriesWithReleases: number | null;
  };
  readonly maintainedCodebase: PrivateQualityReading;
  readonly attributedCode: PrivateQualityReading;
  readonly limitations: readonly PrivateContextLimitation[];
  readonly receipts: readonly PrivateAggregateReceipt[];
  readonly requestTelemetry: PrivateRequestTelemetry;
}

export type PrivateContextErrorCode =
  | "private_context_auth_required"
  | "private_context_auth_denied"
  | "private_context_auth_expired"
  | "private_context_auth_failed"
  | "private_context_configuration_invalid"
  | "private_context_conflicting_token_boundaries"
  | "private_context_identity_mismatch"
  | "private_context_installation_required"
  | "private_context_selected_repositories_required"
  | "private_context_permissions_invalid"
  | "private_context_unavailable"
  | "private_context_privacy_violation";

export interface PrivateContextError {
  readonly code: PrivateContextErrorCode;
  readonly message: string;
  readonly signedInAs?: string | undefined;
  readonly installationUrl?: string | undefined;
}

export type PrivateContextRunResult =
  | { readonly ok: true; readonly result: PrivateContextResult }
  | { readonly ok: false; readonly error: PrivateContextError };
