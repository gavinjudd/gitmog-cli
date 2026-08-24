import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSnapshotCache, type ProfileSnapshot } from "@gitmog/github";
import {
  createFileQualityResultCache,
  isQualityJudgeResult,
  qualityResultValidationCode,
} from "@gitmog/quality-judge";
import { createFileCodeDnaCache, createFileDerivedFeatureCache } from "@gitmog/source-analysis";
import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
  type PersonaSpec,
} from "@gitmog/test-fixtures/github-personas";
import { describe, expect, it } from "vitest";

import {
  parseHandles,
  parseMatchup,
  prepareBattle,
  resolveRoast,
  runBattle,
  runCanonicalBattle,
  runProfile,
} from "../src/run.js";

const serve = (...personas: readonly PersonaSpec[]) => {
  const handlers = personas.map((persona) => ({
    login: persona.login,
    fetchImpl: createFixtureFetch(persona),
  }));
  const calls: string[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(href);
    const found = handlers.find((handler) =>
      href.toLowerCase().includes(handler.login.toLowerCase()),
    );
    return (
      found?.fetchImpl(input, init) ??
      Promise.resolve(new Response('{"message":"Not Found"}', { status: 404 }))
    );
  };
  return { fetchImpl, calls };
};
const base = { now: () => FIXTURE_NOW_MS, cache: null } as const;

describe("input contracts", () => {
  it("normalizes handles and rejects invalid or identical inputs", () => {
    expect(parseHandles("alice", "bob")).toEqual({ ok: true, left: "alice", right: "bob" });
    expect(parseHandles("not a handle", "bob")).toMatchObject({
      ok: false,
      error: { code: "invalid_handle" },
    });
    expect(parseHandles("Alice", "alice")).toMatchObject({
      ok: false,
      error: { code: "same_handle" },
    });
    expect(parseMatchup("alice-vs-bob")).toEqual({ left: "alice", right: "bob" });
    expect(resolveRoast("UNHINGED")).toBe("unhinged");
  });
});

describe("one complete orchestration path", () => {
  it("collects each profile once and returns battle, source analysis, and story", async () => {
    const transport = serve(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
    const result = await runBattle({
      left: "strongmaintainer",
      right: "sidequester",
      fetchImpl: transport.fetchImpl,
      ...base,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.battle.winner).toBe("left");
    expect(["ready", "partial", "insufficient"]).toContain(result.sourceAnalysis.status);
    expect(result.story.planId).toBeTruthy();
    expect(result.story.finisher.evidenceIds.length).toBeGreaterThan(0);
    expect(result.sourceAnalysis.requestBudget.total).toBeLessThanOrEqual(32);
    expect(result.qualityPreview.left.requestBudget.completeOpportunity).toBe(33);
    expect(result.qualityPreview.right.requestBudget.completeOpportunity).toBe(33);
    expect(result.qualityPreview.left.scoreInfluence).toBe(0);
    expect(result.qualityPreview.right.scoreInfluence).toBe(0);
    expect(JSON.stringify(result)).not.toContain('"content"');
    expect(
      transport.calls.filter((url) => new URL(url).pathname === "/users/strongmaintainer"),
    ).toHaveLength(1);
    expect(
      transport.calls.filter((url) => new URL(url).pathname === "/users/sidequester"),
    ).toHaveLength(1);
    expect(transport.calls.length).toBeLessThanOrEqual(98);
    for (const handle of ["strongmaintainer", "sidequester"]) {
      const profileCalls = transport.calls.filter((url) => {
        const path = new URL(url).pathname.toLowerCase();
        return path.startsWith(`/users/${handle}`) || path.startsWith(`/repos/${handle}/`);
      });
      expect(profileCalls.length, handle).toBeLessThanOrEqual(49);
    }
    const treeCalls = transport.calls.filter((url) =>
      new URL(url).pathname.includes("/git/trees/"),
    );
    const blobCalls = transport.calls.filter((url) =>
      new URL(url).pathname.includes("/git/blobs/"),
    );
    expect(new Set(treeCalls).size).toBe(treeCalls.length);
    const blobCallCounts = new Map<string, number>();
    for (const call of blobCalls) blobCallCounts.set(call, (blobCallCounts.get(call) ?? 0) + 1);
    expect(Math.max(...blobCallCounts.values())).toBeLessThanOrEqual(2);
  });

  it("reports real orchestration transitions without changing the canonical result", async () => {
    const instrumentedTransport = serve(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
    const events: string[] = [];
    const instrumented = await runBattle({
      left: "strongmaintainer",
      right: "sidequester",
      fetchImpl: instrumentedTransport.fetchImpl,
      onProgress: (event) => events.push(event.type),
      ...base,
    });
    const baselineTransport = serve(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
    const baseline = await runBattle({
      left: "strongmaintainer",
      right: "sidequester",
      fetchImpl: baselineTransport.fetchImpl,
      ...base,
    });

    expect(events).toEqual([
      "profile-collection-start",
      "repository-ranking-start",
      "profile-collection-complete",
      "repository-ranking-complete",
      "scoring-start",
      "scoring-complete",
      "source-analysis-start",
      "source-analysis-complete",
      "story-start",
      "story-complete",
      "quality-analysis-start",
      "quality-analysis-complete",
    ]);
    expect(instrumented.ok && baseline.ok).toBe(true);
    if (!instrumented.ok || !baseline.ok) return;
    expect(instrumented.battle).toEqual(baseline.battle);
    expect(instrumented.sourceAnalysis).toEqual(baseline.sourceAnalysis);
    expect(instrumented.story).toEqual(baseline.story);
  });

  it("keeps the canonical numeric result stable across roast modes", async () => {
    const run = async (roast: "clean" | "unhinged") => {
      const transport = serve(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
      return runBattle({
        left: "strongmaintainer",
        right: "sidequester",
        roast,
        fetchImpl: transport.fetchImpl,
        ...base,
      });
    };
    const clean = await run("clean");
    const sharp = await run("unhinged");
    expect(clean.ok && sharp.ok).toBe(true);
    if (!clean.ok || !sharp.ok) return;
    expect(clean.battle.left.overallScore).toBe(sharp.battle.left.overallScore);
    expect(clean.battle.right.overallScore).toBe(sharp.battle.right.overallScore);
    expect(clean.sourceAnalysis.left.codeDna).toEqual(sharp.sourceAnalysis.left.codeDna);
    expect(clean.story.finisher.text).not.toBe(sharp.story.finisher.text);
  });

  it("keeps incomparable rounds in the battle contract without changing numeric semantics", async () => {
    const preparedTransport = serve(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
    const prepared = await prepareBattle({
      left: "strongmaintainer",
      right: "sidequester",
      fetchImpl: preparedTransport.fetchImpl,
      ...base,
    });
    const publicTransport = serve(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
    const publicResult = await runBattle({
      left: "strongmaintainer",
      right: "sidequester",
      fetchImpl: publicTransport.fetchImpl,
      ...base,
    });
    expect(prepared.ok && publicResult.ok).toBe(true);
    if (!prepared.ok || !publicResult.ok) return;

    const numericContract = (battle: typeof prepared.battle) => ({
      scoringVersion: battle.scoringVersion,
      winner: battle.winner,
      margin: battle.margin,
      left: {
        overallScore: battle.left.overallScore,
        categoryScores: battle.left.categoryScores,
        measuredWeight: battle.left.confidence.measuredWeight,
      },
      right: {
        overallScore: battle.right.overallScore,
        categoryScores: battle.right.categoryScores,
        measuredWeight: battle.right.confidence.measuredWeight,
      },
    });
    const prePublicFilterFixture = {
      scoringVersion: "0.1.0-fast-scan",
      winner: "left",
      margin: 53,
      left: {
        overallScore: 92,
        categoryScores: {
          "craft.testing": 97.5,
          "ship.frequency": 87.9,
          "craft.tooling": 100,
          "craft.hygiene": 90,
          "ship.breadth": 85.3,
          "ship.substance": 95.7,
          "ship.discipline": 93.6,
          "craft.maintainability": 100,
        },
        measuredWeight: 59,
      },
      right: {
        overallScore: 39,
        categoryScores: {
          "craft.testing": 0,
          "ship.frequency": 55.3,
          "craft.tooling": 0,
          "craft.hygiene": 70,
          "ship.breadth": 25,
          "ship.substance": 67.1,
          "ship.discipline": 9.3,
          "craft.maintainability": 100,
        },
        measuredWeight: 54,
      },
    } as const;

    expect(numericContract(prepared.battle)).toEqual(prePublicFilterFixture);
    expect(numericContract(publicResult.battle)).toEqual(prePublicFilterFixture);
    expect(publicResult.battle.left.categories).toEqual(prepared.battle.left.categories);
    expect(publicResult.battle.right.categories).toEqual(prepared.battle.right.categories);
    expect(prepared.battle.rounds.some((round) => round.winner === "unscored")).toBe(true);
    expect(publicResult.battle.rounds).toEqual(prepared.battle.rounds);
    expect(publicResult.battle.rounds).toHaveLength(publicResult.battle.left.categories.length);
    expect(publicResult.battle.rounds.some((round) => round.winner === "unscored")).toBe(true);
    for (const card of [publicResult.battle.left, publicResult.battle.right]) {
      expect(card.categories.find((category) => category.id === "craft.quality")?.score).toBeNull();
      expect(card.confidence.limitations).toContain(
        "Source style remains separate from this numeric score version.",
      );
    }
  });

  it("keeps canonical-only and complete CLI battle objects byte-identical", async () => {
    const canonicalTransport = serve(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
    const completeTransport = serve(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
    const canonical = await runCanonicalBattle({
      left: "strongmaintainer",
      right: "sidequester",
      fetchImpl: canonicalTransport.fetchImpl,
      ...base,
    });
    const complete = await runBattle({
      left: "strongmaintainer",
      right: "sidequester",
      fetchImpl: completeTransport.fetchImpl,
      ...base,
    });
    expect(canonical.ok && complete.ok).toBe(true);
    if (!canonical.ok || !complete.ok) return;
    expect(JSON.stringify(canonical.battle)).toBe(JSON.stringify(complete.battle));
    expect(canonicalTransport.calls.some((url) => url.includes("/git/blobs/"))).toBe(false);
    expect(completeTransport.calls.some((url) => url.includes("/git/blobs/"))).toBe(true);
  });

  it("keeps every canonical battle byte invariant across arbitrary preview states", async () => {
    const run = async (quality: Parameters<typeof runBattle>[0]["quality"]) => {
      const transport = serve(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
      return runBattle({
        left: "strongmaintainer",
        right: "sidequester",
        fetchImpl: transport.fetchImpl,
        quality,
        ...base,
      });
    };
    const disabled = await run({ enabled: false });
    const partial = await run({
      enabled: true,
      sourceRequestCaps: { left: 5, right: 5 },
      attributionRequestCaps: { left: 0, right: 0 },
    });
    const ready = await run({ enabled: true });
    expect(disabled.ok && partial.ok && ready.ok).toBe(true);
    if (!disabled.ok || !partial.ok || !ready.ok) return;
    const canonical = JSON.stringify(disabled.battle);
    expect(JSON.stringify(partial.battle)).toBe(canonical);
    expect(JSON.stringify(ready.battle)).toBe(canonical);

    const arbitraryPreview = {
      ...ready.qualityPreview,
      left: {
        ...ready.qualityPreview.left,
        maintainedCodebase: {
          ...ready.qualityPreview.left.maintainedCodebase,
          previewScore: 0,
          coverage: 1,
        },
      },
      right: {
        ...ready.qualityPreview.right,
        maintainedCodebase: {
          ...ready.qualityPreview.right.maintainedCodebase,
          previewScore: 100,
          coverage: 100,
        },
      },
    };
    expect(JSON.stringify({ ...ready, qualityPreview: arbitraryPreview }.battle)).toBe(canonical);
  });

  it("reuses both profile snapshots in a reversed battle", async () => {
    const directory = mkdtempSync(join(tmpdir(), "gitmog-reversed-analysis-"));
    const cache = createSnapshotCache<ProfileSnapshot>();
    const transport = serve(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
    const sourceAnalysis = {
      cache: createFileCodeDnaCache({ directory: join(directory, "analysis") }),
      derivedCache: createFileDerivedFeatureCache({ directory: join(directory, "features") }),
    };
    const quality = {
      enabled: true,
      cache: createFileQualityResultCache({ directory: join(directory, "quality") }),
      cachePolicy: { read: true, write: true },
    } as const;
    const options = {
      fetchImpl: transport.fetchImpl,
      cache,
      now: () => FIXTURE_NOW_MS,
      sourceAnalysis,
      quality,
    };
    try {
      const forward = await runBattle({
        left: "strongmaintainer",
        right: "sidequester",
        ...options,
      });
      const after = transport.calls.length;
      if (forward.ok) {
        expect(
          isQualityJudgeResult(forward.qualityPreview.left),
          qualityResultValidationCode(forward.qualityPreview.left) ?? "valid",
        ).toBe(true);
        expect(
          isQualityJudgeResult(forward.qualityPreview.right),
          qualityResultValidationCode(forward.qualityPreview.right) ?? "valid",
        ).toBe(true);
        expect(quality.cache.size).toBe(2);
      }
      const reversed = await runBattle({
        left: "sidequester",
        right: "strongmaintainer",
        ...options,
      });
      expect(forward.ok && reversed.ok).toBe(true);
      expect(transport.calls).toHaveLength(after);
      if (!forward.ok || !reversed.ok) return;
      expect(reversed.sourceAnalysis.left.codeDna).toEqual(forward.sourceAnalysis.right.codeDna);
      expect(reversed.sourceAnalysis.right.codeDna).toEqual(forward.sourceAnalysis.left.codeDna);
      expect(reversed.qualityPreview.left).toEqual(forward.qualityPreview.right);
      expect(reversed.qualityPreview.right).toEqual(forward.qualityPreview.left);
      expect(reversed.battle.margin).toBe(forward.battle.margin);
      expect(reversed.story.finisher.text).not.toBe(forward.story.finisher.text);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns structured failures without fabricating scores", async () => {
    const transport = serve(PERSONAS.strongMaintainer, PERSONAS.notFound);
    const result = await runBattle({
      left: "strongmaintainer",
      right: "doesnotexist",
      fetchImpl: transport.fetchImpl,
      ...base,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });

    const rateLimitedTransport = serve(PERSONAS.strongMaintainer, PERSONAS.rateLimited);
    const rateLimited = await runBattle({
      left: "strongmaintainer",
      right: "ratelimited",
      fetchImpl: rateLimitedTransport.fetchImpl,
      ...base,
    });
    expect(rateLimited).toMatchObject({ ok: false, error: { code: "rate_limited" } });
  });

  it("keeps a valid numeric score when only the bounded source pass is rate limited", async () => {
    const sourceLimited = {
      ...PERSONAS.strongMaintainer,
      failures: { "/git/blobs/": 403 },
      rateLimitRemaining: 0,
    };
    const transport = serve(sourceLimited, PERSONAS.manyTinyRepos);
    const result = await runBattle({
      left: "strongmaintainer",
      right: "sidequester",
      fetchImpl: transport.fetchImpl,
      ...base,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.battle.left.overallScore).toBe(92);
    expect(result.battle.winner).toBe("left");
    expect(result.sourceAnalysis.left.codeDna).toMatchObject({
      status: "insufficient",
      sourceFailureReason: "rate-limited",
    });
    expect(result.sourceAnalysis.left.samples).toEqual([]);
    expect("label" in result.sourceAnalysis.left.codeDna).toBe(false);
    expect(result.sourceAnalysis.requestBudget.left.total).toBeLessThanOrEqual(16);
    expect(result.sourceAnalysis.requestBudget.total).toBeLessThanOrEqual(32);
    expect(result.sourceAnalysis.status).toBe("partial");
  });

  it("runs Code DNA automatically for a one-profile command", async () => {
    const transport = serve(PERSONAS.strongMaintainer);
    const result = await runProfile({
      handle: "strongmaintainer",
      fetchImpl: transport.fetchImpl,
      ...base,
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(["ready", "partial", "insufficient"]).toContain(result.sourceAnalysis.status);
  });
});
