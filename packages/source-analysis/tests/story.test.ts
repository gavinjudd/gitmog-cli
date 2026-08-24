import { evaluateCodeDnaSampleSet, type CodeDnaOutcome } from "@gitmog/personality";
import {
  CODE_DNA_CALIBRATION_FIXTURES,
  calibrationSampleSet,
} from "@gitmog/personality/calibration";
import type { BattleResult, RoastMode } from "@gitmog/scoring";
import { battleFixture } from "@gitmog/test-fixtures/battle-result";
import { describe, expect, it } from "vitest";

import { NARRATIVE_TEMPLATE_CORPUS, templateVariantIndex } from "../src/narrative-templates.js";
import {
  buildStoryPlanContext,
  buildValidStoryPlanCandidates,
  deriveFallbackStoryReadPlan,
  renderStoryReadPlan,
  selectDeterministicStoryReadPlan,
  sourceStoryEligibility,
  storyPlanId,
  validateRankedStoryReadPlans,
  validateStoryReadPlan,
} from "../src/story.js";
import { STORY_THEME_IDS, type StoryReadPlan, type SourceAnalysisCodeDna } from "../src/types.js";
import { validateBattleRead } from "../src/validation.js";

const calibration = (id: string): CodeDnaOutcome => {
  const fixture = CODE_DNA_CALIBRATION_FIXTURES.find((entry) => entry.id === id);
  if (fixture === undefined) throw new Error(`Missing fixture ${id}`);
  return evaluateCodeDnaSampleSet(calibrationSampleSet(fixture));
};

const codeDna: SourceAnalysisCodeDna = {
  left: calibration("direct-compact-application"),
  right: calibration("deep-abstraction"),
};
const battle = battleFixture() as BattleResult;
const context = buildStoryPlanContext(battle, codeDna);

const MOTIF_BY_THEME = {
  "architecture-clash": {
    themeId: "architecture-clash",
    contrastId: "right-more-abstract",
    finisherId: "blueprint-vs-shortcut",
  },
  "defense-clash": {
    themeId: "defense-clash",
    contrastId: "right-more-ritual",
    finisherId: "checks-vs-instinct",
  },
  "density-clash": {
    themeId: "density-clash",
    contrastId: "right-more-ceremonial",
    finisherId: "framework-vs-function",
  },
  "domain-clash": {
    themeId: "domain-clash",
    contrastId: "right-more-systems",
    finisherId: "product-vs-protocol",
  },
  "mirror-match": {
    themeId: "mirror-match",
    contrastId: "similar-signals",
    finisherId: "same-tools-different-grip",
  },
  "chimera-clash": {
    themeId: "chimera-clash",
    contrastId: "chimera-vs-specialist",
    finisherId: "many-tools-vs-one",
  },
  "hybrid-match": {
    themeId: "hybrid-match",
    contrastId: "hybrid-vs-hybrid",
    finisherId: "hybrid-handoff",
  },
  "coverage-gap": {
    themeId: "coverage-gap",
    contrastId: "unequal-coverage",
    finisherId: "receipts-vs-range",
  },
  "limited-evidence": {
    themeId: "limited-evidence",
    contrastId: "limited-evidence",
    finisherId: "small-sample-sharp-read",
  },
} as const;

const planFor = (themeId: (typeof STORY_THEME_IDS)[number]): StoryReadPlan => {
  const motif = context.motifs.find((entry) => entry.themeId === themeId) ?? context.motifs[0];
  if (motif === undefined) throw new Error("No allowed motif");
  const fallback = deriveFallbackStoryReadPlan(battle, codeDna, context);
  return { ...fallback, ...motif };
};

const claimIndex = (current: BattleResult) => ({
  leftEvidenceIds: context.leftEvidenceIds,
  rightEvidenceIds: context.rightEvidenceIds,
  leftSampleIds: context.leftSampleIds,
  rightSampleIds: context.rightSampleIds,
  leftHandle: current.left.username,
  rightHandle: current.right.username,
  roast: current.roast,
});

describe("ranked story plans", () => {
  it("gates source-story scope on surviving side-owned samples and contributions", () => {
    const insufficient: CodeDnaOutcome = {
      status: "insufficient",
      version: "test",
      reason: "no bounded source sample survived",
      samples: [],
      limitations: ["no bounded source sample survived"],
    };
    expect(sourceStoryEligibility({ left: insufficient, right: insufficient })).toEqual({
      leftProfile: false,
      rightProfile: false,
      matchup: false,
      finisher: false,
      plan: false,
    });
    expect(sourceStoryEligibility({ left: codeDna.left, right: insufficient })).toEqual({
      leftProfile: true,
      rightProfile: false,
      matchup: false,
      finisher: false,
      plan: false,
    });
    expect(sourceStoryEligibility(codeDna)).toMatchObject({
      leftProfile: true,
      rightProfile: true,
      matchup: true,
      finisher: true,
      plan: true,
    });

    const zeroContext = buildStoryPlanContext(battle, { left: insufficient, right: insufficient });
    const unrelatedScorePlan = deriveFallbackStoryReadPlan(
      battle,
      { left: insufficient, right: insufficient },
      zeroContext,
    );
    expect(unrelatedScorePlan.evidenceIds.length).toBeGreaterThan(0);
    expect(validateStoryReadPlan(unrelatedScorePlan, zeroContext)).toMatchObject({ ok: false });
  });

  it("accepts a compatible allowlisted plan with side-owned receipts", () => {
    const plan = planFor("architecture-clash");
    expect(validateStoryReadPlan(plan, context)).toEqual({ ok: true, value: plan });
  });

  it.each([
    ["contradictory angle", { leftAngleId: "layer-builder" }],
    ["unknown evidence", { evidenceIds: ["invented"] }],
    ["crossed sample", { leftSampleIds: [...context.rightSampleIds] }],
    ["mismatched motif", { finisherId: "checks-vs-instinct" }],
  ])("rejects %s", (_name, mutation) => {
    expect(
      validateStoryReadPlan({ ...planFor("architecture-clash"), ...mutation }, context).ok,
    ).toBe(false);
  });

  it("chooses the first compatible rank without retrying an incompatible first candidate", () => {
    const valid = planFor("architecture-clash");
    const other = planFor("density-clash");
    const incompatible = {
      ...valid,
      themeId: "domain-clash",
      contrastId: "right-more-systems",
      finisherId: "product-vs-protocol",
    } as const;
    const ranked = validateRankedStoryReadPlans({ plans: [incompatible, valid, other] }, context);
    expect(ranked.structurallyValid).toBe(true);
    if (!ranked.structurallyValid) throw new Error("unexpected structure failure");
    expect(ranked.selectedRank).toBe(2);
    expect(ranked.selected).toEqual(valid);
    expect(ranked.candidateErrors[0]?.length).toBeGreaterThan(0);
  });

  it("offers three distinct individually valid plans across supported contrast families", () => {
    const plans = buildValidStoryPlanCandidates(battle, codeDna, context);
    expect(plans).toHaveLength(3);
    expect(new Set(plans.map((plan) => plan.finisherId)).size).toBe(3);
    expect(new Set(plans.map((plan) => plan.themeId)).size).toBeGreaterThan(1);
    expect(plans.every((plan) => validateStoryReadPlan(plan, context).ok)).toBe(true);
    const ranked = validateRankedStoryReadPlans({ plans }, context);
    expect(ranked).toMatchObject({ structurallyValid: true, selectedRank: 1 });
    if (ranked.structurallyValid) {
      expect(ranked.candidateErrors).toEqual([[], [], []]);
    }
  });

  it("rejects repeated lower-ranked motifs and treats malformed outer shape separately", () => {
    const first = planFor("architecture-clash");
    const second = planFor("density-clash");
    const repeated = validateRankedStoryReadPlans({ plans: [first, first, second] }, context);
    expect(repeated.structurallyValid).toBe(true);
    if (repeated.structurallyValid) {
      expect(repeated.selectedRank).toBe(1);
      expect(repeated.candidateErrors[1]).toContain("candidate repeats an earlier motif");
    }
    expect(validateRankedStoryReadPlans({ plans: [first, second] }, context)).toMatchObject({
      structurallyValid: false,
    });
  });

  it("rejects a locally valid plan that was not one of the three offered candidates", () => {
    const offered = buildValidStoryPlanCandidates(battle, codeDna, context);
    const extraEvidence = [...context.leftEvidenceIds, ...context.rightEvidenceIds].find(
      (id) => !offered[0].evidenceIds.includes(id),
    );
    if (extraEvidence === undefined) throw new Error("Missing extra fixture evidence");
    const invented = {
      ...offered[0],
      evidenceIds: [...offered[0].evidenceIds, extraEvidence],
    } as StoryReadPlan;
    const ranked = validateRankedStoryReadPlans(
      { plans: [invented, offered[1], offered[2]] },
      context,
      offered,
    );
    expect(ranked).toMatchObject({ structurallyValid: true, selectedRank: 2 });
    if (ranked.structurallyValid) {
      expect(ranked.candidateErrors[0]).toContain(
        "candidate was not one of the three offered plans",
      );
    }
  });

  it("selects a deterministic plan from explicit measured factors", () => {
    const first = selectDeterministicStoryReadPlan(battle, codeDna, context);
    const second = selectDeterministicStoryReadPlan(battle, codeDna, context);
    expect(second).toEqual(first);
    expect(first.planId).toBe(storyPlanId(first.plan));
    expect(first.scoredCandidates).toHaveLength(3);
    expect(new Set(first.scoredCandidates.map((candidate) => candidate.planId)).size).toBe(3);
    expect(first.scoredCandidates[0]?.factors).toMatchObject({
      roastMode: battle.roast,
      motifHistory: 0,
    });
    expect(first.scoredCandidates[0]?.factors.axisContrastStrength).toBeGreaterThan(0);
    expect(first.scoredCandidates[0]?.factors.sourceConfidence).toBeGreaterThan(0);
    expect(first.scoredCandidates[0]?.factors.coverage).toBeGreaterThan(0);
  });

  it("uses motif history as an editorial diversity penalty without changing receipts", () => {
    const first = selectDeterministicStoryReadPlan(battle, codeDna, context);
    const motif = [first.plan.themeId, first.plan.contrastId, first.plan.finisherId].join(":");
    const diversified = selectDeterministicStoryReadPlan(battle, codeDna, context, {
      motifHistory: { [motif]: 100 },
    });
    expect(diversified.planId).not.toBe(first.planId);
    expect(validateStoryReadPlan(diversified.plan, context)).toMatchObject({ ok: true });
  });

  it("keeps directional profile constructions attached to the measured side", () => {
    const specialist = calibration("vibe-heavy-dynamic");
    const chimera = calibration("high-confidence-hybrid");
    const reversedCodeDna = { left: specialist, right: chimera };
    const reversedContext = buildStoryPlanContext(battle, reversedCodeDna);
    const plan = buildValidStoryPlanCandidates(battle, reversedCodeDna, reversedContext).find(
      (candidate) => candidate.themeId === "chimera-clash",
    );
    expect(plan).toBeDefined();
    if (plan === undefined) throw new Error("Missing Chimera contrast plan");
    const read = renderStoryReadPlan(battle, reversedCodeDna, plan, reversedContext);
    expect(read.leftRead.text).toMatch(/specialist|focused|concentrated|center of gravity/i);
    expect(read.rightRead.text).toMatch(/blend|range|breadth|hybrid/i);
  });

  it("keeps reversed hybrid battles deterministic without an exact finisher collision", () => {
    const hybrid = calibration("high-confidence-hybrid");
    const forwardCodeDna = { left: hybrid, right: hybrid };
    const forward = {
      ...battle,
      battleKey: "hybrid-forward",
      roast: "unhinged",
    } as BattleResult;
    const reversed = {
      ...battle,
      battleKey: "hybrid-reversed",
      roast: "unhinged",
      left: { ...battle.left, username: battle.right.username },
      right: { ...battle.right, username: battle.left.username },
    } as BattleResult;
    const forwardContext = buildStoryPlanContext(forward, forwardCodeDna);
    const reverseContext = buildStoryPlanContext(reversed, forwardCodeDna);
    const forwardPlan = selectDeterministicStoryReadPlan(
      forward,
      forwardCodeDna,
      forwardContext,
    ).plan;
    const reversePlan = selectDeterministicStoryReadPlan(
      reversed,
      forwardCodeDna,
      reverseContext,
    ).plan;
    const forwardRead = renderStoryReadPlan(forward, forwardCodeDna, forwardPlan, forwardContext);
    const replay = renderStoryReadPlan(forward, forwardCodeDna, forwardPlan, forwardContext);
    const reverseRead = renderStoryReadPlan(reversed, forwardCodeDna, reversePlan, reverseContext);
    expect(replay).toEqual(forwardRead);
    expect(reverseRead.finisher.text).not.toBe(forwardRead.finisher.text);
  });
});

describe("authored narrative corpus", () => {
  it("provides the required per-family Clean, Spicy and Unhinged inventory", () => {
    expect(Object.keys(NARRATIVE_TEMPLATE_CORPUS).sort()).toEqual([...STORY_THEME_IDS].sort());
    for (const family of Object.values(NARRATIVE_TEMPLATE_CORPUS)) {
      for (const slot of [family.matchup, family.leftRead, family.rightRead, family.finisher]) {
        expect(slot.clean.length).toBeGreaterThanOrEqual(2);
        expect(slot.spicy.length).toBeGreaterThanOrEqual(3);
        expect(slot.unhinged.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("keeps every authored template reachable through deterministic selection", () => {
    for (const [theme, family] of Object.entries(NARRATIVE_TEMPLATE_CORPUS)) {
      for (const slot of ["matchup", "leftRead", "rightRead", "finisher"] as const) {
        for (const mode of ["clean", "spicy", "unhinged"] satisfies readonly RoastMode[]) {
          const lines = family[slot][mode];
          const reached = new Set(
            Array.from({ length: 4_096 }, (_value, index) =>
              templateVariantIndex(`${theme}:${slot}:${mode}:reach:${String(index)}`, lines.length),
            ),
          );
          expect(reached.size, `${theme}:${slot}:${mode}`).toBe(lines.length);
        }
      }
    }
  });

  it("keeps authored IDs, exact lines, interpolation and first-screen language clean", () => {
    const ids = new Set<string>();
    const exact = new Set<string>();
    const allowedVariables = new Set([
      "first",
      "second",
      "left",
      "right",
      "handle",
      "identity",
      "angle",
      "hybrid",
      "specialist",
      "broad",
      "narrow",
    ]);
    const reportLanguage =
      /measured blend|measured pole|source receipt|feature famil(?:y|ies)|signal hierarchy|identity specificity|concentrated specialist signature|evidence supports|coherent under load|validated source-style contrast|distinct measured feature mix|application-oriented source signature|source signature|sample proves|confidence band/i;
    for (const [theme, family] of Object.entries(NARRATIVE_TEMPLATE_CORPUS)) {
      for (const slot of ["matchup", "leftRead", "rightRead", "finisher"] as const) {
        const modes = family[slot];
        for (const mode of ["clean", "spicy", "unhinged"] satisfies readonly RoastMode[]) {
          for (const [index, line] of modes[mode].entries()) {
            const id = `${theme}:${slot}:${mode}:${String(index)}`;
            expect(ids.has(id), id).toBe(false);
            ids.add(id);
            expect(exact.has(line), line).toBe(false);
            exact.add(line);
            expect(Array.from(line).length, id).toBeLessThanOrEqual(180);
            for (const match of line.matchAll(/\{([A-Za-z]+)\}/g)) {
              expect(allowedVariables.has((match[1] ?? "").toLowerCase()), id).toBe(true);
            }
            if (slot === "matchup" || slot === "finisher") {
              expect(line, id).not.toMatch(reportLanguage);
            }
          }
        }
      }
    }
  });

  it("contains no airport/security motif or unsupported bytes-underneath filler", () => {
    const corpus = JSON.stringify(NARRATIVE_TEMPLATE_CORPUS).toLowerCase();
    expect(corpus).not.toMatch(
      /airport|security checkpoint|carry-on|terminal|baggage|suitcase|airlock|paper airplane/,
    );
    expect(corpus).not.toContain("works the bytes underneath it");
  });

  it("keeps generic one-does/other-does construction below five percent", () => {
    const spicy = Object.values(NARRATIVE_TEMPLATE_CORPUS).flatMap((family) => [
      ...family.matchup.spicy,
      ...family.leftRead.spicy,
      ...family.rightRead.spicy,
      ...family.finisher.spicy,
    ]);
    const generic = spicy.filter((line) => /\bone\b.{0,60}\bthe other\b/i.test(line));
    expect(generic.length / spicy.length).toBeLessThan(0.05);
  });

  it("caps shared spicy five-grams across the authored corpus", () => {
    const spicy = Object.values(NARRATIVE_TEMPLATE_CORPUS).flatMap((family) => [
      ...family.matchup.spicy,
      ...family.leftRead.spicy,
      ...family.rightRead.spicy,
      ...family.finisher.spicy,
    ]);
    const counts = new Map<string, number>();
    for (const line of spicy) {
      const words =
        line
          .toLowerCase()
          .replaceAll(/\{[^}]+\}/g, "placeholder")
          .match(/[a-z0-9]+/g) ?? [];
      for (let index = 0; index <= words.length - 5; index += 1) {
        const gram = words.slice(index, index + 5).join(" ");
        if (gram.includes("placeholder")) continue;
        counts.set(gram, (counts.get(gram) ?? 0) + 1);
      }
    }
    const hottest = [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5);
    expect(hottest[0]?.[1], JSON.stringify(hottest)).toBeLessThanOrEqual(3);
  });

  it("renders deterministic supported copy in all roast modes", () => {
    for (const roast of ["clean", "spicy", "unhinged"] satisfies readonly RoastMode[]) {
      const current = { ...battle, roast } as BattleResult;
      const currentContext = buildStoryPlanContext(current, codeDna);
      const plan = deriveFallbackStoryReadPlan(current, codeDna, currentContext);
      const first = renderStoryReadPlan(current, codeDna, plan, currentContext);
      const second = renderStoryReadPlan(current, codeDna, plan, currentContext);
      expect(second).toEqual(first);
      const validation = validateBattleRead(first, claimIndex(current));
      expect(
        validation,
        `${roast}: ${JSON.stringify(validation)}\n${JSON.stringify(first)}`,
      ).toMatchObject({ ok: true });
    }
  });

  it("keeps every deterministically reachable authored variant validation-safe", () => {
    for (const themeId of STORY_THEME_IDS) {
      for (const roast of ["clean", "spicy", "unhinged"] satisfies readonly RoastMode[]) {
        for (let index = 0; index < 64; index += 1) {
          const current = {
            ...battle,
            battleKey: `variant-${themeId}-${roast}-${String(index)}`,
            roast,
          } as BattleResult;
          const plan = {
            ...deriveFallbackStoryReadPlan(current, codeDna, context),
            ...MOTIF_BY_THEME[themeId],
          };
          const read = renderStoryReadPlan(current, codeDna, plan, context);
          const validation = validateBattleRead(read, claimIndex(current));
          expect(
            validation,
            `${themeId}/${roast}/${String(index)} ${JSON.stringify(validation)} ${JSON.stringify(read)}`,
          ).toMatchObject({ ok: true });
          if (roast === "spicy") {
            const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
            const firstScreen = [
              read.matchupThesis.text,
              read.leftRead.text,
              read.rightRead.text,
              read.finisher.text,
            ].join(" ");
            expect(firstScreen).not.toMatch(/\b(?:source|sample|receipt(?:s|ed)?)\b/i);
            expect(words(read.matchupThesis.text)).toBeGreaterThanOrEqual(6);
            expect(words(read.matchupThesis.text)).toBeLessThanOrEqual(18);
            expect(words(read.leftRead.text)).toBeGreaterThanOrEqual(5);
            expect(words(read.leftRead.text)).toBeLessThanOrEqual(16);
            expect(words(read.rightRead.text)).toBeGreaterThanOrEqual(5);
            expect(words(read.rightRead.text)).toBeLessThanOrEqual(16);
            expect(words(read.finisher.text)).toBeGreaterThanOrEqual(5);
            expect(words(read.finisher.text)).toBeLessThanOrEqual(16);
          }
        }
      }
    }
  });

  it("avoids exact finisher repetition across the nine-family calibration corpus", () => {
    const rendered = STORY_THEME_IDS.map((themeId, index) => {
      const motif = {
        themeId,
        contrastId:
          themeId === "architecture-clash"
            ? "right-more-abstract"
            : themeId === "defense-clash"
              ? "right-more-ritual"
              : themeId === "density-clash"
                ? "right-more-ceremonial"
                : themeId === "domain-clash"
                  ? "right-more-systems"
                  : themeId === "mirror-match"
                    ? "similar-signals"
                    : themeId === "chimera-clash"
                      ? "chimera-vs-specialist"
                      : themeId === "hybrid-match"
                        ? "hybrid-vs-hybrid"
                        : themeId === "coverage-gap"
                          ? "unequal-coverage"
                          : "limited-evidence",
        finisherId:
          themeId === "architecture-clash"
            ? "blueprint-vs-shortcut"
            : themeId === "defense-clash"
              ? "checks-vs-instinct"
              : themeId === "density-clash"
                ? "framework-vs-function"
                : themeId === "domain-clash"
                  ? "product-vs-protocol"
                  : themeId === "mirror-match"
                    ? "same-tools-different-grip"
                    : themeId === "chimera-clash"
                      ? "many-tools-vs-one"
                      : themeId === "hybrid-match"
                        ? "hybrid-handoff"
                        : themeId === "coverage-gap"
                          ? "receipts-vs-range"
                          : "small-sample-sharp-read",
      } as const;
      const current = {
        ...battle,
        battleKey: `narrative-${String(index)}`,
        roast: "spicy",
      } as BattleResult;
      const plan = { ...deriveFallbackStoryReadPlan(current, codeDna), ...motif };
      return renderStoryReadPlan(current, codeDna, plan).finisher.text;
    });
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  it("keeps finishers unique across the twenty-battle lift corpus", () => {
    const handles = ["gavinjudd", "karpathy", "torvalds"];
    const cases = [
      ...handles.flatMap((left) =>
        handles
          .filter((right) => right !== left)
          .flatMap((right) =>
            (["clean", "spicy", "unhinged"] satisfies readonly RoastMode[]).map((roast) => ({
              left,
              right,
              roast,
            })),
          ),
      ),
      { left: "gavinjudd", right: "sindresorhus", roast: "spicy" as const },
      { left: "sindresorhus", right: "gavinjudd", roast: "spicy" as const },
    ];
    const finishers = cases.map((entry, index) => {
      const current = {
        ...battle,
        battleKey: `lift-${entry.left}-${entry.right}-${entry.roast}-${String(index)}`,
        roast: entry.roast,
        left: { ...battle.left, username: entry.left },
        right: { ...battle.right, username: entry.right },
      } as BattleResult;
      const currentContext = buildStoryPlanContext(current, codeDna);
      const selection = selectDeterministicStoryReadPlan(current, codeDna, currentContext);
      const finisher = renderStoryReadPlan(current, codeDna, selection.plan, currentContext)
        .finisher.text;
      expect(finisher).toContain(`@${entry.left}/@${entry.right}:`);
      return finisher;
    });
    expect(cases).toHaveLength(20);
    expect(new Set(finishers).size).toBe(finishers.length);
  });

  it("keeps sixty deterministic first-screen cards unique, directional and validation-safe", () => {
    const cards: string[] = [];
    const finishers: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      for (const roast of ["clean", "spicy", "unhinged"] satisfies readonly RoastMode[]) {
        for (const reverse of [false, true]) {
          const first =
            index === 9 ? "long-valid-handle-for-card-check-01" : `corpus-${String(index)}-a`;
          const second =
            index === 9 ? "long-valid-handle-for-card-check-02" : `corpus-${String(index)}-b`;
          const current = {
            ...battle,
            battleKey: `copy-v2-${String(index)}-${roast}-${reverse ? "reverse" : "forward"}`,
            roast,
            left: { ...battle.left, username: reverse ? second : first },
            right: { ...battle.right, username: reverse ? first : second },
          } as BattleResult;
          const currentCodeDna = reverse ? { left: codeDna.right, right: codeDna.left } : codeDna;
          const currentContext = buildStoryPlanContext(current, currentCodeDna);
          const selection = selectDeterministicStoryReadPlan(
            current,
            currentCodeDna,
            currentContext,
          );
          const read = renderStoryReadPlan(current, currentCodeDna, selection.plan, currentContext);
          const validation = validateBattleRead(read, {
            leftEvidenceIds: currentContext.leftEvidenceIds,
            rightEvidenceIds: currentContext.rightEvidenceIds,
            leftSampleIds: currentContext.leftSampleIds,
            rightSampleIds: currentContext.rightSampleIds,
            leftHandle: current.left.username,
            rightHandle: current.right.username,
            roast,
          });
          expect(
            validation,
            JSON.stringify({ key: current.battleKey, validation, read }),
          ).toMatchObject({
            ok: true,
          });
          const firstScreen = [
            `@${current.left.username} vs @${current.right.username}`,
            read.matchupThesis.text,
            read.leftRead.text,
            read.rightRead.text,
            read.finisher.text,
          ].join("\n");
          expect(firstScreen).not.toMatch(
            /measured blend|measured pole|source signature|confidence band|plot twist|game-changer|let that sink in/i,
          );
          cards.push(firstScreen);
          finishers.push(read.finisher.text);
        }
      }
    }
    expect(cards).toHaveLength(60);
    expect(new Set(cards).size).toBe(60);
    expect(new Set(finishers).size).toBe(60);
  });
});
