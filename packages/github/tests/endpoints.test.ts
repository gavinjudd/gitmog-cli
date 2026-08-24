import { describe, expect, it } from "vitest";

import { GITHUB_GRAPHQL_URL, GITHUB_REST_BASE_URL } from "../src/endpoints.js";

describe("endpoints", () => {
  it("are absolute https URLs", () => {
    for (const url of [GITHUB_REST_BASE_URL, GITHUB_GRAPHQL_URL]) {
      expect(new URL(url).protocol).toBe("https:");
    }
  });

  it("are not reachable from the default test suite", () => {
    expect(() => fetch(GITHUB_REST_BASE_URL)).toThrow(/Network access is disabled/);
  });
});
