import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectProfileSnapshot, type ProfileSnapshot } from "@gitmog/github";
import { buildBattle, scoreProfileFastScan } from "@gitmog/scoring";
import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
  type PersonaSpec,
} from "@gitmog/test-fixtures/github-personas";
import { describe, expect, it } from "vitest";

import { analyzeBattleSource } from "../src/analyze.js";
import { createFileCodeDnaCache, createFileDerivedFeatureCache } from "../src/cache.js";

const withoutOperationalRequestCounts = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutOperationalRequestCounts);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "requestBudget" && key !== "requestsUsed")
      .map(([key, nested]) => [key, withoutOperationalRequestCounts(nested)]),
  );
};

const collect = async (): Promise<{
  left: ProfileSnapshot;
  right: ProfileSnapshot;
  fetchImpl: typeof fetch;
}> => {
  const leftFetch = createFixtureFetch(PERSONAS.strongMaintainer);
  const rightFetch = createFixtureFetch(PERSONAS.manyTinyRepos);
  const fetchImpl: typeof fetch = (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return href.toLowerCase().includes(PERSONAS.strongMaintainer.login)
      ? leftFetch(input, init)
      : rightFetch(input, init);
  };
  const [left, right] = await Promise.all([
    collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
      fetchImpl,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    }),
    collectProfileSnapshot(PERSONAS.manyTinyRepos.login, {
      fetchImpl,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    }),
  ]);
  if (!left.ok || !right.ok) throw new Error("fixture collection failed");
  return { left: left.snapshot, right: right.snapshot, fetchImpl };
};

const collectPair = async (
  leftPersona: PersonaSpec,
  rightPersona: PersonaSpec,
): Promise<{ left: ProfileSnapshot; right: ProfileSnapshot; fetchImpl: typeof fetch }> => {
  const leftFetch = createFixtureFetch(leftPersona);
  const rightFetch = createFixtureFetch(rightPersona);
  const fetchImpl: typeof fetch = (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return href.toLowerCase().includes(leftPersona.login.toLowerCase())
      ? leftFetch(input, init)
      : rightFetch(input, init);
  };
  const [left, right] = await Promise.all([
    collectProfileSnapshot(leftPersona.login, {
      fetchImpl,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    }),
    collectProfileSnapshot(rightPersona.login, {
      fetchImpl,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    }),
  ]);
  if (!left.ok || !right.ok) throw new Error("pair fixture collection failed");
  return { left: left.snapshot, right: right.snapshot, fetchImpl };
};

describe("complete deterministic source analysis", () => {
  it("uses the canonical battle story when neither side has a surviving source sample", async () => {
    const snapshots = await collectPair(
      { ...PERSONAS.lowPublicEvidence, login: "lowleft" },
      { ...PERSONAS.lowPublicEvidence, login: "lowright" },
    );
    const battle = buildBattle(
      scoreProfileFastScan(snapshots.left),
      scoreProfileFastScan(snapshots.right),
      { roast: "spicy" },
    );
    const result = await analyzeBattleSource({ battle, snapshots, fetchImpl: snapshots.fetchImpl });
    expect(result.sourceAnalysis.left.samples).toEqual([]);
    expect(result.sourceAnalysis.right.samples).toEqual([]);
    expect(result.sourceAnalysis.status).toBe("insufficient");
    expect(result.story).toMatchObject({
      basis: "canonical",
      planId: null,
      candidatePlanIds: [],
      sampleIds: [],
      leftRead: null,
      rightRead: null,
    });
    expect(result.story.finisher.text).toBe(battle.finishingMove.text);
    expect(JSON.stringify(result.story)).not.toMatch(
      /code signature|source style|compact source|abstract|ceremonial|systems depth/i,
    );
  });

  it("returns one source result and one fully inspectable authored story", async () => {
    const snapshots = await collect();
    const battle = buildBattle(
      scoreProfileFastScan(snapshots.left),
      scoreProfileFastScan(snapshots.right),
      { roast: "spicy" },
    );
    const result = await analyzeBattleSource({ battle, snapshots, fetchImpl: snapshots.fetchImpl });
    expect(["ready", "partial", "insufficient"]).toContain(result.sourceAnalysis.status);
    expect(result.sourceAnalysis.requestBudget.left.total).toBeLessThanOrEqual(16);
    expect(result.sourceAnalysis.requestBudget.right.total).toBeLessThanOrEqual(16);
    expect(result.sourceAnalysis.requestBudget.total).toBeLessThanOrEqual(32);
    expect(result.story.candidatePlanIds).toHaveLength(3);
    expect(result.story.basis).toBe("source");
    expect(result.story.leftRead?.sampleIds.length).toBeGreaterThan(0);
    expect(result.story.rightRead?.sampleIds.length).toBeGreaterThan(0);
    expect(result.story.finisher.sampleIds).toEqual(
      expect.arrayContaining([
        result.story.leftRead!.sampleIds[0],
        result.story.rightRead!.sampleIds[0],
      ]),
    );
    expect(result.story.finisher.text).toContain(
      `@${battle.left.username}/@${battle.right.username}`,
    );
    expect(result.story.finisher.evidenceIds.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('"content"');
  });

  it("is byte-identical for identical evidence and versions", async () => {
    const snapshots = await collect();
    const battle = buildBattle(
      scoreProfileFastScan(snapshots.left),
      scoreProfileFastScan(snapshots.right),
      { roast: "spicy" },
    );
    const first = await analyzeBattleSource({ battle, snapshots, fetchImpl: snapshots.fetchImpl });
    const second = await analyzeBattleSource({ battle, snapshots, fetchImpl: snapshots.fetchImpl });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("keeps analysis and authored story bytes stable within scoped cache population orders", async () => {
    const snapshots = await collect();
    const battle = buildBattle(
      scoreProfileFastScan(snapshots.left),
      scoreProfileFastScan(snapshots.right),
      { roast: "spicy" },
    );
    const scenario = async (order: readonly [number, number]) => {
      const cache = createFileCodeDnaCache({
        directory: mkdtempSync(join(tmpdir(), "gitmog-scope-order-")),
      });
      const execute = async (maxRequests: number) => {
        let calls = 0;
        const countedFetch: typeof fetch = (input, init) => {
          calls += 1;
          return snapshots.fetchImpl(input, init);
        };
        const result = await analyzeBattleSource({
          battle,
          snapshots,
          cache,
          maxRequests,
          fetchImpl: countedFetch,
        });
        return { calls, result };
      };
      const first = await execute(order[0]);
      const reused = await execute(order[0]);
      const second = await execute(order[1]);
      return { first, reused, second };
    };

    const lowHigh = await scenario([2, 10]);
    const highLow = await scenario([10, 2]);
    const lowA = lowHigh.first;
    const lowB = highLow.second;
    const highA = lowHigh.second;
    const highB = highLow.first;
    expect(lowA.result.sourceAnalysis.left.samples).toHaveLength(2);
    expect(lowA.result.sourceAnalysis.left.codeDna.status).toBe("partial");
    expect(highA.result.sourceAnalysis.left.samples).toHaveLength(3);
    expect(highA.result.sourceAnalysis.left.codeDna.status).toBe("ready");
    expect(lowA.result.sourceAnalysis.analysisKey).not.toBe(
      highA.result.sourceAnalysis.analysisKey,
    );
    expect(JSON.stringify(withoutOperationalRequestCounts(lowB.result))).toBe(
      JSON.stringify(withoutOperationalRequestCounts(lowA.result)),
    );
    expect(JSON.stringify(withoutOperationalRequestCounts(highB.result))).toBe(
      JSON.stringify(withoutOperationalRequestCounts(highA.result)),
    );
    expect(JSON.stringify(withoutOperationalRequestCounts(lowHigh.reused.result))).toBe(
      JSON.stringify(withoutOperationalRequestCounts(lowA.result)),
    );
    expect(JSON.stringify(withoutOperationalRequestCounts(highLow.reused.result))).toBe(
      JSON.stringify(withoutOperationalRequestCounts(highB.result)),
    );
    expect(lowHigh.reused.calls).toBe(0);
    expect(highLow.reused.calls).toBe(0);
  });

  it("preserves profile Code DNA while reversed order changes directional copy", async () => {
    const snapshots = await collect();
    const forwardBattle = buildBattle(
      scoreProfileFastScan(snapshots.left),
      scoreProfileFastScan(snapshots.right),
      { roast: "spicy" },
    );
    const reverseBattle = buildBattle(
      scoreProfileFastScan(snapshots.right),
      scoreProfileFastScan(snapshots.left),
      { roast: "spicy" },
    );
    const forward = await analyzeBattleSource({
      battle: forwardBattle,
      snapshots,
      fetchImpl: snapshots.fetchImpl,
    });
    const reverse = await analyzeBattleSource({
      battle: reverseBattle,
      snapshots: { left: snapshots.right, right: snapshots.left },
      fetchImpl: snapshots.fetchImpl,
    });
    expect(reverse.sourceAnalysis.left.codeDna).toEqual(forward.sourceAnalysis.right.codeDna);
    expect(reverse.sourceAnalysis.right.codeDna).toEqual(forward.sourceAnalysis.left.codeDna);
    expect(reverse.sourceAnalysis.left.samples.map((sample) => sample.sampleId)).toEqual(
      forward.sourceAnalysis.right.samples.map((sample) => sample.sampleId),
    );
    expect(reverse.sourceAnalysis.right.samples.map((sample) => sample.sampleId)).toEqual(
      forward.sourceAnalysis.left.samples.map((sample) => sample.sampleId),
    );
    expect(reverse.story.finisher.text).not.toBe(forward.story.finisher.text);
  });

  it("avoids immutable blob refetches on repeat and reversed battles", async () => {
    const snapshots = await collect();
    const calls: string[] = [];
    const countedFetch: typeof fetch = (input, init) => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(href);
      return snapshots.fetchImpl(input, init);
    };
    const derivedCache = createFileDerivedFeatureCache({
      directory: mkdtempSync(join(tmpdir(), "gitmog-derived-acceptance-")),
    });
    const cache = createFileCodeDnaCache({
      directory: mkdtempSync(join(tmpdir(), "gitmog-code-dna-acceptance-")),
    });
    const left = scoreProfileFastScan(snapshots.left);
    const right = scoreProfileFastScan(snapshots.right);
    const battle = buildBattle(left, right, { roast: "spicy" });
    const first = await analyzeBattleSource({
      battle,
      snapshots,
      fetchImpl: countedFetch,
      derivedCache,
      cache,
    });
    const firstBlobCalls = calls.filter((href) => href.includes("/git/blobs/")).length;
    expect(firstBlobCalls).toBeGreaterThan(0);
    const repeat = await analyzeBattleSource({
      battle,
      snapshots,
      fetchImpl: countedFetch,
      derivedCache,
      cache,
    });
    expect(calls.filter((href) => href.includes("/git/blobs/")).length).toBe(firstBlobCalls);
    expect(repeat.sourceAnalysis.requestBudget.total).toBe(0);
    expect(repeat.sourceAnalysis.requestBudget.left.metadata).toBe(0);
    expect(repeat.sourceAnalysis.requestBudget.right.metadata).toBe(0);
    expect(repeat.sourceAnalysis.requestBudget.left.source).toBe(0);
    expect(repeat.sourceAnalysis.requestBudget.right.source).toBe(0);
    expect(repeat.sourceAnalysis.left.codeDna).toEqual(first.sourceAnalysis.left.codeDna);
    expect(repeat.sourceAnalysis.right.codeDna).toEqual(first.sourceAnalysis.right.codeDna);
    expect(repeat.story).toEqual(first.story);
    expect(withoutOperationalRequestCounts(repeat)).toEqual(withoutOperationalRequestCounts(first));

    const reversedBattle = buildBattle(right, left, { roast: "spicy" });
    const reversed = await analyzeBattleSource({
      battle: reversedBattle,
      snapshots: { left: snapshots.right, right: snapshots.left },
      fetchImpl: countedFetch,
      derivedCache,
      cache,
    });
    expect(calls.filter((href) => href.includes("/git/blobs/")).length).toBe(firstBlobCalls);
    expect(withoutOperationalRequestCounts(reversed.sourceAnalysis.left.codeDna)).toEqual(
      withoutOperationalRequestCounts(first.sourceAnalysis.right.codeDna),
    );
    expect(withoutOperationalRequestCounts(reversed.sourceAnalysis.right.codeDna)).toEqual(
      withoutOperationalRequestCounts(first.sourceAnalysis.left.codeDna),
    );
  });
});
