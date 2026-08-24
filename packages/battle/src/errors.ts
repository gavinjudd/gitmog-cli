export type BattleErrorCode =
  | "invalid_handle"
  | "same_handle"
  | "not_found"
  | "suspended"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "malformed_response"
  | "upstream_error"
  | "insufficient_evidence"
  | "internal_error";

export interface BattleError {
  readonly code: BattleErrorCode;
  readonly message: string;
  readonly handle?: string;
  readonly retryAfterSeconds?: number;
  readonly resetAt?: string;
  readonly rateLimitClass?: "none" | "primary" | "secondary" | "unknown";
  readonly remaining?: number | null;
  readonly authenticationState?: "anonymous" | "explicit" | "device";
  readonly limitedRunPossible?: boolean;
  readonly collectionBegan?: boolean;
}

/**
 * Headline and body copy per failure. Errors stay in the product's voice and never turn
 * an infrastructure problem into a loss for either handle.
 */
export const ERROR_PRESENTATION: Readonly<
  Record<BattleErrorCode, { readonly headline: string; readonly body: string }>
> = Object.freeze({
  invalid_handle: {
    headline: "INVALID USAGE",
    body: "GitHub handles are 1–39 characters, letters, digits and single hyphens.",
  },
  same_handle: {
    headline: "INVALID USAGE",
    body: "Pick a different opponent. Self-battles are a draw by definition.",
  },
  not_found: {
    headline: "GITHUB PROFILE NOT FOUND",
    body: "GitHub has no public record of that handle.",
  },
  suspended: {
    headline: "GITHUB PROFILE UNAVAILABLE",
    body: "GitHub will not serve that profile publicly, so there is nothing to score.",
  },
  rate_limited: {
    headline: "GITHUB LIMIT REACHED",
    body: "GitHub's public request budget was exhausted before collection finished.",
  },
  timeout: {
    headline: "GITHUB TIMED OUT",
    body: "GitHub did not answer before the collection deadline.",
  },
  network_error: {
    headline: "GITHUB UPSTREAM FAILURE",
    body: "GitHub could not be reached.",
  },
  malformed_response: {
    headline: "GITHUB UPSTREAM FAILURE",
    body: "GitHub returned an unreadable response.",
  },
  upstream_error: {
    headline: "GITHUB UPSTREAM FAILURE",
    body: "GitHub could not complete the request.",
  },
  insufficient_evidence: {
    headline: "INSUFFICIENT PUBLIC DATA",
    body: "There is not enough public GitHub evidence to complete the result.",
  },
  internal_error: {
    headline: "GIT MOG STOPPED",
    body: "Git Mog could not complete the command.",
  },
});

export const presentBattleError = (
  error: BattleError,
): { readonly headline: string; readonly body: string } => ERROR_PRESENTATION[error.code];
