import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CODE_DNA_CALIBRATION_FIXTURES,
  calibrationSampleSet,
} from "@gitmog/personality/calibration";
import { CODE_DNA_SAMPLE_VERSION, evaluateCodeDnaSampleSet } from "@gitmog/personality";
import { describe, expect, it } from "vitest";

import {
  createFileDerivedFeatureCache,
  createFileCodeDnaCache,
  derivedFeatureKey,
  isCodeDnaCacheEntry,
  isDerivedCacheSafe,
  isDerivedFeatureEntry,
} from "../src/cache.js";

const sample = () => {
  const fixture = CODE_DNA_CALIBRATION_FIXTURES[0];
  if (fixture === undefined) throw new Error("missing calibration fixture");
  const value = calibrationSampleSet(fixture).samples[0];
  if (value === undefined) throw new Error("missing calibration sample");
  const { features, ...receipt } = value;
  const key = {
    repositoryId: 1,
    repository: receipt.repository,
    commitSha: receipt.treeSha,
    blobSha: receipt.blobSha,
    normalizedPath: receipt.path,
    language: features.language,
    byteLimit: 12_000,
    analyzerVersion: "analyzer-v1",
    sourceFeatureVersion: "features-v1",
    redactionVersion: "redaction-v1",
  };
  return {
    key,
    entry: {
      key,
      features,
      coverage: {
        languageSupported: features.languageSupported,
        nonBlankLines: features.nonBlankLines,
      },
      redactionCount: receipt.redactions,
      byteLength: receipt.byteLength,
      truncated: receipt.truncated,
      commentLinesRemoved: receipt.commentLinesRemoved,
      stringsShortened: receipt.stringsShortened,
    },
  };
};

const cacheableOutcome = () => {
  const fixture = CODE_DNA_CALIBRATION_FIXTURES.find(
    (candidate) => candidate.id === "high-confidence-hybrid",
  );
  if (fixture === undefined) throw new Error("missing calibration fixture");
  const outcome = evaluateCodeDnaSampleSet(calibrationSampleSet(fixture));
  if (outcome.status !== "ready") throw new Error("calibration fixture was not ready");
  const sampleIds = new Map(
    outcome.samples.map((entry, index) => [
      entry.sampleId,
      `s${(index + 1).toString(16).padStart(32, "0")}`,
    ]),
  );
  const remapSampleIds = (value: unknown): unknown => {
    if (typeof value === "string") return sampleIds.get(value) ?? value;
    if (Array.isArray(value)) return value.map(remapSampleIds);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        remapSampleIds(nested),
      ]),
    );
  };
  return {
    ...(remapSampleIds(outcome) as typeof outcome),
    sampleVersion: CODE_DNA_SAMPLE_VERSION,
  };
};

describe("derived feature cache", () => {
  it("round-trips immutable path-specific vectors without source bytes or receipts", () => {
    const directory = mkdtempSync(join(tmpdir(), "gitmog-features-"));
    const cache = createFileDerivedFeatureCache({ directory, now: () => 1_000 });
    const { key, entry } = sample();
    cache.set(key, entry);
    expect(cache.get(key)).toEqual(entry);
    const written = readFileSync(join(directory, readdirSync(directory)[0] as string), "utf8");
    expect(written).toContain(entry.key.blobSha);
    expect(written).not.toContain('"content"');
    expect(written).not.toContain("authorization");
  });

  it("invalidates only a changed version key", () => {
    const directory = mkdtempSync(join(tmpdir(), "gitmog-features-"));
    const cache = createFileDerivedFeatureCache({ directory });
    const { key, entry } = sample();
    cache.set(key, entry);
    expect(cache.get(key)).toEqual(entry);
    expect(cache.get({ ...key, sourceFeatureVersion: "features-v2" })).toBeUndefined();
    expect(derivedFeatureKey(key)).not.toBe(
      derivedFeatureKey({ ...key, sourceFeatureVersion: "features-v2" }),
    );
    expect(cache.get({ ...key, normalizedPath: "src/other.ts" })).toBeUndefined();
    expect(cache.get({ ...key, language: "python" })).toBeUndefined();
    expect(cache.get({ ...key, analyzerVersion: "analyzer-v2" })).toBeUndefined();
    expect(cache.get({ ...key, redactionVersion: "redaction-v2" })).toBeUndefined();
  });

  it("degrades safely when an entry is corrupt", () => {
    const directory = mkdtempSync(join(tmpdir(), "gitmog-features-"));
    const cache = createFileDerivedFeatureCache({ directory });
    const { key, entry } = sample();
    cache.set(key, entry);
    writeFileSync(join(directory, readdirSync(directory)[0] as string), "{broken", "utf8");
    expect(cache.get(key)).toBeUndefined();
  });

  it("treats a mutated whole-profile reading as a cache miss", () => {
    const directory = mkdtempSync(join(tmpdir(), "gitmog-code-dna-"));
    const cache = createFileCodeDnaCache({ directory, now: () => 1_000 });
    const outcome = cacheableOutcome();
    cache.set("profile-key", outcome);

    const path = join(directory, readdirSync(directory)[0] as string);
    const stored = JSON.parse(readFileSync(path, "utf8")) as {
      value: { axes: { directAbstract: { score: number } } };
    };
    stored.value.axes.directAbstract.score += 1;
    writeFileSync(path, JSON.stringify(stored), "utf8");

    expect(cache.get("profile-key")).toBeUndefined();
  });

  it("rejects forbidden persistence shapes", () => {
    const { entry } = sample();
    expect(isDerivedFeatureEntry(entry)).toBe(true);
    expect(isDerivedFeatureEntry({ ...entry, sourceBytes: "raw bytes" })).toBe(false);
    expect(
      isDerivedFeatureEntry({ ...entry, features: { ...entry.features, prose: "hidden" } }),
    ).toBe(false);
    expect(isDerivedCacheSafe({ features: { functionCount: 2 } })).toBe(true);
    expect(isDerivedCacheSafe({ content: "raw bytes" })).toBe(false);
    expect(isDerivedCacheSafe({ prompt: "hidden" })).toBe(false);
  });

  it.each([
    "source",
    "Source",
    "content",
    "prompt",
    "messages",
    "authorization",
    "Authorization",
    "headers",
    "cookie",
    "token",
    "constructor",
    "prototype",
    "arbitraryField",
  ])("rejects exact-schema field %s", (field) => {
    const { entry } = sample();
    expect(isDerivedFeatureEntry({ ...entry, [field]: "unsafe" })).toBe(false);
  });

  it("rejects nested arbitrary fields, non-finite numbers, case variants, and prototype shapes", () => {
    const { entry } = sample();
    expect(
      isDerivedFeatureEntry({
        ...entry,
        coverage: { ...entry.coverage, arbitraryField: true },
      }),
    ).toBe(false);
    expect(isDerivedFeatureEntry({ ...entry, redactionCount: Number.NaN })).toBe(false);
    expect(isDerivedFeatureEntry({ ...entry, Features: entry.features, features: undefined })).toBe(
      false,
    );
    expect(isDerivedFeatureEntry({ ...entry, __proto__: { polluted: true } })).toBe(false);
    expect(isDerivedFeatureEntry(JSON.parse(`{"__proto__":{},"key":{}}`) as unknown)).toBe(false);
  });

  it("rejects every unknown Code DNA field at every persisted boundary", () => {
    const outcome = cacheableOutcome();
    expect(isCodeDnaCacheEntry(outcome)).toBe(true);
    for (const field of [
      "source",
      "Source",
      "content",
      "prompt",
      "messages",
      "authorization",
      "Authorization",
      "headers",
      "cookie",
      "token",
      "constructor",
      "prototype",
      "arbitraryField",
    ]) {
      expect(isCodeDnaCacheEntry({ ...outcome, [field]: "unsafe" })).toBe(false);
    }
    expect(
      isCodeDnaCacheEntry({
        ...outcome,
        axes: {
          ...outcome.axes,
          directAbstract: { ...outcome.axes.directAbstract, headers: {} },
        },
      }),
    ).toBe(false);
    expect(isCodeDnaCacheEntry({ ...outcome, Source: "raw" })).toBe(false);
    expect(isCodeDnaCacheEntry({ ...outcome, Authorization: "secret" })).toBe(false);
    expect(isCodeDnaCacheEntry({ ...outcome, __proto__: { polluted: true } })).toBe(false);
    expect(
      isCodeDnaCacheEntry({
        ...outcome,
        limitations: [...outcome.limitations, "x".repeat(513)],
      }),
    ).toBe(false);
    expect(isCodeDnaCacheEntry({ ...outcome, requestsUsed: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("rejects Code DNA entries with dangling or contradictory sample relationships", () => {
    const outcome = cacheableOutcome();
    const firstSample = outcome.samples[0];
    if (firstSample === undefined) throw new Error("calibration outcome has no sample");

    expect(
      isCodeDnaCacheEntry({
        ...outcome,
        label: { ...outcome.label, sampleIds: ["unknown-sample"] },
      }),
    ).toBe(false);
    expect(
      isCodeDnaCacheEntry({
        ...outcome,
        repositoriesRepresented: outcome.repositoriesRepresented + 1,
      }),
    ).toBe(false);
    expect(
      isCodeDnaCacheEntry({
        ...outcome,
        samples: [...outcome.samples, firstSample],
      }),
    ).toBe(false);
  });

  it("accepts the current stable receipt schema and rejects stale or transient analysis entries", () => {
    const outcome = cacheableOutcome();
    expect(isCodeDnaCacheEntry(outcome)).toBe(true);

    const { cacheDisposition: _cacheDisposition, ...withoutDisposition } = outcome;
    expect(isCodeDnaCacheEntry(withoutDisposition)).toBe(false);
    expect(isCodeDnaCacheEntry({ ...outcome, sampleVersion: "4.0.0-reused-tree-features" })).toBe(
      false,
    );
    expect(
      isCodeDnaCacheEntry({
        ...outcome,
        samples: outcome.samples.map((sample, index) =>
          index === 0 ? { ...sample, sampleId: "s12345678" } : sample,
        ),
      }),
    ).toBe(false);
    expect(
      isCodeDnaCacheEntry({
        ...outcome,
        cacheDisposition: "transient",
        sourceFailureReasons: ["rate-limited"],
      }),
    ).toBe(false);
    expect(
      isCodeDnaCacheEntry({
        ...outcome,
        sourceFailureReasons: ["timeout"],
      }),
    ).toBe(false);
  });
});
