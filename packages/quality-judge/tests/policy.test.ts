import { describe, expect, it } from "vitest";

import { QUALITY_SCORE_POLICY, resolveQualityScorePolicy } from "../src/policy.js";

describe("quality score policy", () => {
  it("is structurally informational and fails closed for malformed or enabled-looking input", () => {
    expect(QUALITY_SCORE_POLICY).toEqual({
      state: "informational-only",
      scoreInfluence: 0,
      reason: "Quality Judge is a separate product signal",
    });
    for (const value of [
      undefined,
      null,
      {},
      { state: "enabled", scoreInfluence: 1 },
      { state: "informational-only" },
    ]) {
      expect(resolveQualityScorePolicy(value)).toEqual(QUALITY_SCORE_POLICY);
    }
  });
});
