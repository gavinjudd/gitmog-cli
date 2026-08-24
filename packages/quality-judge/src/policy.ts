export interface QualityScorePolicy {
  readonly state: "informational-only";
  readonly scoreInfluence: 0;
  readonly reason: "Quality Judge is a separate product signal";
}

export const QUALITY_SCORE_POLICY: QualityScorePolicy = Object.freeze({
  state: "informational-only",
  scoreInfluence: 0,
  reason: "Quality Judge is a separate product signal",
});

/** There is deliberately no enabled branch. Missing or malformed input remains non-scoring. */
export function resolveQualityScorePolicy(value: unknown): QualityScorePolicy {
  if (
    typeof value === "object" &&
    value !== null &&
    "state" in value &&
    value.state === "informational-only" &&
    "scoreInfluence" in value &&
    value.scoreInfluence === 0 &&
    "reason" in value &&
    value.reason === "Quality Judge is a separate product signal"
  ) {
    return QUALITY_SCORE_POLICY;
  }
  return QUALITY_SCORE_POLICY;
}
