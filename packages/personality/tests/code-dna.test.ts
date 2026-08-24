import {
  SOURCE_FEATURE_VERSION,
  SOURCE_REDACTION_VERSION,
  SOURCE_SIMPLIFICATION_VERSION,
} from "@gitmog/analyzers";
import {
  CODE_DNA_SAMPLE_VERSION,
  collectProfileSnapshot,
  resolveSourceOpportunityScope,
  type SourceSampleSet,
} from "@gitmog/github";
import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
} from "@gitmog/test-fixtures/github-personas";
import { describe, expect, it } from "vitest";

import { AXIS_FORMULAS, calculateDeterministicAxes } from "../src/axis-engine.js";
import { CODE_DNA_DEFINITIONS, CODE_DNA_IDS } from "../src/catalog.js";
import {
  CODE_DNA_CALIBRATION_FIXTURES,
  calibrationSample,
  calibrationSampleSet,
  evaluateDeterministicCalibration,
  runDeterministicCalibration,
} from "../src/calibration.js";
import {
  analysisCacheDisposition,
  CODE_DNA_CACHE_KEY_VERSION,
  codeDnaCacheKey,
  evaluateCodeDnaSampleSet,
  readCodeDna,
  type CodeDnaOptions,
} from "../src/judge.js";
import {
  CODE_AXIS_ENGINE_VERSION,
  CODE_AXIS_IDS,
  CODE_DNA_VERSION,
  SOURCE_STYLE_FEATURE_IDS,
} from "../src/types.js";

const fixture = (id: string) => {
  const found = CODE_DNA_CALIBRATION_FIXTURES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`Missing fixture ${id}`);
  return found;
};

const subset = (set: SourceSampleSet, count: number): SourceSampleSet => {
  const samples = set.samples.slice(0, count);
  return {
    ...set,
    samples,
    repositoriesRepresented: new Set(samples.map((sample) => sample.repository)).size,
    totalBytes: samples.reduce((total, sample) => total + sample.byteLength, 0),
  };
};

describe("deterministic axis formulas", () => {
  it("versions the deterministic engine", () => {
    expect(CODE_AXIS_ENGINE_VERSION).toBe("3.1.0-explainable-source-style");
  });

  it("declares an explicit positive cap for every contribution and no duplicate term", () => {
    for (const id of CODE_AXIS_IDS) {
      const formula = AXIS_FORMULAS[id];
      expect(formula.axis).toBe(id);
      expect(formula.baseline).toBeGreaterThanOrEqual(0);
      expect(formula.baseline).toBeLessThanOrEqual(100);
      expect(new Set(formula.terms.map((term) => term.featureId)).size).toBe(formula.terms.length);
      expect(formula.terms.some((term) => term.direction === "first-pole")).toBe(true);
      expect(formula.terms.some((term) => term.direction === "second-pole")).toBe(true);
      for (const term of formula.terms) {
        expect(SOURCE_STYLE_FEATURE_IDS).toContain(term.featureId);
        expect(term.cap).toBeGreaterThan(0);
        expect(term.cap).toBeLessThanOrEqual(45);
      }
    }
  });

  it("returns byte-identical axes for the same sample set", () => {
    const set = calibrationSampleSet(fixture("high-confidence-hybrid"));
    const first = calculateDeterministicAxes(set);
    const second = calculateDeterministicAxes(set);
    expect(JSON.stringify(first.axes)).toBe(JSON.stringify(second.axes));
  });

  it("keeps mixed-language axes byte-identical when sample order changes", () => {
    const set = calibrationSampleSet(fixture("high-confidence-hybrid"));
    const reversed = { ...set, samples: [...set.samples].reverse() };
    expect(JSON.stringify(calculateDeterministicAxes(set).axes)).toBe(
      JSON.stringify(calculateDeterministicAxes(reversed).axes),
    );
  });

  it("makes every contribution inspectable, capped, and linked to known samples", () => {
    const set = calibrationSampleSet(fixture("deep-abstraction"));
    const evaluation = calculateDeterministicAxes(set);
    const known = new Set(set.samples.map((sample) => sample.sampleId));
    for (const id of CODE_AXIS_IDS) {
      const axis = evaluation.axes[id];
      expect(axis.axisEngineVersion).toBe(CODE_AXIS_ENGINE_VERSION);
      expect(axis.score).toBeGreaterThanOrEqual(0);
      expect(axis.score).toBeLessThanOrEqual(100);
      expect(["first-pole", "neutral", "second-pole"]).toContain(axis.direction);
      const firstPole = axis.contributions.filter(
        (contribution) => contribution.direction === "first-pole",
      );
      const secondPole = axis.contributions.filter(
        (contribution) => contribution.direction === "second-pole",
      );
      expect(firstPole.length + secondPole.length).toBe(axis.contributions.length);
      for (const contribution of axis.contributions) {
        expect(contribution.contribution).toBeLessThanOrEqual(contribution.weight);
        expect(contribution.explanation.length).toBeGreaterThan(10);
        expect(SOURCE_STYLE_FEATURE_IDS).toContain(contribution.id);
        expect(contribution.sampleIds.length).toBeGreaterThan(0);
        expect(contribution.sampleIds.every((sampleId) => known.has(sampleId))).toBe(true);
      }
    }
  });

  it("raises confidence with multi-file, multi-repository evidence", () => {
    const full = calibrationSampleSet(fixture("high-confidence-hybrid"));
    const narrow = subset(full, 1);
    const fullEvaluation = calculateDeterministicAxes(full);
    const narrowEvaluation = calculateDeterministicAxes(narrow);
    expect(fullEvaluation.coverage.sampleCount).toBe(3);
    expect(fullEvaluation.coverage.repositoryCount).toBe(3);
    expect(fullEvaluation.confidence).toBeGreaterThan(narrowEvaluation.confidence);
  });

  it("records unsupported language coverage instead of inventing an extreme", () => {
    const known = calibrationSampleSet(fixture("direct-compact-application"));
    const original = known.samples[0];
    if (original === undefined) throw new Error("missing sample");
    const unsupported: SourceSampleSet = {
      ...known,
      samples: [
        {
          ...original,
          path: "src/cart.zig",
          primaryLanguage: "Zig",
          features: { ...original.features, language: "unknown", languageSupported: false },
        },
      ],
    };
    const result = calculateDeterministicAxes(unsupported);
    expect(result.coverage.supportedShare).toBe(0);
    expect(result.coverage.unsupportedLanguages).toEqual(["unknown"]);
    expect(result.limitations).toContain("unsupported feature language: unknown");
    expect(CODE_AXIS_IDS.map((id) => result.axes[id].score)).toEqual([50, 42, 48, 25]);
    expect(result.featureReadings).toEqual([]);
  });
});

describe("deterministic fixture calibration", () => {
  it("passes every axis, confidence, identity, feature and coverage contract", () => {
    const results = runDeterministicCalibration();
    expect(results).toHaveLength(CODE_DNA_CALIBRATION_FIXTURES.length);
    expect(results.filter((result) => !result.valid)).toEqual([]);
    for (const result of results) {
      expect(result.axesInBand).toBe(true);
      expect(result.confidencePass).toBe(true);
      expect(result.identityPass).toBe(true);
      expect(result.incompatibilityPass).toBe(true);
      expect(result.featureSupportPass).toBe(true);
      expect(result.coveragePass).toBe(true);
      expect(result.labelCoherent).toBe(true);
    }
  });

  it("specifies all required calibration fields for every fixture", () => {
    for (const entry of CODE_DNA_CALIBRATION_FIXTURES) {
      expect(Object.keys(entry.expectedAxes).sort()).toEqual([...CODE_AXIS_IDS].sort());
      expect(entry.expectedConfidenceFloor).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(entry.eligibleIdentities)).toBe(true);
      expect(Array.isArray(entry.ineligibleIdentities)).toBe(true);
      expect(Array.isArray(entry.requiredFeatureSupport)).toBe(true);
      expect(entry.coverageExpectation.sampleCount).toBeGreaterThan(0);
      expect(entry.coverageExpectation.repositoryCount).toBeGreaterThan(0);
    }
  });

  it("reaches every active identity and keeps declared incompatibilities unreachable", () => {
    const results = runDeterministicCalibration();
    const reached = new Set(
      results.flatMap((result) =>
        result.labelCandidates
          .filter((candidate) => candidate.eligible)
          .map((candidate) => candidate.id),
      ),
    );
    expect(CODE_DNA_IDS.filter((id) => !reached.has(id))).toEqual([]);
    for (const entry of CODE_DNA_CALIBRATION_FIXTURES) {
      const result = evaluateDeterministicCalibration(entry);
      for (const candidate of result.labelCandidates.filter((candidate) => candidate.eligible)) {
        expect(
          candidate.featureIds.length,
          `${entry.id}/${candidate.id} feature receipts`,
        ).toBeGreaterThan(0);
        expect(
          candidate.sampleIds.length,
          `${entry.id}/${candidate.id} sample receipts`,
        ).toBeGreaterThan(0);
      }
      for (const id of entry.ineligibleIdentities) {
        expect(
          result.labelCandidates.find((candidate) => candidate.id === id)?.eligible ?? false,
        ).toBe(false);
      }
    }
  });

  it("removes the diagnostic instruction-shaped comment and redacts the synthetic token", () => {
    const injection = calibrationSample(fixture("instruction-shaped-comment"));
    const secret = calibrationSample(fixture("secret-shaped-source"));
    expect(injection.commentLinesRemoved).toBeGreaterThan(0);
    expect(secret.redactions).toBeGreaterThan(0);
    expect(JSON.stringify([injection, secret])).not.toContain("ghp_");
    expect(JSON.stringify([injection, secret])).not.toContain('"content"');
  });
});

describe("Code DNA taxonomy", () => {
  it("declares hard gates, deterministic feature groups, blockers, confidence, and three copy modes", () => {
    expect(new Set(CODE_DNA_IDS).size).toBe(CODE_DNA_IDS.length);
    for (const definition of CODE_DNA_DEFINITIONS) {
      expect(definition.axisGates.length).toBeGreaterThan(0);
      expect(definition.requiredFeatureGroups.length).toBeGreaterThan(0);
      expect(definition.minimumConfidence).toBeGreaterThanOrEqual(45);
      expect(Array.isArray(definition.blockingConditions)).toBe(true);
      expect(Object.keys(definition.copy).sort()).toEqual(["clean", "spicy", "unhinged"]);
      expect(definition).not.toHaveProperty("rarity");
    }
  });

  it("assigns CODE CHIMERA only to the high-confidence covered hybrid", () => {
    const hybridSet = calibrationSampleSet(fixture("high-confidence-hybrid"));
    const hybrid = evaluateCodeDnaSampleSet(hybridSet);
    expect(hybrid.status).toBe("ready");
    if (hybrid.status !== "ready") throw new Error("hybrid did not resolve");
    expect(hybrid.label.name).toBe("CODE CHIMERA");
    expect(hybrid.label.confidence).toBeGreaterThanOrEqual(65);
    expect(hybrid.label.featureIds.length).toBeGreaterThanOrEqual(4);
    expect(hybrid.label.sampleIds.length).toBeGreaterThanOrEqual(2);

    const narrow = evaluateCodeDnaSampleSet(subset(hybridSet, 1));
    expect(narrow.status === "ready" && narrow.label.id === "code-chimera").toBe(false);
    const specialist = evaluateCodeDnaSampleSet(calibrationSampleSet(fixture("systems-protocol")));
    expect(specialist.status).toBe("partial");
    if (specialist.status === "partial") expect(specialist.label?.id).toBe("systems-maxxer");
  });

  it("uses partial only for bounded evidence that cannot support a public identity", () => {
    const result = evaluateCodeDnaSampleSet(calibrationSampleSet(fixture("mixed-inconclusive")));
    expect(result.status).toBe("partial");
    if (result.status === "partial")
      expect(result.reason.toLowerCase()).not.toContain("mixed signal");
  });

  it("returns receipts and never returns source bytes", () => {
    const set = calibrationSampleSet(fixture("deep-abstraction"));
    const result = evaluateCodeDnaSampleSet(set);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('"content"');
    if (result.status === "ready") {
      expect(result.label.axisEngineVersion).toBe(CODE_AXIS_ENGINE_VERSION);
      expect(result.label.sampleIds.length).toBeGreaterThan(0);
      expect(result.label.featureIds.length).toBeGreaterThan(0);
    }
  });
});

describe("analysis cache boundary", () => {
  it("uses a versioned evidence-and-logical-scope cache key", () => {
    const low = codeDnaCacheKey("same", { sourceRequestAllowance: 2 });
    const high = codeDnaCacheKey("same", { sourceRequestAllowance: 10 });
    expect(low).toContain(CODE_DNA_CACHE_KEY_VERSION);
    expect(low).toContain(CODE_DNA_VERSION);
    expect(low).toContain(CODE_AXIS_ENGINE_VERSION);
    expect(low).toContain(CODE_DNA_SAMPLE_VERSION);
    expect(low).toContain(SOURCE_FEATURE_VERSION);
    expect(low).toContain(SOURCE_SIMPLIFICATION_VERSION);
    expect(low).toContain(SOURCE_REDACTION_VERSION);
    expect(low).toContain("sourceRequestAllowance=2");
    expect(high).toContain("sourceRequestAllowance=10");
    expect(high).not.toBe(low);
  });

  it("isolates low and high logical scopes in both cache population orders", async () => {
    const collected = await collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
      fetchImpl: createFixtureFetch(PERSONAS.strongMaintainer),
      cache: null,
      now: () => FIXTURE_NOW_MS,
    });
    if (!collected.ok) throw new Error(collected.error.code);

    type Cache = NonNullable<CodeDnaOptions["cache"]>;
    type CacheValue = NonNullable<ReturnType<Cache["get"]>>;
    const scenario = async (order: readonly [number, number]) => {
      const entries = new Map<string, CacheValue>();
      const reads: string[] = [];
      const writes: string[] = [];
      const cache: Cache = {
        get(key) {
          reads.push(key);
          return entries.get(key);
        },
        set(key, value) {
          writes.push(key);
          entries.set(key, value);
        },
        delete(key) {
          entries.delete(key);
        },
        clear() {
          entries.clear();
        },
        get size() {
          return entries.size;
        },
      };
      const execute = async (sourceRequestAllowance: number, forbidFetch = false) => {
        let calls = 0;
        const fixtureFetch = createFixtureFetch(PERSONAS.strongMaintainer);
        const outcome = await readCodeDna(collected.snapshot, {
          cache,
          maxRequests: sourceRequestAllowance,
          token: "fixture-auth-scope-sentinel",
          fetchImpl: forbidFetch
            ? () => {
                throw new Error("same-scope warm read should not fetch");
              }
            : (input, init) => {
                calls += 1;
                return fixtureFetch(input, init);
              },
        });
        return {
          sourceRequestAllowance,
          key: codeDnaCacheKey(
            collected.snapshot.snapshotKey,
            resolveSourceOpportunityScope(collected.snapshot, {
              maxRequests: sourceRequestAllowance,
            }),
          ),
          calls,
          outcome,
        };
      };
      const first = await execute(order[0]);
      const reused = await execute(order[0], true);
      const second = await execute(order[1]);
      return { entries, reads, writes, first, reused, second };
    };

    const lowHigh = await scenario([2, 10]);
    const highLow = await scenario([10, 2]);
    const lowFromLowHigh = lowHigh.first;
    const lowFromHighLow = highLow.second;
    const highFromLowHigh = lowHigh.second;
    const highFromHighLow = highLow.first;

    for (const low of [lowFromLowHigh, lowFromHighLow]) {
      expect(low.outcome.status).toBe("partial");
      if (low.outcome.status === "insufficient") throw new Error("low scope was insufficient");
      expect(low.outcome.cacheDisposition).toBe("stable");
      expect(low.outcome.sourceFailureReasons).toContain("request-budget-exhausted");
      expect(low.outcome.samples).toHaveLength(2);
      expect(low.calls).toBe(2);
    }
    for (const high of [highFromLowHigh, highFromHighLow]) {
      expect(high.outcome).toMatchObject({ status: "ready", cacheDisposition: "stable" });
      expect(high.outcome.samples).toHaveLength(3);
      expect(high.calls).toBe(3);
    }
    expect(lowFromLowHigh.key).not.toBe(highFromLowHigh.key);
    expect(JSON.stringify(lowFromLowHigh.outcome)).toBe(JSON.stringify(lowFromHighLow.outcome));
    expect(JSON.stringify(highFromLowHigh.outcome)).toBe(JSON.stringify(highFromHighLow.outcome));
    expect(JSON.stringify(lowHigh.reused.outcome)).toBe(JSON.stringify(lowFromLowHigh.outcome));
    expect(JSON.stringify(highLow.reused.outcome)).toBe(JSON.stringify(highFromHighLow.outcome));
    expect(lowHigh.reused.calls).toBe(0);
    expect(highLow.reused.calls).toBe(0);
    expect(lowHigh.entries.size).toBe(2);
    expect(highLow.entries.size).toBe(2);
    expect(new Set(lowHigh.writes)).toEqual(new Set([lowFromLowHigh.key, highFromLowHigh.key]));
    expect(JSON.stringify([...lowHigh.entries.entries()])).not.toContain(
      "fixture-auth-scope-sentinel",
    );
    expect(JSON.stringify([lowFromLowHigh.outcome, highFromLowHigh.outcome])).not.toContain(
      "fixture-auth-scope-sentinel",
    );
  });

  it("keeps refresh and no-cache byte-identical within each logical scope", async () => {
    const collected = await collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
      fetchImpl: createFixtureFetch(PERSONAS.strongMaintainer),
      cache: null,
      now: () => FIXTURE_NOW_MS,
    });
    if (!collected.ok) throw new Error(collected.error.code);

    type Cache = NonNullable<CodeDnaOptions["cache"]>;
    type CacheValue = NonNullable<ReturnType<Cache["get"]>>;
    for (const sourceRequestAllowance of [2, 10]) {
      const entries = new Map<string, CacheValue>();
      let reads = 0;
      let writes = 0;
      const cache: Cache = {
        get(key) {
          reads += 1;
          return entries.get(key);
        },
        set(key, value) {
          writes += 1;
          entries.set(key, value);
        },
        delete(key) {
          entries.delete(key);
        },
        clear() {
          entries.clear();
        },
        get size() {
          return entries.size;
        },
      };
      const execute = async (cachePolicy: { readonly read: boolean; readonly write: boolean }) => {
        let calls = 0;
        const fixtureFetch = createFixtureFetch(PERSONAS.strongMaintainer);
        const outcome = await readCodeDna(collected.snapshot, {
          cache,
          cachePolicy,
          maxRequests: sourceRequestAllowance,
          fetchImpl: (input, init) => {
            calls += 1;
            return fixtureFetch(input, init);
          },
        });
        return { calls, outcome };
      };
      const cold = await execute({ read: true, write: true });
      const warm = await execute({ read: true, write: true });
      const readsBeforeRefresh = reads;
      const refreshed = await execute({ read: false, write: true });
      expect(reads).toBe(readsBeforeRefresh);
      const readsBeforeNoCache = reads;
      const writesBeforeNoCache = writes;
      const noCache = await execute({ read: false, write: false });

      expect(warm.calls).toBe(0);
      expect(refreshed.calls).toBeGreaterThan(0);
      expect(noCache.calls).toBeGreaterThan(0);
      expect(reads).toBe(readsBeforeNoCache);
      expect(writes).toBe(writesBeforeNoCache);
      expect(JSON.stringify(warm.outcome)).toBe(JSON.stringify(cold.outcome));
      expect(JSON.stringify(refreshed.outcome)).toBe(JSON.stringify(cold.outcome));
      expect(JSON.stringify(noCache.outcome)).toBe(JSON.stringify(cold.outcome));
    }
  });

  it("treats the previous unscoped whole-profile cache identity as a miss", async () => {
    const collected = await collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
      fetchImpl: createFixtureFetch(PERSONAS.strongMaintainer),
      cache: null,
      now: () => FIXTURE_NOW_MS,
    });
    if (!collected.ok) throw new Error(collected.error.code);
    type Cache = NonNullable<CodeDnaOptions["cache"]>;
    type CacheValue = NonNullable<ReturnType<Cache["get"]>>;
    const seed = await readCodeDna(collected.snapshot, {
      maxRequests: 10,
      fetchImpl: createFixtureFetch(PERSONAS.strongMaintainer),
    });
    if (seed.status !== "ready") throw new Error("scope fixture did not produce READY");
    const oldUnscopedKey = [
      "codeDna",
      CODE_AXIS_ENGINE_VERSION,
      CODE_DNA_SAMPLE_VERSION,
      SOURCE_FEATURE_VERSION,
      SOURCE_SIMPLIFICATION_VERSION,
      SOURCE_REDACTION_VERSION,
      collected.snapshot.snapshotKey,
    ].join(":");
    const entries = new Map<string, CacheValue>([[oldUnscopedKey, seed]]);
    const reads: string[] = [];
    const cache: Cache = {
      get(key) {
        reads.push(key);
        return entries.get(key);
      },
      set(key, value) {
        entries.set(key, value);
      },
      delete(key) {
        entries.delete(key);
      },
      clear() {
        entries.clear();
      },
      get size() {
        return entries.size;
      },
    };
    let calls = 0;
    const fixtureFetch = createFixtureFetch(PERSONAS.strongMaintainer);
    const result = await readCodeDna(collected.snapshot, {
      cache,
      maxRequests: 2,
      fetchImpl: (input, init) => {
        calls += 1;
        return fixtureFetch(input, init);
      },
    });
    expect(result.status).toBe("partial");
    expect(calls).toBe(2);
    expect(reads).toEqual([
      codeDnaCacheKey(collected.snapshot.snapshotKey, { sourceRequestAllowance: 2 }),
    ]);
    expect(entries.has(oldUnscopedKey)).toBe(true);
    expect(entries.size).toBe(2);
  });

  it("classifies stable and transient failure provenance from structured reasons", () => {
    for (const reason of [
      "no-source-candidate",
      "request-budget-exhausted",
      "oversized",
      "non-text",
      "redaction-threshold",
      "unsupported-language",
    ] as const) {
      expect(
        analysisCacheDisposition({
          treeTruncated: false,
          failures: [{ reason, detail: reason }],
        }),
      ).toBe("stable");
    }
    for (const reason of [
      "rate-limited",
      "tree-unavailable",
      "blob-unavailable",
      "timeout",
      "transport-failure",
      "upstream-failure",
      "incomplete-github-response",
      "unknown",
    ] as const) {
      expect(
        analysisCacheDisposition({
          treeTruncated: false,
          failures: [{ reason, detail: reason }],
        }),
      ).toBe("transient");
    }
    expect(analysisCacheDisposition({ treeTruncated: true, failures: [] })).toBe("transient");
  });

  it("never caches a rate-limited partial, retries it, then writes and reuses READY bytes", async () => {
    const initialFetch = createFixtureFetch(PERSONAS.strongMaintainer);
    const collected = await collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
      fetchImpl: initialFetch,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    });
    if (!collected.ok) throw new Error(collected.error.code);

    type Cache = NonNullable<CodeDnaOptions["cache"]>;
    type CacheValue = ReturnType<Cache["get"]>;
    const entries = new Map<string, NonNullable<CacheValue>>();
    let reads = 0;
    let writes = 0;
    const cache: Cache = {
      get(key) {
        reads += 1;
        return entries.get(key);
      },
      set(key, value) {
        writes += 1;
        entries.set(key, value);
      },
      delete(key) {
        entries.delete(key);
      },
      clear() {
        entries.clear();
      },
      get size() {
        return entries.size;
      },
    };

    const firstFixture = createFixtureFetch(PERSONAS.strongMaintainer);
    let firstCalls = 0;
    const transientFetch: typeof fetch = (input, init) => {
      firstCalls += 1;
      if (firstCalls === 2) {
        return Promise.resolve(
          new Response('{"message":"API rate limit exceeded"}', {
            status: 403,
            headers: { "x-ratelimit-remaining": "0" },
          }),
        );
      }
      return firstFixture(input, init);
    };
    const transient = await readCodeDna(collected.snapshot, {
      cache,
      fetchImpl: transientFetch,
    });
    expect(transient.status).toBe("partial");
    if (transient.status === "insufficient") throw new Error("transient result was insufficient");
    expect(transient.cacheDisposition).toBe("transient");
    expect(transient.sourceFailureReasons).toContain("rate-limited");
    expect(firstCalls).toBe(2);
    expect(writes).toBe(0);
    expect(entries.size).toBe(0);

    const retryFixture = createFixtureFetch(PERSONAS.strongMaintainer);
    let retryCalls = 0;
    const retryFetch: typeof fetch = (input, init) => {
      retryCalls += 1;
      return retryFixture(input, init);
    };
    const ready = await readCodeDna(collected.snapshot, { cache, fetchImpl: retryFetch });
    expect(ready).toMatchObject({ status: "ready", cacheDisposition: "stable" });
    expect(retryCalls).toBeGreaterThan(0);
    expect(writes).toBe(1);

    const cached = await readCodeDna(collected.snapshot, {
      cache,
      fetchImpl: () => {
        throw new Error("stable cache hit should not fetch");
      },
    });
    expect(JSON.stringify(cached)).toBe(JSON.stringify(ready));
    expect(reads).toBe(3);
  });

  it("bypasses cache reads on refresh, preserves a stable entry after transient failure, and honors no-cache", async () => {
    const initialFetch = createFixtureFetch(PERSONAS.strongMaintainer);
    const collected = await collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
      fetchImpl: initialFetch,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    });
    if (!collected.ok) throw new Error(collected.error.code);

    type Cache = NonNullable<CodeDnaOptions["cache"]>;
    type CacheValue = ReturnType<Cache["get"]>;
    const entries = new Map<string, NonNullable<CacheValue>>();
    let reads = 0;
    let writes = 0;
    const cache: Cache = {
      get: (key) => {
        reads += 1;
        return entries.get(key);
      },
      set: (key, value) => {
        writes += 1;
        entries.set(key, value);
      },
      delete: (key) => {
        entries.delete(key);
      },
      clear: () => entries.clear(),
      get size() {
        return entries.size;
      },
    };

    const stableFixture = createFixtureFetch(PERSONAS.strongMaintainer);
    const stable = await readCodeDna(collected.snapshot, { cache, fetchImpl: stableFixture });
    expect(stable.status).toBe("ready");
    expect(writes).toBe(1);
    const readsBeforeRefresh = reads;

    const refreshFixture = createFixtureFetch(PERSONAS.strongMaintainer);
    let refreshCalls = 0;
    const refreshed = await readCodeDna(collected.snapshot, {
      cache,
      cachePolicy: { read: false, write: true },
      fetchImpl: (input, init) => {
        refreshCalls += 1;
        return refreshFixture(input, init);
      },
    });
    expect(refreshCalls).toBeGreaterThan(0);
    expect(reads).toBe(readsBeforeRefresh);
    expect(writes).toBe(2);
    expect(JSON.stringify(refreshed)).toBe(JSON.stringify(stable));

    const failedFixture = createFixtureFetch(PERSONAS.strongMaintainer);
    let failedCalls = 0;
    const failedRefresh = await readCodeDna(collected.snapshot, {
      cache,
      cachePolicy: { read: false, write: true },
      fetchImpl: (input, init) => {
        failedCalls += 1;
        return failedCalls === 2
          ? Promise.resolve(
              new Response('{"message":"API rate limit exceeded"}', {
                status: 403,
                headers: { "x-ratelimit-remaining": "0" },
              }),
            )
          : failedFixture(input, init);
      },
    });
    expect(failedRefresh).toMatchObject({ status: "partial", cacheDisposition: "transient" });
    expect(writes).toBe(2);
    const afterFailure = await readCodeDna(collected.snapshot, { cache });
    expect(JSON.stringify(afterFailure)).toBe(JSON.stringify(stable));

    const noCacheFixture = createFixtureFetch(PERSONAS.strongMaintainer);
    const readsBeforeNoCache = reads;
    const writesBeforeNoCache = writes;
    await readCodeDna(collected.snapshot, {
      cache,
      cachePolicy: { read: false, write: false },
      fetchImpl: noCacheFixture,
    });
    expect(reads).toBe(readsBeforeNoCache);
    expect(writes).toBe(writesBeforeNoCache);
  });

  it("reuses only deterministic stable partials", async () => {
    const initialFetch = createFixtureFetch(PERSONAS.strongMaintainer);
    const collected = await collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
      fetchImpl: initialFetch,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    });
    if (!collected.ok) throw new Error(collected.error.code);
    type Cache = NonNullable<CodeDnaOptions["cache"]>;
    type CacheValue = ReturnType<Cache["get"]>;
    const entries = new Map<string, NonNullable<CacheValue>>();
    const cache: Cache = {
      get: (key) => entries.get(key),
      set: (key, value) => entries.set(key, value),
      delete: (key) => entries.delete(key),
      clear: () => entries.clear(),
      get size() {
        return entries.size;
      },
    };
    const partial = await readCodeDna(collected.snapshot, {
      cache,
      maxRequests: 1,
      fetchImpl: createFixtureFetch(PERSONAS.strongMaintainer),
    });
    expect(partial.status).toBe("partial");
    if (partial.status === "insufficient") throw new Error("stable partial was insufficient");
    expect(partial.cacheDisposition).toBe("stable");
    expect(partial.sourceFailureReasons).toContain("request-budget-exhausted");
    expect(entries.size).toBe(1);
    const reused = await readCodeDna(collected.snapshot, {
      cache,
      maxRequests: 1,
      fetchImpl: () => {
        throw new Error("stable partial should be reused");
      },
    });
    expect(JSON.stringify(reused)).toBe(JSON.stringify(partial));
  });
});
