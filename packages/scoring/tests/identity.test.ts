import { describe, expect, it } from "vitest";

import { MOGSONA_DEFINITIONS } from "../src/identity/mogsona-catalog.js";
import { AURA_LEAK_DEFINITIONS } from "../src/identity/aura-leak-catalog.js";
import { assignIdentity, compareIdentityCandidates } from "../src/identity/classify.js";
import { auraClassRank } from "../src/identity/types.js";
import { buildBattle } from "../src/fast-scan/battle.js";
import { scoreProfileFastScan } from "../src/fast-scan/scorecard.js";

import { PERSONAS, scorecardFor, snapshotFor } from "./helpers.js";

describe("deterministic Mogsona assignment", () => {
  it("assigns a stable primary identity with valid evidence", async () => {
    const card = await scorecardFor("strongMaintainer");
    expect(card.mogsona.id).toBe("ship_goblin");
    expect(card.mogsona.name).toBe("SHIP GOBLIN");
    expect(card.mogsona.evidenceIds.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(card.evidence.map((item) => item.id));
    for (const id of card.mogsona.evidenceIds) expect(ids.has(id)).toBe(true);

    const rerun = await scorecardFor("strongMaintainer");
    expect(JSON.stringify(rerun.mogsona)).toBe(JSON.stringify(card.mogsona));
  });

  it("breaks exact candidate ties by stable id", () => {
    const candidates = [
      { id: "zeta", signalScore: 0.7 },
      { id: "alpha", signalScore: 0.7 },
      { id: "middle", signalScore: 0.8 },
    ].sort(compareIdentityCandidates);
    expect(candidates.map((entry) => entry.id)).toEqual(["middle", "alpha", "zeta"]);
  });

  it("falls back to STEALTH BUILDER on low public evidence without framing it as failure", async () => {
    const card = await scorecardFor("lowPublicEvidence");
    expect(card.mogsona.id).toBe("stealth_builder");
    expect(card.mogsona.auraClass).toBe("unrated");
    expect(card.mogsona.summary.toLowerCase()).toContain("evidence");
    expect(card.mogsona.summary.toLowerCase()).not.toContain("failed");
    expect(card.auraLeak).toBeNull();
  });

  it("does not let low confidence become Rare or Mythic", async () => {
    const low = await scorecardFor("lowPublicEvidence");
    expect(auraClassRank(low.mogsona.auraClass)).toBeLessThan(auraClassRank("rare"));

    for (const name of ["manyTinyRepos", "frameworkTourist", "forkCollector"] as const) {
      const card = await scorecardFor(name);
      if (card.confidence.score < 55) {
        expect(auraClassRank(card.mogsona.auraClass), name).toBeLessThan(auraClassRank("rare"));
      }
    }
  });

  it("gives Mythic only to a definition whose strict gate is open", async () => {
    const card = await scorecardFor("strongMaintainer");
    expect(card.mogsona.auraClass).toBe("mythic");
    const definition = MOGSONA_DEFINITIONS.find((entry) => entry.id === card.mogsona.id);
    expect(definition).toBeDefined();
    const identity = assignIdentity(card);
    const chosen = identity.mogsonaCandidates.find((candidate) => candidate.id === card.mogsona.id);
    expect(chosen?.eligible).toBe(true);

    // The release-heavy profile has more tags but is stale, so the broad Mythic gate
    // does not open and the narrower RELEASE GOBLIN is capped at Rare.
    const release = await scorecardFor("releaseHeavy");
    expect(release.mogsona.id).toBe("release_goblin");
    expect(release.mogsona.auraClass).not.toBe("mythic");
  });

  it("never makes a negative-only signal the primary identity", async () => {
    for (const name of [
      "manyTinyRepos",
      "repoGraveyard",
      "forkCollector",
      "readmeCeo",
      "fixLooper",
      "frameworkTourist",
    ] as const) {
      const card = await scorecardFor(name);
      const definition = MOGSONA_DEFINITIONS.find((entry) => entry.id === card.mogsona.id);
      expect(definition?.polarity, name).not.toBe("negative");
      if (card.auraLeak !== null) {
        expect(AURA_LEAK_DEFINITIONS.some((entry) => entry.id === card.auraLeak?.id)).toBe(true);
      }
    }
  });

  it("is independent of the opponent and roast mode", async () => {
    const subject = await scorecardFor("strongMaintainer");
    const weak = await scorecardFor("manyTinyRepos");
    const close = await scorecardFor("archivedPortfolio");

    const identities = [
      buildBattle(subject, weak, { roast: "clean" }).left.mogsona,
      buildBattle(subject, weak, { roast: "spicy" }).left.mogsona,
      buildBattle(subject, weak, { roast: "unhinged" }).left.mogsona,
      buildBattle(subject, close, { roast: "spicy" }).left.mogsona,
    ];
    expect(new Set(identities.map((entry) => JSON.stringify(entry))).size).toBe(1);
  });

  it("cannot be assigned from popularity alone", async () => {
    const snapshot = await snapshotFor(PERSONAS.strongMaintainer);
    const baseline = scoreProfileFastScan(snapshot);
    const popular = scoreProfileFastScan({
      ...snapshot,
      repositories: snapshot.repositories.map((repository) => ({
        ...repository,
        stars: repository.stars + 250_000,
        forks: repository.forks + 90_000,
      })),
    });
    expect(popular.overallScore).toBe(baseline.overallScore);
    expect(popular.mogsona.id).toBe(baseline.mogsona.id);
    expect(popular.mogsona.signalScore).toBe(baseline.mogsona.signalScore);
  });

  it("assigns only labels that exist in the active catalog", async () => {
    const ids = new Set(MOGSONA_DEFINITIONS.map((entry) => entry.id));
    for (const name of Object.keys(PERSONAS) as (keyof typeof PERSONAS)[]) {
      const persona = PERSONAS[name];
      if ("userStatus" in persona && persona.userStatus !== undefined) continue;
      if (persona.repos.length === 0) continue;
      const card = scoreProfileFastScan(await snapshotFor(persona));
      expect(ids.has(card.mogsona.id), name).toBe(true);
    }
  });
});

describe("deterministic Aura Leak assignment", () => {
  it("emits at most one, with valid evidence", async () => {
    const card = await scorecardFor("repoGraveyard");
    expect(card.auraLeak?.id).toBe("repo_graveyard");
    expect(Array.isArray(card.auraLeak)).toBe(false);
    const ids = new Set(card.evidence.map((item) => item.id));
    for (const id of card.auraLeak?.evidenceIds ?? []) expect(ids.has(id)).toBe(true);
  });

  it("returns null when no negative signal qualifies", async () => {
    expect((await scorecardFor("strongMaintainer")).auraLeak).toBeNull();
  });

  it("excludes deliberately archived projects from Repo Graveyard", async () => {
    const archived = await scorecardFor("archiveDiscipline");
    expect(archived.diagnostics.archivedRepositories).toBeGreaterThanOrEqual(3);
    expect(archived.auraLeak?.id).not.toBe("repo_graveyard");
  });

  it("excludes tiny experiments from Repo Graveyard", async () => {
    const tiny = await scorecardFor("manyTinyRepos");
    expect(tiny.diagnostics.publicRepositories).toBeGreaterThan(8);
    expect(tiny.auraLeak?.id).not.toBe("repo_graveyard");
  });

  it("keeps the underlying Aura Leak id constant across roast modes", async () => {
    const left = await scorecardFor("strongMaintainer");
    const right = await scorecardFor("repoGraveyard");
    const ids = ["clean", "spicy", "unhinged"].map(
      (roast) =>
        buildBattle(left, right, { roast: roast as "clean" | "spicy" | "unhinged" }).right.auraLeak
          ?.id,
    );
    expect(new Set(ids).size).toBe(1);
  });
});
