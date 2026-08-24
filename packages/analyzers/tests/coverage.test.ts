import { describe, expect, it } from "vitest";

import { describeLanguageCoverage } from "../src/coverage.js";
import { SUPPORTED_LANGUAGES } from "../src/languages.js";

describe("describeLanguageCoverage", () => {
  it("separates supported from unsupported languages", () => {
    const coverage = describeLanguageCoverage(["TypeScript", "Rust", "go"]);
    expect(coverage.supported).toEqual(["go", "typescript"]);
    expect(coverage.unsupported).toEqual(["rust"]);
    expect(coverage.coverageWarning).toBe(true);
  });

  it("warns without penalizing when nothing is supported", () => {
    const coverage = describeLanguageCoverage(["rust", "elixir"]);
    expect(coverage.supported).toEqual([]);
    expect(coverage.coverageWarning).toBe(true);
    expect(Object.keys(coverage)).toEqual(["supported", "unsupported", "coverageWarning"]);
    for (const key of Object.keys(coverage)) {
      expect(key).not.toMatch(/penalt|deduct|score/i);
    }
  });

  it("raises no warning when every language is supported", () => {
    const coverage = describeLanguageCoverage([...SUPPORTED_LANGUAGES]);
    expect(coverage.unsupported).toEqual([]);
    expect(coverage.coverageWarning).toBe(false);
  });

  it("is deterministic and de-duplicated regardless of input order", () => {
    expect(describeLanguageCoverage(["go", "GO", "python"])).toEqual(
      describeLanguageCoverage(["python", "go"]),
    );
  });
});
