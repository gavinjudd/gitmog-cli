export interface QualityScoreActivationState {
  readonly state: "disabled";
  readonly reason: "human calibration pending";
}

export const QUALITY_SCORE_ACTIVATION: QualityScoreActivationState = Object.freeze({
  state: "disabled",
  reason: "human calibration pending",
});

/** v0.3.0 intentionally has no enabled branch. Missing or malformed data stays disabled. */
export function resolveQualityScoreActivation(value: unknown): QualityScoreActivationState {
  if (
    typeof value === "object" &&
    value !== null &&
    "state" in value &&
    value.state === "disabled" &&
    "reason" in value &&
    value.reason === "human calibration pending"
  ) {
    return QUALITY_SCORE_ACTIVATION;
  }
  return QUALITY_SCORE_ACTIVATION;
}
