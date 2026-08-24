import { describe, expect, it } from "vitest";

import { CATEGORY_WEIGHTS, MAXIMUM_SCORE, SCORE_CATEGORIES } from "../src/categories.js";

describe("category weights", () => {
  it("sums to the maximum score", () => {
    const total = Object.values(CATEGORY_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBe(MAXIMUM_SCORE);
  });

  it("covers exactly the categories named in PLANNING.md", () => {
    expect([...SCORE_CATEGORIES]).toEqual([
      "craft",
      "activity",
      "collaboration",
      "projectHealth",
      "impact",
    ]);
  });

  it("is frozen so a caller cannot reweight the scorecard at runtime", () => {
    expect(Object.isFrozen(CATEGORY_WEIGHTS)).toBe(true);
  });
});
