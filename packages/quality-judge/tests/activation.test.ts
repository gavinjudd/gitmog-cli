import { describe, expect, it } from "vitest";

import { QUALITY_SCORE_ACTIVATION, resolveQualityScoreActivation } from "../src/activation.js";

describe("quality score activation", () => {
  it("is structurally disabled and fails closed for every malformed or enabled-looking input", () => {
    expect(QUALITY_SCORE_ACTIVATION).toEqual({
      state: "disabled",
      reason: "human calibration pending",
    });
    for (const value of [undefined, null, {}, { state: "enabled" }, { state: "disabled" }]) {
      expect(resolveQualityScoreActivation(value)).toEqual(QUALITY_SCORE_ACTIVATION);
    }
  });
});
