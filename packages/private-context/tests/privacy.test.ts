import { describe, expect, it } from "vitest";

import {
  createPrivateArtifactScanner,
  mixedPrivateArtifactIsSafe,
  privateAggregateShapeIsSafe,
} from "../src/privacy.js";

describe("Private Context output privacy", () => {
  it("accepts aggregate claims and rejects identifiers, paths, source, and secrets", () => {
    const scanner = createPrivateArtifactScanner([
      "sensitive-owner/private-repository",
      "src/credential-store.ts",
      "https://github.com/sensitive-owner/private-repository",
      "private_fixture_access_token_123456",
    ]);
    expect(scanner.scan('{"claim":"3 of 4 analyzed private repositories contain CI."}')).toBe(true);
    expect(scanner.scan('{"repository":"sensitive-owner/private-repository"}')).toBe(false);
    expect(scanner.scan('{"detail":"src/credential-store.ts"}')).toBe(false);
    expect(scanner.scan('{"source":"const password = 1"}')).toBe(false);
    expect(scanner.scan('{"token":"ghp_123456789012345678901234567890"}')).toBe(false);
    scanner.dispose();
  });

  it("rejects prohibited stable fields even when a value list is unavailable", () => {
    expect(privateAggregateShapeIsSafe({ repositorySignals: { activeRepositories: 2 } })).toBe(
      true,
    );
    expect(privateAggregateShapeIsSafe({ repositoryId: 42 })).toBe(false);
    expect(privateAggregateShapeIsSafe({ path: "unicode/Ｆile.ts" })).toBe(false);
    expect(privateAggregateShapeIsSafe({ commitMessage: "ship it" })).toBe(false);
  });

  it("scans mixed-context JSON and export artifacts after aggregate rendering", () => {
    const result = { scoreInfluence: 0, publicWinnerInfluence: 0, persisted: false };
    expect(mixedPrivateArtifactIsSafe("MIXED CONTEXT · PUBLIC WINNER", result)).toBe(true);
    expect(
      mixedPrivateArtifactIsSafe("MIXED CONTEXT · PUBLIC WINNER", {
        ...result,
        path: "private/file.ts",
      }),
    ).toBe(false);
    expect(mixedPrivateArtifactIsSafe("github_pat_123456789012345678901234567890", result)).toBe(
      false,
    );
  });
});
