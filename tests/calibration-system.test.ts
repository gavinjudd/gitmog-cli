import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const calibration = (...parts: readonly string[]) => resolve(root, "calibration", ...parts);
const parse = (...parts: readonly string[]) =>
  JSON.parse(readFileSync(calibration(...parts), "utf8")) as Record<string, unknown>;

describe("blinded human calibration system", () => {
  it("keeps the public corpus and human judgment count truthfully empty", () => {
    const manifest = parse("public-training-manifest.json");
    expect(manifest.state).toBe("not-collected");
    expect(manifest.repositories).toEqual([]);
    expect(manifest.pairs).toEqual([]);
    expect(manifest.judgmentsCollected).toBe(0);
  });

  it("has no calibration report before genuine human review", () => {
    const reports = readdirSync(calibration("reports"), { withFileTypes: true }).filter(
      (entry) => entry.isFile() && entry.name !== ".gitkeep",
    );
    expect(reports).toEqual([]);
  });

  it("keeps judgment exports free of identity, source, repository, and popularity fields", () => {
    const schema = readFileSync(calibration("schema", "judgment.schema.json"), "utf8");
    for (const forbidden of [
      "repository",
      "sourceUrl",
      "sourceText",
      "owner",
      "email",
      "stars",
      "forks",
      "followers",
    ]) {
      expect(schema).not.toContain(`"${forbidden}"`);
    }
  });

  it("keeps activation at the exact disabled contract", () => {
    expect(parse("QUALITY_SCORE_ACTIVATION.json")).toEqual({
      state: "disabled",
      reason: "human calibration pending",
    });
  });

  it("fixes reviewer, judgment, corpus, holdout, and threshold minima", () => {
    const preregistration = readFileSync(calibration("PREREGISTRATION.md"), "utf8");
    for (const required of [
      "three genuine humans",
      "at least 200",
      "at least 75",
      "At least 25%",
      ">= 0.60",
      ">= 0.70",
      ">= 0.62",
      ">= 0.55",
    ]) {
      expect(preregistration).toContain(required);
    }
  });
});
