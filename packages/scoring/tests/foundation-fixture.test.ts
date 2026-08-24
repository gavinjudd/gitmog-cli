import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  foundationScoreFixture,
  type CategorySubscores,
  type FoundationScorecard,
} from "../src/foundation-fixture.js";

const read = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as T;

describe("foundationScoreFixture", () => {
  it("reproduces the committed golden scorecard", () => {
    const input = read<CategorySubscores>("minimal-input.json");
    const expected = read<FoundationScorecard>("minimal-scorecard.golden.json");
    expect(foundationScoreFixture(input)).toEqual(expected);
  });

  it("is deterministic across repeated calls", () => {
    const input = read<CategorySubscores>("minimal-input.json");
    expect(foundationScoreFixture(input)).toEqual(foundationScoreFixture(input));
  });

  it("clamps out-of-range subscores instead of exceeding the maximum", () => {
    const result = foundationScoreFixture({
      craft: 5,
      activity: 5,
      collaboration: 5,
      projectHealth: 5,
      impact: -2,
    });
    expect(result.total).toBe(90);
    expect(result.categories.impact).toBe(0);
  });
});
