import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRESENTATION_VERSIONS,
  battleKeyFor,
  buildBattle,
} from "../src/fast-scan/battle.js";
import { scoreProfileFastScan } from "../src/fast-scan/scorecard.js";
import { classifyVerdict } from "../src/fast-scan/verdict.js";
import type { ProfileScorecard, RoastMode } from "../src/fast-scan/types.js";
import { PERSONAS, scorecardFor, snapshotFor } from "./helpers.js";

const battleOf = async (
  left: keyof typeof PERSONAS,
  right: keyof typeof PERSONAS,
  roast: RoastMode = "spicy",
) => buildBattle(await scorecardFor(left), await scorecardFor(right), { roast });

describe("verdict classes", () => {
  it.each([
    [0, "mutual-aura", "MUTUAL AURA"],
    [1, "photo-finish", "PHOTO FINISH"],
    [2, "photo-finish", "PHOTO FINISH"],
    [3, "aura-edge", "AURA EDGE"],
    [5, "aura-edge", "AURA EDGE"],
    [6, "clean-mog", "CLEAN MOG"],
    [11, "clean-mog", "CLEAN MOG"],
    [12, "extreme-diff", "EXTREME DIFF"],
    [19, "extreme-diff", "EXTREME DIFF"],
    [20, "nuclear-repo-gap", "NUCLEAR REPO GAP"],
    [97, "nuclear-repo-gap", "NUCLEAR REPO GAP"],
  ])("classifies a %s point margin as %s", (margin, id, label) => {
    const verdict = classifyVerdict(margin);
    expect(verdict.id).toBe(id);
    expect(verdict.label).toBe(label);
  });
});

describe("buildBattle", () => {
  it("produces a byte-identical result for the same inputs", async () => {
    const left = await scorecardFor("strongMaintainer");
    const right = await scorecardFor("manyTinyRepos");
    const first = buildBattle(left, right, { roast: "spicy" });
    const second = buildBattle(left, right, { roast: "spicy" });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("derives the battle key from handles, version, snapshots and roast", async () => {
    const left = await scorecardFor("strongMaintainer");
    const right = await scorecardFor("manyTinyRepos");
    const spicy = buildBattle(left, right, { roast: "spicy" });
    const clean = buildBattle(left, right, { roast: "clean" });
    const swapped = buildBattle(right, left, { roast: "spicy" });
    expect(spicy.battleKey).not.toBe(clean.battleKey);
    expect(spicy.battleKey).not.toBe(swapped.battleKey);
    expect(spicy.createdFromSnapshotKeys).toEqual([left.snapshotKey, right.snapshotKey]);
    expect(spicy.scoringVersion).toBe("0.1.0-fast-scan");
    expect(spicy.mogsonaVersion).toBe(DEFAULT_PRESENTATION_VERSIONS.mogsona);
    expect(spicy.auraLeakVersion).toBe(DEFAULT_PRESENTATION_VERSIONS.auraLeak);
    expect(spicy.memeEngineVersion).toBe(DEFAULT_PRESENTATION_VERSIONS.memeEngine);
    expect(spicy.memeEngineVersion).toBe("1.5.0-human-readability-copy");
    expect(
      battleKeyFor(left, right, "spicy", {
        ...DEFAULT_PRESENTATION_VERSIONS,
        memeEngine: "1.1.0-release-copy",
      }),
    ).not.toBe(spicy.battleKey);
  });

  it("names the higher canonical score as the winner", async () => {
    const battle = await battleOf("strongMaintainer", "manyTinyRepos");
    const expected =
      battle.left.overallScore === battle.right.overallScore
        ? "tie"
        : battle.left.overallScore > battle.right.overallScore
          ? "left"
          : "right";
    expect(battle.winner).toBe(expected);
    expect(battle.margin).toBe(Math.abs(battle.left.overallScore - battle.right.overallScore));
  });

  it("keeps the same winner when the challenger order is reversed", async () => {
    const forward = await battleOf("strongMaintainer", "manyTinyRepos");
    const reversed = await battleOf("manyTinyRepos", "strongMaintainer");
    expect(reversed.margin).toBe(forward.margin);
    expect(reversed.right.overallScore).toBe(forward.left.overallScore);
    expect(reversed.left.overallScore).toBe(forward.right.overallScore);
    expect(reversed.verdictClass).toBe(forward.verdictClass);
  });

  it("gives every category a round with a winner and a line", async () => {
    const battle = await battleOf("strongMaintainer", "unsupportedLanguages");
    expect(battle.rounds.length).toBe(battle.left.categories.length);
    for (const round of battle.rounds) {
      expect(["left", "right", "tie", "unscored"]).toContain(round.winner);
      expect(round.line.text.length).toBeGreaterThan(10);
      expect(round.memeLabel).toMatch(/^[A-Z ]+$/);
      expect(round.subtitle.length).toBeGreaterThan(20);
      if (round.winner === "left") expect(round.leftScore).toBeGreaterThan(round.rightScore ?? 0);
      if (round.winner === "right") expect(round.rightScore).toBeGreaterThan(round.leftScore ?? 0);
      if (round.winner === "unscored") {
        expect(round.leftScore === null || round.rightScore === null).toBe(true);
      }
    }
  });

  it("marks the code-quality round as unscored rather than zero", async () => {
    const battle = await battleOf("strongMaintainer", "manyTinyRepos");
    const round = battle.rounds.find((candidate) => candidate.categoryId === "craft.quality");
    expect(round?.winner).toBe("unscored");
    expect(round?.leftScore).toBeNull();
    expect(round?.line.text).toContain("Excluded from this numeric score");
  });

  it("changes only phrasing when the roast mode changes", async () => {
    const left = await scorecardFor("strongMaintainer");
    const right = await scorecardFor("manyTinyRepos");
    const modes: RoastMode[] = ["clean", "spicy", "unhinged"];
    const battles = modes.map((roast) => buildBattle(left, right, { roast }));
    const invariant = (card: ProfileScorecard) =>
      JSON.stringify({
        score: card.overallScore,
        grade: card.grade,
        categories: card.categoryScores,
        confidence: card.confidence,
        evidence: card.evidence,
      });

    for (const battle of battles) {
      expect(battle.winner).toBe(battles[0]?.winner);
      expect(battle.margin).toBe(battles[0]?.margin);
      expect(battle.verdictClass).toBe(battles[0]?.verdictClass);
      expect(invariant(battle.left)).toBe(invariant(battles[0]?.left as ProfileScorecard));
      expect(invariant(battle.right)).toBe(invariant(battles[0]?.right as ProfileScorecard));
      expect(battle.rounds.map((round) => [round.categoryId, round.winner])).toEqual(
        battles[0]?.rounds.map((round) => [round.categoryId, round.winner]),
      );
    }

    const finishers = new Set(battles.map((battle) => battle.finishingMove.text));
    expect(finishers.size).toBeGreaterThan(1);
  });

  it("gives both sides a real strength and at most one weakness", async () => {
    const battle = await battleOf("strongMaintainer", "manyTinyRepos");
    for (const side of ["left", "right"] as const) {
      expect(battle.strengths[side].text.length).toBeGreaterThan(10);
      const weakness = battle.weaknesses[side];
      if (weakness !== null) expect(weakness.text.length).toBeGreaterThan(10);
    }
  });

  it("surfaces a public evidence diff when confidence differs materially", async () => {
    const battle = await battleOf("strongMaintainer", "lowPublicEvidence");
    expect(battle.evidenceDiff).not.toBeNull();
    expect(battle.evidenceDiff?.summary).toContain("not equally well evidenced");
  });

  it("builds a direct share caption without platform-handle ambiguity", async () => {
    const battle = await battleOf("strongMaintainer", "manyTinyRepos", "spicy");
    expect(battle.shareCaption).toContain("SCORE —");
    expect(battle.shareCaption).toContain("SCORE COVERAGE —");
    expect(battle.shareCaption).toContain(battle.finishingMove.text);
    expect(battle.shareCaption).not.toContain("Public GitHub evidence");
    expect(battle.shareCaption).not.toMatch(/@\w/);
  });

  it("keeps the card finisher inside the share-card budget", async () => {
    for (const roast of ["clean", "spicy", "unhinged"] as const) {
      const battle = await battleOf("strongMaintainer", "manyTinyRepos", roast);
      expect(battle.cardFinisher.length).toBeLessThanOrEqual(92);
      expect(battle.cardFinisher.length).toBeGreaterThan(5);
    }
  });

  it("produces a tie verdict when both scores match", async () => {
    const card = await scorecardFor("strongMaintainer");
    const twin: ProfileScorecard = { ...card, username: "twin", snapshotKey: "twin-snapshot" };
    const battle = buildBattle(card, twin, { roast: "spicy" });
    expect(battle.winner).toBe("tie");
    expect(battle.margin).toBe(0);
    expect(battle.verdictClass).toBe("mutual-aura");
    expect(battle.headline).toContain("ARE LEVEL");
  });

  it.each([
    ["clean", " --roast clean"],
    ["spicy", ""],
    ["unhinged", " --roast unhinged"],
  ] as const)("builds exact authoritative %s challenge commands", async (roast, flag) => {
    const left = await scorecardFor("strongMaintainer");
    const right = await scorecardFor("manyTinyRepos");
    const battle = buildBattle(left, right, { roast });
    expect(battle.winner).toBe("left");
    expect(battle.challenge).toEqual({
      canonical: `npx -y gitmog ${left.username} ${right.username}${flag}`,
      runItBack: `npx -y gitmog ${right.username} ${left.username}${flag}`,
      nextVictim: `npx -y gitmog ${left.username} <handle>${flag}`,
      shareReceipt: `npx -y gitmog ${left.username} ${right.username}${flag} --share x`,
    });
  });

  it("preserves order, winner, tie handling, and long handles in challenge commands", async () => {
    const strong = await scorecardFor("strongMaintainer");
    const weak = await scorecardFor("manyTinyRepos");
    const reversed = buildBattle(weak, strong, { roast: "clean" });
    expect(reversed.winner).toBe("right");
    expect(reversed.challenge).toEqual({
      canonical: `npx -y gitmog ${weak.username} ${strong.username} --roast clean`,
      runItBack: `npx -y gitmog ${strong.username} ${weak.username} --roast clean`,
      nextVictim: `npx -y gitmog ${strong.username} <handle> --roast clean`,
      shareReceipt: `npx -y gitmog ${weak.username} ${strong.username} --roast clean --share x`,
    });

    const leftHandle = "a".repeat(39);
    const rightHandle = "b".repeat(39);
    const left: ProfileScorecard = { ...strong, username: leftHandle, snapshotKey: "long-left" };
    const right: ProfileScorecard = { ...strong, username: rightHandle, snapshotKey: "long-right" };
    const tie = buildBattle(left, right, { roast: "unhinged" });
    expect(tie.winner).toBe("tie");
    expect(tie.challenge).toEqual({
      canonical: `npx -y gitmog ${leftHandle} ${rightHandle} --roast unhinged`,
      runItBack: `npx -y gitmog ${rightHandle} ${leftHandle} --roast unhinged`,
      nextVictim: `npx -y gitmog ${leftHandle} <handle> --roast unhinged`,
      shareReceipt: `npx -y gitmog ${leftHandle} ${rightHandle} --roast unhinged --share x`,
    });
  });

  it("scores a battle built from a live-recorded snapshot", async () => {
    const snapshot = await snapshotFor(PERSONAS.oneRepoHighImpact);
    const card = scoreProfileFastScan(snapshot);
    expect(card.overallScore).toBeGreaterThan(0);
    expect(card.overallScore).toBeLessThanOrEqual(100);
  });
});
