import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
} from "@gitmog/test-fixtures/github-personas";
import { describe, expect, it } from "vitest";

import { collectProfileSnapshot } from "../src/collect.js";
import {
  QUALITY_MAX_ATTRIBUTION_REQUESTS,
  QUALITY_MAX_FILE_BYTES,
  QUALITY_MAX_FILES,
  QUALITY_MAX_SOURCE_REQUESTS,
  QUALITY_MAX_TOTAL_BYTES,
  collectQualitySource,
} from "../src/quality-source.js";

const snapshotOf = async () => {
  const result = await collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
    fetchImpl: createFixtureFetch(PERSONAS.strongMaintainer),
    cache: null,
    now: () => FIXTURE_NOW_MS,
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.snapshot;
};

describe("Quality Judge public source collection", () => {
  it("uses immutable revisions, deterministic bounded files, and author-linked path queries", async () => {
    const snapshot = await snapshotOf();
    const fetchImpl = createFixtureFetch(PERSONAS.strongMaintainer);
    const result = await collectQualitySource(snapshot, { fetchImpl });
    expect(result.sourceRequests).toBeLessThanOrEqual(QUALITY_MAX_SOURCE_REQUESTS);
    expect(result.attributionRequests).toBeLessThanOrEqual(QUALITY_MAX_ATTRIBUTION_REQUESTS);
    expect(result.files.length).toBeLessThanOrEqual(QUALITY_MAX_FILES);
    expect(result.files.reduce((total, file) => total + file.byteLength, 0)).toBeLessThanOrEqual(
      QUALITY_MAX_TOTAL_BYTES,
    );
    expect(result.files.every((file) => file.byteLength <= QUALITY_MAX_FILE_BYTES)).toBe(true);
    expect(result.files.every((file) => /^[0-9a-f]{40}$/u.test(file.commitSha))).toBe(true);
    expect(result.files.every((file) => file.sourceUrl.includes(file.commitSha))).toBe(true);
    expect(result.files.some((file) => file.attribution.status === "attributed")).toBe(true);
    expect(fetchImpl.calls.some((call) => call.includes("author=") && call.includes("path="))).toBe(
      true,
    );
    expect(JSON.stringify(result.selectedPaths)).not.toContain("synthetic fixture");
  });

  it("lets a limited request plan lower coverage without changing deterministic selection order", async () => {
    const snapshot = await snapshotOf();
    const complete = await collectQualitySource(snapshot, {
      fetchImpl: createFixtureFetch(PERSONAS.strongMaintainer),
    });
    const limited = await collectQualitySource(snapshot, {
      fetchImpl: createFixtureFetch(PERSONAS.strongMaintainer),
      sourceRequestCap: 5,
      attributionRequestCap: 0,
    });
    expect(limited.files.length).toBeGreaterThan(0);
    expect(limited.files.length).toBeLessThan(complete.files.length);
    expect(limited.selectedPaths).toEqual(complete.selectedPaths.slice(0, limited.files.length));
    expect(limited.files.every((file) => file.attribution.status === "not-checked")).toBe(true);
    expect(limited.limitations.some((entry) => entry.code === "source-budget")).toBe(true);
  });
});
