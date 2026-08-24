import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const parse = (...parts: readonly string[]) =>
  JSON.parse(readFileSync(resolve(root, ...parts), "utf8")) as Record<string, unknown>;

describe("Quality Judge engineering-validation policy", () => {
  it("keeps the exact informational-only policy with no enabled state", () => {
    expect(parse("quality", "QUALITY_SCORE_POLICY.json")).toEqual({
      state: "informational-only",
      scoreInfluence: 0,
      reason: "Quality Judge is a separate product signal",
    });
  });

  it("removes the retired reviewer-program machinery", () => {
    for (const path of [
      "calibration",
      "docs/CALIBRATION.md",
      "scripts/calibration-check.mjs",
      ".github/workflows/calibration.yml",
    ]) {
      expect(existsSync(resolve(root, path))).toBe(false);
    }
  });

  it("retains license-safe synthetic parser fixtures", () => {
    const manifest = parse("quality", "fixtures", "manifest.json");
    expect(manifest.license).toBe("MIT");
    expect(manifest.containsPublicSource).toBe(false);
    expect(manifest.cases).toHaveLength(3);
    expect(
      readdirSync(resolve(root, "quality", "fixtures"), { recursive: true }).map((value) =>
        String(value).replaceAll("\\", "/"),
      ),
    ).toEqual(
      expect.arrayContaining([
        "javascript/unsafe-evaluation.js",
        "typescript/bounded-contract.ts",
        "typescript/hostile-depth.ts",
      ]),
    );
  });
});
