import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildBattle } from "../src/fast-scan/battle.js";
import type { BattleResult, ProfileScorecard } from "../src/fast-scan/types.js";
import { scorecardFor } from "./helpers.js";

/**
 * The golden file is the regression net for the whole pipeline: fixture responses →
 * collector → analyzer → scorecard → battle → meme engine. Any change to a curve, a
 * threshold, a template or a selection rule shows up here as a diff.
 *
 * Regenerate deliberately with `GITMOG_UPDATE_GOLDEN=1 pnpm --filter @gitmog/scoring test`
 * and review the diff before keeping it.
 */
const GOLDEN_URL = new URL("./fixtures/battle.golden.json", import.meta.url);

const summarizeCard = (card: ProfileScorecard) => ({
  username: card.username,
  overallScore: card.overallScore,
  grade: card.grade,
  categoryScores: card.categoryScores,
  confidence: {
    grade: card.confidence.grade,
    score: card.confidence.score,
    measuredWeight: card.confidence.measuredWeight,
    analyzedRepositories: card.confidence.analyzedRepositories,
    treeCoverage: card.confidence.treeCoverage,
  },
  mogsona: card.mogsona,
  auraLeak: card.auraLeak,
  metrics: card.metrics.map((metric) => ({
    id: metric.id,
    availability: metric.availability,
    earned: metric.earned,
  })),
  evidenceIds: card.evidence.map((item) => item.id),
});

const summarize = (battle: BattleResult) => ({
  scoringVersion: battle.scoringVersion,
  presentationVersion: battle.presentationVersion,
  mogsonaVersion: battle.mogsonaVersion,
  auraLeakVersion: battle.auraLeakVersion,
  memeEngineVersion: battle.memeEngineVersion,
  battleKey: battle.battleKey,
  winner: battle.winner,
  margin: battle.margin,
  verdictClass: battle.verdictClass,
  headline: battle.headline,
  narrative: battle.narrative,
  identity: battle.identity,
  finishingMove: battle.finishingMove,
  cardFinisher: battle.cardFinisher,
  rounds: battle.rounds.map((round) => ({
    categoryId: round.categoryId,
    leftScore: round.leftScore,
    rightScore: round.rightScore,
    winner: round.winner,
    line: round.line.text,
    templateId: round.line.templateId,
  })),
  strengths: battle.strengths,
  weaknesses: battle.weaknesses,
  battleSummary: battle.battleSummary.map((line) => line.text),
  shareCaption: battle.shareCaption,
  left: summarizeCard(battle.left),
  right: summarizeCard(battle.right),
});

describe("golden battle", () => {
  it("matches the committed golden file exactly", async () => {
    const battle = buildBattle(
      await scorecardFor("strongMaintainer"),
      await scorecardFor("manyTinyRepos"),
      { roast: "spicy", siteUrl: "https://gitmog.test" },
    );
    const actual = `${JSON.stringify(summarize(battle), null, 2)}\n`;

    if (process.env["GITMOG_UPDATE_GOLDEN"] === "1") {
      writeFileSync(GOLDEN_URL, actual);
    }
    expect(actual).toBe(readFileSync(GOLDEN_URL, "utf8"));
  });
});
