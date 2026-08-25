import { describe, expect, it } from "vitest";

import { countNoun, countVerb, formatCount } from "../src/count-grammar.js";

describe("deterministic count grammar", () => {
  it.each([
    ["repo", "repo", "repos"],
    ["repository", "repository", "repositories"],
    ["project", "project", "projects"],
    ["file", "file", "files"],
    ["request", "request", "requests"],
  ] as const)("formats %s at 0, 1, and 2+", (noun, singular, plural) => {
    expect(countNoun(0, noun)).toBe(plural);
    expect(countNoun(1, noun)).toBe(singular);
    expect(countNoun(2, noun)).toBe(plural);
    expect(formatCount(1, noun, "selected private")).toBe(`1 selected private ${singular}`);
  });

  it("agrees contains/contain and was/were at 0, 1, and 2+", () => {
    expect([0, 1, 2].map((count) => countVerb(count, "contains"))).toEqual([
      "contain",
      "contains",
      "contain",
    ]);
    expect([0, 1, 2].map((count) => countVerb(count, "was"))).toEqual(["were", "was", "were"]);
  });

  it("renders the required singular private aggregate", () => {
    const total = 1;
    expect(
      `1 of ${formatCount(total, "repository", "analyzed private")} ${countVerb(total, "contains")} CI configuration`,
    ).toBe("1 of 1 analyzed private repository contains CI configuration");
  });

  it("rejects negative and non-integral counts", () => {
    expect(() => formatCount(-1, "repo")).toThrow(TypeError);
    expect(() => countVerb(1.5, "was")).toThrow(TypeError);
  });
});
