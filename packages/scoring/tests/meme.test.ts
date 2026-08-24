import { describe, expect, it } from "vitest";

import { ATOM_BY_ID, ATOM_TOKEN_NAMES, MEME_ATOMS, evaluateAtoms } from "../src/meme/atoms.js";
import { buildBattle } from "../src/fast-scan/battle.js";
import { fnv1a32, MemeEngine } from "../src/meme/engine.js";
import { selectTheme } from "../src/meme/narrative.js";
import { findSafetyViolations } from "../src/meme/safety.js";
import { MEME_TEMPLATES, TEMPLATE_COUNTS } from "../src/meme/templates.js";
import { ROAST_MODES, type MemeLine, type RoastMode } from "../src/fast-scan/types.js";
import { PERSONAS, scorecardFor } from "./helpers.js";

const PERSONA_NAMES = [
  "strongMaintainer",
  "highActivityLowImpact",
  "oneRepoHighImpact",
  "manyTinyRepos",
  "archivedPortfolio",
  "lowPublicEvidence",
  "unsupportedLanguages",
  "partialTreeFailure",
] as const;

const PAIRS: readonly (readonly [
  (typeof PERSONA_NAMES)[number],
  (typeof PERSONA_NAMES)[number],
])[] = [
  ["strongMaintainer", "manyTinyRepos"],
  ["highActivityLowImpact", "oneRepoHighImpact"],
  ["archivedPortfolio", "lowPublicEvidence"],
  ["unsupportedLanguages", "strongMaintainer"],
  ["partialTreeFailure", "highActivityLowImpact"],
  ["lowPublicEvidence", "manyTinyRepos"],
];

const allLines = (battle: ReturnType<typeof buildBattle>): MemeLine[] => [
  battle.narrative.matchupLine,
  battle.identity.left.mogsonaLine,
  battle.identity.right.mogsonaLine,
  ...[battle.identity.left.auraLeakLine, battle.identity.right.auraLeakLine].filter(
    (line): line is MemeLine => line !== null,
  ),
  battle.finishingMove,
  ...battle.rounds.map((round) => round.line),
  battle.strengths.left,
  battle.strengths.right,
  ...[battle.weaknesses.left, battle.weaknesses.right].filter(
    (line): line is MemeLine => line !== null,
  ),
  ...battle.battleSummary,
];

describe("meme template library", () => {
  it("meets the required template counts", () => {
    expect(TEMPLATE_COUNTS.finisher).toBeGreaterThanOrEqual(30);
    expect(TEMPLATE_COUNTS.tie).toBeGreaterThanOrEqual(10);
    expect(TEMPLATE_COUNTS.round).toBeGreaterThanOrEqual(20);
    expect(TEMPLATE_COUNTS.strength).toBeGreaterThanOrEqual(12);
    expect(TEMPLATE_COUNTS.weakness).toBeGreaterThanOrEqual(12);
    expect(TEMPLATE_COUNTS.lowEvidence).toBeGreaterThanOrEqual(8);
  });

  it("gives every template a unique id and one line per roast mode", () => {
    const ids = new Set<string>();
    for (const template of MEME_TEMPLATES) {
      expect(ids.has(template.id), template.id).toBe(false);
      ids.add(template.id);
      for (const mode of ROAST_MODES) {
        expect(template.text[mode], `${template.id}:${mode}`).toBeTypeOf("string");
        expect(template.text[mode].length, `${template.id}:${mode}`).toBeGreaterThan(8);
      }
    }
  });

  it("binds every template to a registered atom", () => {
    const atomIds = new Set(MEME_ATOMS.map((atom) => atom.id));
    for (const template of MEME_TEMPLATES) {
      expect(template.atoms.length, template.id).toBeGreaterThan(0);
      for (const atomId of template.atoms)
        expect(atomIds.has(atomId), `${template.id}:${atomId}`).toBe(true);
      for (const atomId of template.atoms) {
        const atom = MEME_ATOMS.find((candidate) => candidate.id === atomId);
        expect(atom?.slots, `${template.id}:${atomId}`).toContain(template.slot);
      }
    }
  });

  it("interpolates only tokens the bound atoms supply", () => {
    for (const template of MEME_TEMPLATES) {
      const supplied = new Set(["subject", "opponent"]);
      for (const atomId of template.atoms) {
        for (const token of ATOM_TOKEN_NAMES[atomId] ?? []) supplied.add(token);
      }
      const variants = [template.text, ...(template.short === undefined ? [] : [template.short])];
      for (const variant of variants) {
        for (const mode of ROAST_MODES) {
          for (const match of variant[mode].matchAll(/\{(\w+)\}/g)) {
            expect(supplied.has(match[1] ?? ""), `${template.id} uses {${match[1] ?? ""}}`).toBe(
              true,
            );
          }
        }
      }
    }
  });

  it("passes the content-safety deny list in every roast mode", () => {
    for (const template of MEME_TEMPLATES) {
      const variants = [template.text, ...(template.short === undefined ? [] : [template.short])];
      for (const variant of variants) {
        for (const mode of ROAST_MODES) {
          expect(findSafetyViolations(variant[mode]), `${template.id}:${mode}`).toEqual([]);
        }
      }
    }
  });

  it("keeps clean mode free of the sharpest atoms", () => {
    const cleanOnlyAtoms = MEME_ATOMS.filter((atom) => !atom.roastModes.includes("clean"));
    expect(cleanOnlyAtoms.map((atom) => atom.id)).toEqual(
      expect.arrayContaining(["docs_without_shipping", "high_fork_ratio"]),
    );
  });

  it("declares a token registry entry for every atom", () => {
    for (const atom of MEME_ATOMS) {
      expect(ATOM_TOKEN_NAMES[atom.id], atom.id).toBeDefined();
    }
  });
});

describe("meme engine", () => {
  it("selects a deterministic narrative theme from an atom that actually fired", async () => {
    const left = await scorecardFor("strongMaintainer");
    const right = await scorecardFor("manyTinyRepos");
    const first = selectTheme(left, right, 53, "spicy");
    const second = selectTheme(left, right, 53, "spicy");
    expect(first).toEqual(second);
    expect(ATOM_BY_ID.has(first.dominantAtomId)).toBe(true);
    expect(first.evidenceIds.length).toBeGreaterThan(0);
  });

  it("carries the theme, dominant atom and evidence-backed matchup line on the battle", async () => {
    const battle = buildBattle(
      await scorecardFor("strongMaintainer"),
      await scorecardFor("manyTinyRepos"),
      { roast: "spicy" },
    );
    expect(battle.narrative.themeId.length).toBeGreaterThan(3);
    expect(battle.narrative.dominantAtomId).not.toBe("");
    expect(battle.narrative.matchupLine.text.length).toBeGreaterThan(8);
    expect(battle.narrative.matchupLine.evidenceIds.length).toBeGreaterThan(0);
  });

  it("selects with a hash rather than a random number", () => {
    expect(fnv1a32("gitmog")).toBe(fnv1a32("gitmog"));
    expect(fnv1a32("gitmog")).not.toBe(fnv1a32("gitmoh"));
  });

  it("produces exactly the tokens its registry declares when an atom fires", async () => {
    const subject = await scorecardFor("strongMaintainer");
    const opponent = await scorecardFor("manyTinyRepos");
    for (const roast of ROAST_MODES) {
      for (const [subjectSide, cards] of [
        ["left", [subject, opponent]],
        ["right", [opponent, subject]],
      ] as const) {
        const fired = evaluateAtoms(
          {
            subject: cards[0],
            opponent: cards[1],
            subjectSide,
            margin: Math.abs(subject.overallScore - opponent.overallScore),
          },
          roast,
        );
        for (const [atomId, facts] of fired) {
          expect(Object.keys(facts.tokens).sort(), atomId).toEqual(
            [...(ATOM_TOKEN_NAMES[atomId] ?? [])].sort(),
          );
        }
      }
    }
  });

  it.each(PAIRS)("keeps %s vs %s free of duplicate lines and unlinked claims", async (a, b) => {
    for (const roast of ROAST_MODES) {
      const battle = buildBattle(await scorecardFor(a), await scorecardFor(b), { roast });
      const lines = allLines(battle);

      const texts = lines.map((line) => line.text);
      expect(new Set(texts).size, `${a}/${b}/${roast}`).toBe(texts.length);

      const templateIds = lines
        .map((line) => line.templateId)
        .filter((id) => !id.startsWith("system."));
      expect(new Set(templateIds).size).toBe(templateIds.length);

      const evidenceIds = new Set([
        ...battle.left.evidence.map((item) => item.id),
        ...battle.right.evidence.map((item) => item.id),
      ]);
      for (const line of lines) {
        for (const id of line.evidenceIds) {
          expect(evidenceIds.has(id), `${line.templateId} cites missing evidence ${id}`).toBe(true);
        }
        expect(line.text, line.templateId).not.toMatch(/\{\w+\}/);
        expect(findSafetyViolations(line.text), line.templateId).toEqual([]);
      }
    }
  });

  it.each(PAIRS)("keeps every %s vs %s line inside its length budget", async (a, b) => {
    for (const roast of ROAST_MODES) {
      const battle = buildBattle(await scorecardFor(a), await scorecardFor(b), { roast });
      for (const line of allLines(battle)) {
        expect(line.text.length, `${line.templateId}:${roast}`).toBeLessThanOrEqual(150);
      }
      expect(battle.cardFinisher.length).toBeLessThanOrEqual(92);
    }
  });

  it("falls back to the verdict atom when no evidence atom qualifies", async () => {
    const card = await scorecardFor("lowPublicEvidence");
    const twin = { ...card, username: "otherghost", snapshotKey: "other" };
    const battle = buildBattle(card, twin, { roast: "spicy" });
    expect(battle.finishingMove.text.length).toBeGreaterThan(5);
    expect(battle.finishingMove.text).not.toMatch(/\{\w+\}/);
  });

  it("emits a limited-evidence line when a profile is barely public", async () => {
    const battle = buildBattle(
      await scorecardFor("strongMaintainer"),
      await scorecardFor("lowPublicEvidence"),
      { roast: "spicy" },
    );
    const texts = allLines(battle).map((line) => line.text.toLowerCase());
    expect(texts.some((text) => text.includes("stealth") || text.includes("confidence"))).toBe(
      true,
    );
  });

  it("never repeats a template across two battles in the same engine", async () => {
    const left = await scorecardFor("strongMaintainer");
    const right = await scorecardFor("manyTinyRepos");
    const engine = new MemeEngine({
      left,
      right,
      battleKey: "fixed-key",
      roast: "spicy",
      themeId: "testing",
    });
    const first = engine.finisher("left", 20);
    const second = engine.round("craft.testing", "left", 40);
    expect(second?.line.templateId).not.toBe(first.line.templateId);
  });

  it("selects the same line for the same battle key and a different one otherwise", async () => {
    const left = await scorecardFor("strongMaintainer");
    const right = await scorecardFor("manyTinyRepos");
    const pick = (battleKey: string, roast: RoastMode = "spicy") =>
      new MemeEngine({ left, right, battleKey, roast, themeId: "testing" }).finisher("left", 20)
        .line.templateId;
    expect(pick("key-a")).toBe(pick("key-a"));
    const distinct = new Set(
      Array.from({ length: 12 }, (_value, index) => pick(`key-${String(index)}`)),
    );
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe("persona coverage", () => {
  it.each(PERSONA_NAMES)("scores %s without throwing", async (name) => {
    const card = await scorecardFor(name);
    expect(card.username).toBe(PERSONAS[name].login);
    expect(Number.isInteger(card.overallScore)).toBe(true);
  });
});
