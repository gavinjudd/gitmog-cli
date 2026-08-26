import { describe, expect, it } from "vitest";

import { AURA_LEAK_DEFINITIONS } from "../src/identity/aura-leak-catalog.js";
import { MOGSONA_DEFINITIONS } from "../src/identity/mogsona-catalog.js";
import { MEME_ATOMS } from "../src/meme/atoms.js";
import {
  GENERIC_COPY_PATTERNS,
  UNSUPPORTED_CLAIM_PATTERNS,
  findGenericCopy,
  findSafetyViolations,
  findUnsupportedClaims,
} from "../src/meme/safety.js";
import { MEME_TEMPLATES } from "../src/meme/templates.js";
import { SPICY_FULL_COPY_MINIMUM, SPICY_SHORT_COPY_MINIMUM } from "../src/meme/types.js";
import { ROAST_MODES, type MemeLine } from "../src/fast-scan/types.js";
import { buildBattle } from "../src/fast-scan/battle.js";

import { scorecardFor, type PersonaName } from "./helpers.js";

const EDITORIAL_FIXTURES: readonly (readonly [PersonaName, PersonaName])[] = [
  ["strongMaintainer", "manyTinyRepos"],
  ["strongMaintainer", "repoGraveyard"],
  ["strongMaintainer", "readmeCeo"],
  ["releaseHeavy", "testHeavy"],
  ["releaseHeavy", "ciHeavy"],
  ["testHeavy", "ciHeavy"],
  ["ossContributor", "forkCollector"],
  ["truePolyglot", "frameworkTourist"],
  ["archivedPortfolio", "archiveDiscipline"],
  ["oneRepoHighImpact", "oneRepoThin"],
  ["balancedBuilder", "commitGrinder"],
  ["monorepoOperator", "structureMerchant"],
  ["sustainedGrinder", "sidequestCollector"],
  ["highActivityLowImpact", "fixLooper"],
  ["lowPublicEvidence", "strongMaintainer"],
  ["unsupportedLanguages", "truePolyglot"],
  ["partialTreeFailure", "balancedBuilder"],
  ["readmeCeo", "releaseHeavy"],
  ["repoGraveyard", "archiveDiscipline"],
  ["forkCollector", "ossContributor"],
  ["frameworkTourist", "monorepoOperator"],
  ["sidequestCollector", "manyTinyRepos"],
  ["oneRepoHighImpact", "releaseHeavy"],
  ["commitGrinder", "fixLooper"],
  ["ciHeavy", "structureMerchant"],
];

const variants = () =>
  MEME_TEMPLATES.flatMap((template) =>
    ROAST_MODES.flatMap((mode) => [
      {
        id: `${template.id}:text:${mode}`,
        templateId: template.id,
        slot: template.slot,
        mode,
        text: template.text[mode],
      },
      ...(template.short === undefined
        ? []
        : [
            {
              id: `${template.id}:short:${mode}`,
              templateId: template.id,
              slot: template.slot,
              mode,
              text: template.short[mode],
            },
          ]),
    ]),
  );

const words = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .replace(/\{\w+\}/g, "{token}")
    .replace(/[^a-z{}]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const ngrams = (text: string, size: number): Set<string> => {
  const source = words(text);
  const result = new Set<string>();
  for (let index = 0; index <= source.length - size; index += 1) {
    result.add(source.slice(index, index + size).join(" "));
  }
  return result;
};

const battleLines = (battle: ReturnType<typeof buildBattle>): readonly MemeLine[] => [
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

describe("copy-quality lint", () => {
  it("keeps every template id and every exact copy unique", () => {
    expect(new Set(MEME_TEMPLATES.map((template) => template.id)).size).toBe(MEME_TEMPLATES.length);

    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const variant of variants()) {
      const normalized = variant.text.trim().toLowerCase();
      const first = seen.get(normalized);
      if (first !== undefined && first.split(":")[0] !== variant.templateId) {
        duplicates.push(`${first} == ${variant.id}`);
      } else {
        seen.set(normalized, variant.id);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it("contains no unsafe, unsupported or generic generated-copy phrase", () => {
    const failures: string[] = [];
    for (const variant of variants()) {
      for (const violation of [
        ...findSafetyViolations(variant.text),
        ...findUnsupportedClaims(variant.text),
        ...findGenericCopy(variant.text),
      ]) {
        failures.push(`${variant.id}: /${violation.pattern}/`);
      }
    }
    for (const definition of [...MOGSONA_DEFINITIONS, ...AURA_LEAK_DEFINITIONS]) {
      for (const mode of ROAST_MODES) {
        const text = definition.copy[mode];
        for (const violation of [
          ...findSafetyViolations(text),
          ...findUnsupportedClaims(text),
          ...findGenericCopy(text),
        ]) {
          failures.push(`${definition.id}:${mode}: /${violation.pattern}/`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("pins the unsupported-claim and generic-copy protections themselves", () => {
    expect(UNSUPPORTED_CLAIM_PATTERNS.length).toBeGreaterThanOrEqual(6);
    expect(GENERIC_COPY_PATTERNS.length).toBeGreaterThanOrEqual(10);
    expect(findUnsupportedClaims("Top 1% developer with a seed round")).not.toEqual([]);
    expect(findGenericCopy("Plot twist: it didn't just work.")).not.toEqual([]);
  });

  it("keeps full and short copy inside the declared surface budgets", () => {
    const failures: string[] = [];
    for (const template of MEME_TEMPLATES) {
      for (const atomId of template.atoms) {
        const atom = MEME_ATOMS.find((candidate) => candidate.id === atomId);
        expect(atom, `${template.id} -> ${atomId}`).toBeDefined();
        if (atom === undefined) continue;
        for (const mode of ROAST_MODES) {
          if (template.text[mode].length > atom.limits.web) {
            failures.push(`${template.id}:${mode}:web:${String(template.text[mode].length)}`);
          }
          if (template.short !== undefined && template.short[mode].length > atom.limits.card) {
            failures.push(`${template.id}:${mode}:card:${String(template.short[mode].length)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("gives every template a motif, energy, voice and all three modes", () => {
    for (const template of MEME_TEMPLATES) {
      expect(template.motif.length, template.id).toBeGreaterThan(2);
      expect([1, 2, 3], template.id).toContain(template.energy);
      expect(["deadpan", "fight-card", "terminal", "brainrot"], template.id).toContain(
        template.voice,
      );
      for (const mode of ROAST_MODES) {
        expect(template.text[mode].length, `${template.id}:${mode}`).toBeGreaterThan(6);
      }
    }
  });

  it("keeps the default Spicy copy above the release editorial floor", () => {
    for (const template of MEME_TEMPLATES) {
      expect(template.text.spicy.length, `${template.id}:text:spicy`).toBeGreaterThanOrEqual(
        SPICY_FULL_COPY_MINIMUM,
      );
      expect(template.text.spicy, `${template.id}:distinct-spicy`).not.toBe(template.text.clean);
      if (template.short !== undefined) {
        expect(template.short.spicy.length, `${template.id}:short:spicy`).toBeGreaterThanOrEqual(
          SPICY_SHORT_COPY_MINIMUM,
        );
      }
    }
  });

  it("keeps excessive shared four-word sequences out of one slot", () => {
    const failures: string[] = [];
    const source = variants().filter((variant) => variant.id.includes(":text:"));
    for (let leftIndex = 0; leftIndex < source.length; leftIndex += 1) {
      const left = source[leftIndex];
      if (left === undefined) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < source.length; rightIndex += 1) {
        const right = source[rightIndex];
        if (right === undefined || left.slot !== right.slot || left.mode !== right.mode) continue;
        const leftFour = ngrams(left.text, 4);
        const rightFour = ngrams(right.text, 4);
        const shared = [...leftFour].filter((sequence) => rightFour.has(sequence));
        if (shared.length > 2) {
          failures.push(`${left.id} <> ${right.id}: ${shared.join(" | ")}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("has no dead atom and no template bound to an unknown atom", () => {
    const atomIds = new Set(MEME_ATOMS.map((atom) => atom.id));
    const reachable = new Set(MEME_TEMPLATES.flatMap((template) => template.atoms));
    expect(
      MEME_TEMPLATES.flatMap((template) => template.atoms).filter((id) => !atomIds.has(id)),
    ).toEqual([]);
    expect(MEME_ATOMS.filter((atom) => !reachable.has(atom.id)).map((atom) => atom.id)).toEqual([]);
  });

  it("never repeats a motif more than twice in a rendered battle", async () => {
    const pairs = [
      ["strongMaintainer", "manyTinyRepos"],
      ["testHeavy", "ciHeavy"],
      ["repoGraveyard", "archiveDiscipline"],
      ["oneRepoHighImpact", "truePolyglot"],
      ["lowPublicEvidence", "balancedBuilder"],
    ] as const;
    const motifByTemplate = new Map(
      MEME_TEMPLATES.map((template) => [template.id, template.motif]),
    );

    for (const [leftName, rightName] of pairs) {
      const [left, right] = await Promise.all([scorecardFor(leftName), scorecardFor(rightName)]);
      for (const roast of ROAST_MODES) {
        const battle = buildBattle(left, right, { roast });
        const counts = new Map<string, number>();
        for (const line of battleLines(battle)) {
          const motif = motifByTemplate.get(line.templateId);
          if (motif === undefined) continue;
          counts.set(motif, (counts.get(motif) ?? 0) + 1);
        }
        for (const [motif, count] of counts) {
          expect(count, `${leftName}/${rightName}/${roast}/${motif}`).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it("gives every generated claim a valid evidence id or a system label", async () => {
    const [left, right] = await Promise.all([
      scorecardFor("strongMaintainer"),
      scorecardFor("manyTinyRepos"),
    ]);
    const battle = buildBattle(left, right, { roast: "spicy" });
    const ids = new Set([...left.evidence, ...right.evidence].map((item) => item.id));
    for (const line of battleLines(battle)) {
      if (line.templateId.startsWith("system.")) continue;
      expect(line.evidenceIds.length, line.templateId).toBeGreaterThan(0);
      for (const id of line.evidenceIds) expect(ids.has(id), `${line.templateId}:${id}`).toBe(true);
    }
  });

  it("scores at least 25 rendered editorial fixtures across the release rubric", async () => {
    expect(EDITORIAL_FIXTURES.length).toBeGreaterThanOrEqual(25);
    const failures: string[] = [];
    const scorecards = new Map<PersonaName, Awaited<ReturnType<typeof scorecardFor>>>();
    const cardFor = async (name: PersonaName) => {
      const cached = scorecards.get(name);
      if (cached !== undefined) return cached;
      const card = await scorecardFor(name);
      scorecards.set(name, card);
      return card;
    };

    for (const [fixtureIndex, [leftName, rightName]] of EDITORIAL_FIXTURES.entries()) {
      const roast = ROAST_MODES[fixtureIndex % ROAST_MODES.length] ?? "spicy";
      const battle = buildBattle(await cardFor(leftName), await cardFor(rightName), { roast });
      const evidenceIds = new Set(
        [...battle.left.evidence, ...battle.right.evidence].map((entry) => entry.id),
      );
      const visible = battleLines(battle).filter((line) => !line.templateId.startsWith("system."));
      const textCounts = new Map<string, number>();
      for (const line of visible) textCounts.set(line.text, (textCounts.get(line.text) ?? 0) + 1);

      for (const line of visible) {
        const wordsInLine = words(line.text).length;
        const factualFit =
          line.evidenceIds.length > 0 && line.evidenceIds.every((id) => evidenceIds.has(id));
        const axes = {
          immediateComprehension:
            line.text.length <= 150 && !/\{\w+\}|\b(?:undefined|null|NaN)\b/u.test(line.text)
              ? 2
              : 0,
          specificity:
            line.evidenceIds.length > 0 && findGenericCopy(line.text).length === 0 ? 2 : 0,
          factualFit: factualFit ? 2 : 0,
          screenshotValue: line.text.length <= 100 ? 2 : line.text.length <= 150 ? 1 : 0,
          memeValue:
            findGenericCopy(line.text).length === 0 && findSafetyViolations(line.text).length === 0
              ? 2
              : 0,
          originality: textCounts.get(line.text) === 1 ? 2 : 0,
          brevity: wordsInLine <= 16 ? 2 : wordsInLine <= 24 ? 1 : 0,
        };
        const total = Object.values(axes).reduce((sum, score) => sum + score, 0);
        if (!factualFit || total < 11) {
          failures.push(
            `${leftName}/${rightName}/${roast}/${line.templateId}: ${String(total)}/14 ${JSON.stringify(axes)}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
