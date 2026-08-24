import { CODE_AXIS_IDS, type CodeAxisId, type CodeDnaOutcome } from "@gitmog/personality";
import type { BattleResult, RoastMode, Side } from "@gitmog/scoring";

import { NARRATIVE_TEMPLATE_CORPUS, selectTemplateVariant } from "./narrative-templates.js";
import {
  STORY_ANGLE_IDS,
  STORY_CONTRAST_IDS,
  STORY_FINISHER_IDS,
  STORY_THEME_IDS,
  type AllowedAngleId,
  type AllowedContrastId,
  type AllowedFinisherId,
  type AllowedThemeId,
  type RankedStoryReadPlans,
  type StoryClaim,
  type StoryReadPlan,
  type SourceAnalysisBattleRead,
  type SourceAnalysisCodeDna,
} from "./types.js";

// Source receipt/cache schema changes must not silently reroll authored copy. This seed
// retains the accepted story corpus ordering independently of SOURCE_ANALYSIS_VERSION.
const STORY_TEMPLATE_SELECTION_VERSION = ["1.0.0", "default", "bounded", "analysis"].join("-");

export interface StoryPlanMotif {
  readonly themeId: AllowedThemeId;
  readonly contrastId: AllowedContrastId;
  readonly finisherId: AllowedFinisherId;
}

export interface StoryPlanContext {
  readonly allowedThemeIds: readonly AllowedThemeId[];
  readonly allowedLeftAngleIds: readonly AllowedAngleId[];
  readonly allowedRightAngleIds: readonly AllowedAngleId[];
  readonly allowedContrastIds: readonly AllowedContrastId[];
  readonly allowedFinisherIds: readonly AllowedFinisherId[];
  readonly motifs: readonly StoryPlanMotif[];
  readonly leftEvidenceIds: ReadonlySet<string>;
  readonly rightEvidenceIds: ReadonlySet<string>;
  readonly leftSampleIds: ReadonlySet<string>;
  readonly rightSampleIds: ReadonlySet<string>;
  readonly leftSourceStoryEligible: boolean;
  readonly rightSourceStoryEligible: boolean;
}

export interface StoryPlanScore {
  readonly plan: StoryReadPlan;
  readonly planId: string;
  readonly score: number;
  readonly factors: {
    readonly axisContrastStrength: number;
    readonly identitySpecificity: number;
    readonly sourceConfidence: number;
    readonly coverage: number;
    readonly themeSpecificity: number;
    readonly motifHistory: number;
    readonly roastMode: RoastMode;
  };
}

export interface DeterministicStoryPlanSelection {
  readonly plan: StoryReadPlan;
  readonly planId: string;
  readonly scoredCandidates: readonly StoryPlanScore[];
}

export interface DeterministicStoryPlanOptions {
  /** Number of earlier corpus selections for each plan motif. */
  readonly motifHistory?: Readonly<Record<string, number>> | undefined;
}

export type StoryPlanValidation =
  | { readonly ok: true; readonly value: StoryReadPlan }
  | { readonly ok: false; readonly errors: readonly string[] };

export type RankedStoryPlanValidation =
  | {
      readonly structurallyValid: true;
      readonly value: RankedStoryReadPlans;
      readonly selected: StoryReadPlan | null;
      readonly selectedRank: 1 | 2 | 3 | null;
      readonly candidateErrors: readonly (readonly string[])[];
    }
  | {
      readonly structurallyValid: false;
      readonly errors: readonly string[];
    };

const AXIS_THEME: Readonly<Record<CodeAxisId, AllowedThemeId>> = Object.freeze({
  directAbstract: "architecture-clash",
  vibeRitual: "defense-clash",
  compactCeremonial: "density-clash",
  applicationSystems: "domain-clash",
});

const THEME_FINISHERS: Readonly<
  Record<AllowedThemeId, readonly [AllowedFinisherId, AllowedFinisherId, AllowedFinisherId]>
> = Object.freeze({
  "architecture-clash": ["blueprint-vs-shortcut", "callsite-vs-layers", "concrete-vs-indirect"],
  "defense-clash": ["checks-vs-instinct", "contract-vs-trust", "guards-vs-flow"],
  "density-clash": ["framework-vs-function", "pocket-vs-scaffold", "line-vs-structure"],
  "domain-clash": ["product-vs-protocol", "workflow-vs-primitive", "service-vs-system"],
  "mirror-match": [
    "same-tools-different-grip",
    "same-pole-different-receipt",
    "mirror-with-texture",
  ],
  "chimera-clash": ["many-tools-vs-one", "range-vs-specialty", "coalition-vs-specialist"],
  "hybrid-match": ["hybrid-handoff", "shared-range-different-order", "hybrid-different-lead"],
  "coverage-gap": ["receipts-vs-range", "broad-vs-narrow-window", "coverage-weight"],
  "limited-evidence": ["small-sample-sharp-read", "bounded-but-valid", "narrow-window"],
});

const CONTRAST_FOR_AXIS: Readonly<
  Record<CodeAxisId, readonly [AllowedContrastId, AllowedContrastId]>
> = Object.freeze({
  directAbstract: ["left-more-abstract", "right-more-abstract"],
  vibeRitual: ["left-more-ritual", "right-more-ritual"],
  compactCeremonial: ["left-more-ceremonial", "right-more-ceremonial"],
  applicationSystems: ["left-more-systems", "right-more-systems"],
});

const SPECIAL_THEME_CONTRAST: Readonly<Partial<Record<AllowedThemeId, AllowedContrastId>>> =
  Object.freeze({
    "mirror-match": "similar-signals",
    "chimera-clash": "chimera-vs-specialist",
    "hybrid-match": "hybrid-vs-hybrid",
    "coverage-gap": "unequal-coverage",
    "limited-evidence": "limited-evidence",
  });

const ANGLE_AXIS: Readonly<Record<AllowedAngleId, CodeAxisId | null>> = Object.freeze({
  "direct-doer": "directAbstract",
  "layer-builder": "directAbstract",
  "guard-rails": "vibeRitual",
  "happy-path": "vibeRitual",
  "compact-core": "compactCeremonial",
  "ceremony-stack": "compactCeremonial",
  "application-wiring": "applicationSystems",
  "systems-depth": "applicationSystems",
  "mixed-method": null,
  "chimera-blend": null,
  "limited-read": null,
});

const readingFor = (codeDna: SourceAnalysisCodeDna, side: Side): CodeDnaOutcome => codeDna[side];

const scoreFor = (reading: CodeDnaOutcome, axis: CodeAxisId): number =>
  reading.status === "ready" || reading.status === "partial" ? reading.axes[axis].score : 50;

const supports = (
  reading: CodeDnaOutcome,
  axis: CodeAxisId,
  featureIds: readonly string[],
  labelIds: readonly string[],
): boolean => {
  if (reading.status !== "ready" && reading.status !== "partial") return false;
  return (
    reading.axes[axis].featureIds.some((featureId) => featureIds.includes(featureId)) ||
    reading.labelCandidates.some(
      (candidate) => candidate.eligible && labelIds.includes(candidate.id),
    )
  );
};

const angleIdsFor = (reading: CodeDnaOutcome): readonly AllowedAngleId[] => {
  if (reading.status !== "ready" && reading.status !== "partial") return ["limited-read"];
  const result: AllowedAngleId[] = [];
  if (reading.label?.id === "code-chimera") result.push("chimera-blend");
  if (reading.samples.length <= 1 || reading.sourceConfidence < 55) result.push("limited-read");
  if (
    reading.axes.directAbstract.score <= 42 &&
    supports(
      reading,
      "directAbstract",
      ["compact-control-flow", "thin-wrapper"],
      ["straight-shooter", "minimalist", "vibe-merchant"],
    )
  )
    result.push("direct-doer");
  if (
    reading.axes.directAbstract.score >= 58 &&
    supports(
      reading,
      "directAbstract",
      ["layered-abstraction", "generic-framework"],
      ["abstraction-astronaut", "framework-priest", "layer-cake"],
    )
  )
    result.push("layer-builder");
  if (
    reading.axes.vibeRitual.score >= 62 &&
    supports(
      reading,
      "vibeRitual",
      ["guard-heavy", "explicit-validation", "error-boundary", "typed-contracts"],
      ["guardrail-goblin", "type-inquisitor"],
    )
  )
    result.push("guard-rails");
  if (
    reading.axes.vibeRitual.score <= 38 &&
    supports(reading, "vibeRitual", ["implicit-assumptions", "thin-wrapper"], ["vibe-merchant"])
  )
    result.push("happy-path");
  if (
    reading.axes.compactCeremonial.score <= 38 &&
    supports(
      reading,
      "compactCeremonial",
      ["compact-control-flow", "thin-wrapper"],
      ["straight-shooter", "minimalist", "leetcode-monk"],
    )
  )
    result.push("compact-core");
  if (
    reading.axes.compactCeremonial.score >= 62 &&
    supports(
      reading,
      "compactCeremonial",
      ["ceremonial-boilerplate", "layered-abstraction", "generic-framework"],
      ["abstraction-astronaut", "framework-priest", "layer-cake"],
    )
  )
    result.push("ceremony-stack");
  if (
    reading.axes.applicationSystems.score <= 38 &&
    supports(
      reading,
      "applicationSystems",
      ["application-orchestration", "stateful-orchestration", "error-boundary"],
      ["api-plumber"],
    )
  )
    result.push("application-wiring");
  if (
    reading.axes.applicationSystems.score >= 62 &&
    supports(
      reading,
      "applicationSystems",
      ["systems-primitives", "protocol-handling", "algorithmic-core", "data-pipeline"],
      ["systems-maxxer", "leetcode-monk", "data-shaman"],
    )
  )
    result.push("systems-depth");
  if (result.length === 0) result.push("mixed-method");
  return [...new Set(result)];
};

const readingSampleCount = (reading: CodeDnaOutcome): number =>
  "samples" in reading ? reading.samples.length : 0;
const readingRepositoryCount = (reading: CodeDnaOutcome): number =>
  "repositoriesRepresented" in reading ? reading.repositoriesRepresented : 0;
const isChimera = (reading: CodeDnaOutcome): boolean =>
  (reading.status === "ready" || reading.status === "partial") &&
  reading.label?.id === "code-chimera";

const hasSourceStorySignal = (reading: CodeDnaOutcome): boolean => {
  if (reading.status !== "ready" && reading.status !== "partial") return false;
  const sampleIds = new Set(reading.samples.map((sample) => sample.sampleId));
  if (sampleIds.size === 0) return false;
  return CODE_AXIS_IDS.some((axis) =>
    reading.axes[axis].contributions.some(
      (contribution) =>
        contribution.value > 0 && contribution.sampleIds.some((id) => sampleIds.has(id)),
    ),
  );
};

export interface SourceStoryEligibility {
  readonly leftProfile: boolean;
  readonly rightProfile: boolean;
  readonly matchup: boolean;
  readonly finisher: boolean;
  readonly plan: boolean;
}

/** A slot may characterize only profiles backed by a surviving sample and matching
 * deterministic Code DNA contribution. A contrast plan therefore needs both sides. */
export const sourceStoryEligibility = (codeDna: SourceAnalysisCodeDna): SourceStoryEligibility => {
  const leftProfile = hasSourceStorySignal(codeDna.left);
  const rightProfile = hasSourceStorySignal(codeDna.right);
  const bilateral = leftProfile && rightProfile;
  return {
    leftProfile,
    rightProfile,
    matchup: bilateral,
    finisher: bilateral,
    plan: bilateral,
  };
};

export function buildStoryPlanContext(
  battle: BattleResult,
  codeDna: SourceAnalysisCodeDna,
): StoryPlanContext {
  const eligibility = sourceStoryEligibility(codeDna);
  const motifs: StoryPlanMotif[] = [];
  const addMotif = (themeId: AllowedThemeId, contrastId: AllowedContrastId): void => {
    for (const finisherId of THEME_FINISHERS[themeId]) {
      if (
        !motifs.some(
          (motif) =>
            motif.themeId === themeId &&
            motif.contrastId === contrastId &&
            motif.finisherId === finisherId,
        )
      )
        motifs.push({ themeId, contrastId, finisherId });
    }
  };
  const leftChimera = isChimera(codeDna.left);
  const rightChimera = isChimera(codeDna.right);
  if (leftChimera && rightChimera) addMotif("hybrid-match", "hybrid-vs-hybrid");
  else if (leftChimera !== rightChimera) addMotif("chimera-clash", "chimera-vs-specialist");

  const leftSamples = readingSampleCount(codeDna.left);
  const rightSamples = readingSampleCount(codeDna.right);
  const leftRepositories = readingRepositoryCount(codeDna.left);
  const rightRepositories = readingRepositoryCount(codeDna.right);
  if (
    Math.abs(leftSamples - rightSamples) >= 2 ||
    Math.abs(leftRepositories - rightRepositories) >= 2
  ) {
    addMotif("coverage-gap", "unequal-coverage");
  }
  if (leftSamples <= 1 || rightSamples <= 1) addMotif("limited-evidence", "limited-evidence");

  const differences = CODE_AXIS_IDS.map((axis) => ({
    axis,
    delta: scoreFor(codeDna.left, axis) - scoreFor(codeDna.right, axis),
  }));
  for (const entry of differences.filter((candidate) => Math.abs(candidate.delta) >= 18)) {
    addMotif(AXIS_THEME[entry.axis], CONTRAST_FOR_AXIS[entry.axis][entry.delta > 0 ? 0 : 1]);
  }
  if (motifs.length === 0) addMotif("mirror-match", "similar-signals");

  return {
    allowedThemeIds: [...new Set(motifs.map((motif) => motif.themeId))],
    allowedLeftAngleIds: angleIdsFor(readingFor(codeDna, "left")),
    allowedRightAngleIds: angleIdsFor(readingFor(codeDna, "right")),
    allowedContrastIds: [...new Set(motifs.map((motif) => motif.contrastId))],
    allowedFinisherIds: [...new Set(motifs.map((motif) => motif.finisherId))],
    motifs,
    leftEvidenceIds: new Set(battle.left.evidence.map((item) => item.id)),
    rightEvidenceIds: new Set(battle.right.evidence.map((item) => item.id)),
    leftSampleIds: new Set(
      "samples" in codeDna.left ? codeDna.left.samples.map((item) => item.sampleId) : [],
    ),
    rightSampleIds: new Set(
      "samples" in codeDna.right ? codeDna.right.samples.map((item) => item.sampleId) : [],
    ),
    leftSourceStoryEligible: eligibility.leftProfile,
    rightSourceStoryEligible: eligibility.rightProfile,
  };
}

const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const expected = [...allowed].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const uniqueStrings = (
  value: unknown,
  minimum: number,
  maximum: number,
): readonly string[] | null => {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return null;
  if (value.some((item) => typeof item !== "string" || item === "")) return null;
  const strings = value as string[];
  return new Set(strings).size === strings.length ? strings : null;
};

const includes = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && values.includes(value as T);

function parsePlanStructure(value: unknown): StoryReadPlan | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    !exactKeys(record, [
      "themeId",
      "leftAngleId",
      "rightAngleId",
      "contrastId",
      "finisherId",
      "evidenceIds",
      "leftSampleIds",
      "rightSampleIds",
    ])
  )
    return null;
  if (
    !includes(STORY_THEME_IDS, record.themeId) ||
    !includes(STORY_ANGLE_IDS, record.leftAngleId) ||
    !includes(STORY_ANGLE_IDS, record.rightAngleId) ||
    !includes(STORY_CONTRAST_IDS, record.contrastId) ||
    !includes(STORY_FINISHER_IDS, record.finisherId)
  )
    return null;
  const evidenceIds = uniqueStrings(record.evidenceIds, 1, 6);
  const leftSampleIds = uniqueStrings(record.leftSampleIds, 0, 4);
  const rightSampleIds = uniqueStrings(record.rightSampleIds, 0, 4);
  if (evidenceIds === null || leftSampleIds === null || rightSampleIds === null) return null;
  return {
    themeId: record.themeId,
    leftAngleId: record.leftAngleId,
    rightAngleId: record.rightAngleId,
    contrastId: record.contrastId,
    finisherId: record.finisherId,
    evidenceIds,
    leftSampleIds,
    rightSampleIds,
  };
}

export function validateStoryReadPlan(
  value: unknown,
  context: StoryPlanContext,
): StoryPlanValidation {
  const plan = parsePlanStructure(value);
  if (plan === null) return { ok: false, errors: ["story plan has invalid structure"] };
  const errors: string[] = [];
  if (!context.allowedThemeIds.includes(plan.themeId)) errors.push("themeId is not supported");
  if (!context.allowedLeftAngleIds.includes(plan.leftAngleId))
    errors.push("leftAngleId contradicts the left axes");
  if (!context.allowedRightAngleIds.includes(plan.rightAngleId))
    errors.push("rightAngleId contradicts the right axes");
  if (!context.allowedContrastIds.includes(plan.contrastId))
    errors.push("contrastId is not supported");
  if (!context.allowedFinisherIds.includes(plan.finisherId))
    errors.push("finisherId is not supported");
  if (
    !context.motifs.some(
      (motif) =>
        motif.themeId === plan.themeId &&
        motif.contrastId === plan.contrastId &&
        motif.finisherId === plan.finisherId,
    )
  )
    errors.push("theme, contrast and finisher do not describe one supported motif");

  const allEvidence = new Set([...context.leftEvidenceIds, ...context.rightEvidenceIds]);
  if (plan.evidenceIds.some((id) => !allEvidence.has(id)))
    errors.push("evidenceIds contains an unknown id");
  if (!plan.evidenceIds.some((id) => context.leftEvidenceIds.has(id)))
    errors.push("evidenceIds needs left support");
  if (!plan.evidenceIds.some((id) => context.rightEvidenceIds.has(id)))
    errors.push("evidenceIds needs right support");
  if (plan.leftSampleIds.some((id) => !context.leftSampleIds.has(id)))
    errors.push("leftSampleIds contains an unknown or non-left id");
  if (plan.rightSampleIds.some((id) => !context.rightSampleIds.has(id)))
    errors.push("rightSampleIds contains an unknown or non-right id");
  if (!context.leftSourceStoryEligible || plan.leftSampleIds.length === 0)
    errors.push("left source-story scope lacks eligible sample support");
  if (!context.rightSourceStoryEligible || plan.rightSampleIds.length === 0)
    errors.push("right source-story scope lacks eligible sample support");
  return errors.length === 0
    ? { ok: true, value: plan }
    : { ok: false, errors: [...new Set(errors)] };
}

export function validateRankedStoryReadPlans(
  value: unknown,
  context: StoryPlanContext,
  offeredPlans?: readonly [StoryReadPlan, StoryReadPlan, StoryReadPlan],
): RankedStoryPlanValidation {
  if (
    typeof value !== "object" ||
    value === null ||
    !exactKeys(value as Record<string, unknown>, ["plans"])
  ) {
    return { structurallyValid: false, errors: ["ranked response must contain only plans"] };
  }
  const plansValue = (value as Record<string, unknown>).plans;
  if (!Array.isArray(plansValue) || plansValue.length !== 3) {
    return {
      structurallyValid: false,
      errors: ["ranked response must contain exactly three plans"],
    };
  }
  const parsed = plansValue.map(parsePlanStructure);
  if (parsed.some((plan) => plan === null)) {
    return { structurallyValid: false, errors: ["at least one ranked plan has invalid structure"] };
  }
  const plans = parsed as [StoryReadPlan, StoryReadPlan, StoryReadPlan];
  const candidateErrors: string[][] = [[], [], []];
  const offered =
    offeredPlans === undefined ? null : new Set(offeredPlans.map(exactPlanFingerprint));
  const seenMotifs = new Set<string>();
  let selected: StoryReadPlan | null = null;
  let selectedRank: 1 | 2 | 3 | null = null;
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    if (plan === undefined) continue;
    const motif = `${plan.themeId}:${plan.contrastId}:${plan.finisherId}`;
    if (offered !== null && !offered.has(exactPlanFingerprint(plan))) {
      candidateErrors[index]?.push("candidate was not one of the three offered plans");
    }
    if (seenMotifs.has(motif)) candidateErrors[index]?.push("candidate repeats an earlier motif");
    seenMotifs.add(motif);
    const validated = validateStoryReadPlan(plan, context);
    if (!validated.ok) candidateErrors[index]?.push(...validated.errors);
    if (selected === null && (candidateErrors[index]?.length ?? 0) === 0 && validated.ok) {
      selected = validated.value;
      selectedRank = (index + 1) as 1 | 2 | 3;
    }
  }
  return {
    structurallyValid: true,
    value: { plans },
    selected,
    selectedRank,
    candidateErrors,
  };
}

const evidenceChoice = (battle: BattleResult, side: Side): string =>
  battle[side].positiveEvidence[0]?.id ?? battle[side].evidence[0]?.id ?? "";

const sampleChoice = (reading: CodeDnaOutcome, angle: AllowedAngleId): readonly string[] => {
  if (reading.status !== "ready" && reading.status !== "partial") return [];
  const axis = ANGLE_AXIS[angle];
  const cited = axis === null ? [] : reading.axes[axis].sampleIds;
  return cited.length > 0
    ? cited.slice(0, 2)
    : reading.samples.slice(0, 1).map((item) => item.sampleId);
};

export function deriveFallbackStoryReadPlan(
  battle: BattleResult,
  codeDna: SourceAnalysisCodeDna,
  context: StoryPlanContext = buildStoryPlanContext(battle, codeDna),
): StoryReadPlan {
  const motif = context.motifs[0] ?? {
    themeId: "mirror-match" as const,
    contrastId: "similar-signals" as const,
    finisherId: "same-tools-different-grip" as const,
  };
  const leftAngleId = context.allowedLeftAngleIds[0] ?? "mixed-method";
  const rightAngleId = context.allowedRightAngleIds[0] ?? "mixed-method";
  return {
    ...motif,
    leftAngleId,
    rightAngleId,
    evidenceIds: [
      ...new Set([evidenceChoice(battle, "left"), evidenceChoice(battle, "right")]),
    ].filter(Boolean),
    leftSampleIds: sampleChoice(codeDna.left, leftAngleId),
    rightSampleIds: sampleChoice(codeDna.right, rightAngleId),
  };
}

const stableIndex = (value: string, length: number): number => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % length;
};

export const storyPlanId = (plan: StoryReadPlan): string =>
  [plan.themeId, plan.contrastId, plan.finisherId, plan.leftAngleId, plan.rightAngleId].join(":");

const exactPlanFingerprint = (plan: StoryReadPlan): string =>
  JSON.stringify([storyPlanId(plan), plan.evidenceIds, plan.leftSampleIds, plan.rightSampleIds]);

const motifId = (plan: StoryReadPlan): string =>
  [plan.themeId, plan.contrastId, plan.finisherId].join(":");

const measurableReading = (
  reading: CodeDnaOutcome,
): reading is Extract<CodeDnaOutcome, { status: "ready" | "partial" }> =>
  reading.status === "ready" || reading.status === "partial";

const axisForTheme = (themeId: AllowedThemeId): CodeAxisId | null => {
  const entry = CODE_AXIS_IDS.find((axis) => AXIS_THEME[axis] === themeId);
  return entry ?? null;
};

const averageAxisDistance = (codeDna: SourceAnalysisCodeDna): number => {
  if (!measurableReading(codeDna.left) || !measurableReading(codeDna.right)) return 0;
  const left = codeDna.left;
  const right = codeDna.right;
  return (
    CODE_AXIS_IDS.reduce(
      (total, axis) => total + Math.abs(left.axes[axis].score - right.axes[axis].score),
      0,
    ) / CODE_AXIS_IDS.length
  );
};

const coverageScore = (reading: CodeDnaOutcome): number => {
  if (!measurableReading(reading)) return 0;
  const sampleCoverage = Math.min(reading.samples.length / 3, 1) * 60;
  const repositoryCoverage = Math.min(reading.repositoriesRepresented / 2, 1) * 40;
  return Math.round(sampleCoverage + repositoryCoverage);
};

const identitySpecificity = (reading: CodeDnaOutcome): number =>
  measurableReading(reading) ? (reading.label?.confidence ?? 30) : 0;

const themeSpecificity = (themeId: AllowedThemeId): number => {
  if (axisForTheme(themeId) !== null) return 90;
  if (themeId === "chimera-clash" || themeId === "hybrid-match") return 100;
  if (themeId === "coverage-gap") return 78;
  if (themeId === "limited-evidence") return 72;
  return 64;
};

const contrastStrength = (plan: StoryReadPlan, codeDna: SourceAnalysisCodeDna): number => {
  if (!measurableReading(codeDna.left) || !measurableReading(codeDna.right)) return 0;
  const axis = axisForTheme(plan.themeId);
  if (axis !== null) {
    return Math.min(
      100,
      Math.abs(codeDna.left.axes[axis].score - codeDna.right.axes[axis].score) * 4,
    );
  }
  if (plan.themeId === "mirror-match") return Math.max(0, 100 - averageAxisDistance(codeDna) * 5);
  if (plan.themeId === "chimera-clash")
    return isChimera(codeDna.left) !== isChimera(codeDna.right) ? 100 : 0;
  if (plan.themeId === "hybrid-match")
    return isChimera(codeDna.left) && isChimera(codeDna.right) ? 100 : 0;
  const leftCoverage = coverageScore(codeDna.left);
  const rightCoverage = coverageScore(codeDna.right);
  if (plan.themeId === "coverage-gap")
    return Math.min(100, Math.abs(leftCoverage - rightCoverage) * 2);
  return Math.max(0, 100 - Math.min(leftCoverage, rightCoverage));
};

const roastWeights: Readonly<
  Record<RoastMode, readonly [number, number, number, number, number, number]>
> = Object.freeze({
  clean: [0.28, 0.18, 0.2, 0.14, 0.15, 0.05],
  spicy: [0.25, 0.2, 0.15, 0.1, 0.25, 0.05],
  unhinged: [0.2, 0.2, 0.1, 0.08, 0.36, 0.06],
});

/**
 * Scores only already-valid local plans. The selector cannot change Code DNA,
 * canonical fields, or receipts; motif history is a bounded editorial penalty.
 */
export function selectDeterministicStoryReadPlan(
  battle: BattleResult,
  codeDna: SourceAnalysisCodeDna,
  context: StoryPlanContext = buildStoryPlanContext(battle, codeDna),
  options: DeterministicStoryPlanOptions = {},
): DeterministicStoryPlanSelection {
  const candidates = buildValidStoryPlanCandidates(battle, codeDna, context);
  const identity = Math.round(
    (identitySpecificity(codeDna.left) + identitySpecificity(codeDna.right)) / 2,
  );
  const source = Math.round(
    ((measurableReading(codeDna.left) ? codeDna.left.sourceConfidence : 0) +
      (measurableReading(codeDna.right) ? codeDna.right.sourceConfidence : 0)) /
      2,
  );
  const coverage = Math.round((coverageScore(codeDna.left) + coverageScore(codeDna.right)) / 2);
  const weights = roastWeights[battle.roast];
  const scoredCandidates = candidates.map((plan) => {
    const axis = Math.round(contrastStrength(plan, codeDna));
    const specificity = themeSpecificity(plan.themeId);
    const history = Math.max(0, options.motifHistory?.[motifId(plan)] ?? 0);
    const score =
      Math.round(
        (axis * weights[0] +
          identity * weights[1] +
          source * weights[2] +
          coverage * weights[3] +
          specificity * weights[4] -
          history * 20 * weights[5]) *
          100,
      ) / 100;
    return {
      plan,
      planId: storyPlanId(plan),
      score,
      factors: {
        axisContrastStrength: axis,
        identitySpecificity: identity,
        sourceConfidence: source,
        coverage,
        themeSpecificity: specificity,
        motifHistory: history,
        roastMode: battle.roast,
      },
    } satisfies StoryPlanScore;
  });
  const ranked = [...scoredCandidates].sort(
    (left, right) =>
      right.score - left.score ||
      stableIndex(`${battle.battleKey}:${left.planId}`, 65_521) -
        stableIndex(`${battle.battleKey}:${right.planId}`, 65_521) ||
      left.planId.localeCompare(right.planId),
  );
  const selected = ranked[0] ?? scoredCandidates[0];
  if (selected === undefined) throw new Error("No valid deterministic story-plan candidate.");
  return { plan: selected.plan, planId: selected.planId, scoredCandidates: ranked };
}

const readingSignature = (reading: CodeDnaOutcome): string => {
  if (reading.status !== "ready" && reading.status !== "partial") return reading.status;
  return `${CODE_AXIS_IDS.map(
    (axis) =>
      `${axis}:${String(reading.axes[axis].score)}:${String(reading.axes[axis].confidence)}`,
  ).join("|")}|samples:${reading.samples
    .map((sample) => sample.sampleId)
    .sort()
    .join(",")}`;
};

const preferredAngleForTheme = (
  reading: CodeDnaOutcome,
  allowed: readonly AllowedAngleId[],
  themeId: AllowedThemeId,
): AllowedAngleId => {
  const axis =
    themeId === "architecture-clash"
      ? "directAbstract"
      : themeId === "defense-clash"
        ? "vibeRitual"
        : themeId === "density-clash"
          ? "compactCeremonial"
          : themeId === "domain-clash"
            ? "applicationSystems"
            : null;
  const poles: Readonly<Record<CodeAxisId, readonly [AllowedAngleId, AllowedAngleId]>> = {
    directAbstract: ["direct-doer", "layer-builder"],
    vibeRitual: ["happy-path", "guard-rails"],
    compactCeremonial: ["compact-core", "ceremony-stack"],
    applicationSystems: ["application-wiring", "systems-depth"],
  };
  const special =
    themeId === "limited-evidence" || themeId === "coverage-gap"
      ? "limited-read"
      : themeId === "chimera-clash" || themeId === "hybrid-match"
        ? "chimera-blend"
        : null;
  if (special !== null && allowed.includes(special)) return special;
  if (axis !== null && (reading.status === "ready" || reading.status === "partial")) {
    const angle = poles[axis][reading.axes[axis].score >= 50 ? 1 : 0];
    if (allowed.includes(angle)) return angle;
  }
  return allowed[0] ?? "mixed-method";
};

/**
 * Builds three complete local candidates. Distinct visible contrast families are
 * represented before alternate finishers, so a broad identity cannot erase a
 * stronger axis-specific story. Finisher choice is deterministic from the battle
 * and deterministic reading, and is part of the selected plan family.
 */
export function buildValidStoryPlanCandidates(
  battle: BattleResult,
  codeDna: SourceAnalysisCodeDna,
  context: StoryPlanContext = buildStoryPlanContext(battle, codeDna),
): readonly [StoryReadPlan, StoryReadPlan, StoryReadPlan] {
  const fallback = deriveFallbackStoryReadPlan(battle, codeDna, context);
  const signature = `${battle.battleKey}|${readingSignature(codeDna.left)}|${readingSignature(codeDna.right)}`;
  const groups = new Map<string, StoryPlanMotif[]>();
  for (const motif of context.motifs) {
    const key = `${motif.themeId}:${motif.contrastId}`;
    const group = groups.get(key) ?? [];
    group.push(motif);
    groups.set(key, group);
  }
  const concepts = [...groups.entries()].map(([key, motifs]) => ({
    key,
    motifs,
    selectedIndex: stableIndex(`${signature}|${key}`, motifs.length),
  }));
  const selected: StoryPlanMotif[] = concepts.map(
    (concept) => concept.motifs[concept.selectedIndex] ?? concept.motifs[0]!,
  );
  for (let offset = 1; selected.length < 3; offset += 1) {
    for (const concept of concepts) {
      const motif = concept.motifs[(concept.selectedIndex + offset) % concept.motifs.length];
      if (motif !== undefined && !selected.includes(motif)) selected.push(motif);
      if (selected.length === 3) break;
    }
  }
  while (selected.length < 3) selected.push(context.motifs[selected.length] ?? fallback);

  const plans = selected.slice(0, 3).map((motif) => {
    const leftAngleId = preferredAngleForTheme(
      codeDna.left,
      context.allowedLeftAngleIds,
      motif.themeId,
    );
    const rightAngleId = preferredAngleForTheme(
      codeDna.right,
      context.allowedRightAngleIds,
      motif.themeId,
    );
    return {
      ...fallback,
      ...motif,
      leftAngleId,
      rightAngleId,
      leftSampleIds: sampleChoice(codeDna.left, leftAngleId),
      rightSampleIds: sampleChoice(codeDna.right, rightAngleId),
    };
  });
  return plans as unknown as readonly [StoryReadPlan, StoryReadPlan, StoryReadPlan];
}

const ANGLE_COPY: Readonly<Record<RoastMode, Readonly<Record<AllowedAngleId, string>>>> =
  Object.freeze({
    clean: {
      "direct-doer": "keeps behavior concrete and near the call site",
      "layer-builder": "routes behavior through deliberate layers",
      "guard-rails": "states contracts, guards, and error boundaries explicitly",
      "happy-path": "leans on visible assumptions and a clear happy path",
      "compact-core": "compresses the implementation into tight local moves",
      "ceremony-stack": "uses named scaffolding and repeated structure",
      "application-wiring": "orchestrates product flows and service boundaries",
      "systems-depth": "works close to protocols, pipelines, algorithms, or primitives",
      "mixed-method": "combines direct moves with selective structure",
      "chimera-blend": "blends several strong feature families without a dominant specialist",
      "limited-read": "supports a narrow style claim from limited valid source",
    },
    spicy: {
      "direct-doer": "gets to the behavior before indirection can book a meeting",
      "layer-builder": "makes each call earn its next abstraction",
      "guard-rails": "makes every boundary produce documentation",
      "happy-path": "trusts the payload and keeps moving",
      "compact-core": "packs the implementation into pocket-sized control flow",
      "ceremony-stack": "arrives with named wrappers and a floor plan",
      "application-wiring": "keeps the product plumbing under pressure",
      "systems-depth": "gives protocols, data paths, or algorithms first-class attention",
      "mixed-method": "changes tools whenever the problem changes shape",
      "chimera-blend": "switches style gears without losing the fingerprint",
      "limited-read": "keeps the claim sharp and inside the visible window",
    },
    unhinged: {
      "direct-doer": "kicks the call site open, handles the case, and leaves",
      "layer-builder": "built an elevator for the control flow",
      "guard-rails": "made every input survive a deposition",
      "happy-path": "gave the payload a key and wished it luck",
      "compact-core": "fits the module beneath one breakpoint",
      "ceremony-stack": "turned the call path into a municipal project",
      "application-wiring": "taught the service graph choreography",
      "systems-depth": "invited the protocol stack to argue back",
      "mixed-method": "keeps several playbooks open and somehow lands on the page",
      "chimera-blend": "got several code creatures to share one keyboard",
      "limited-read": "keeps the flashlight beam off every unseen file",
    },
  });

const MIRROR_ANGLE_COPY: Readonly<Record<RoastMode, string>> = Object.freeze({
  clean: "supports the same visible pole through a separate code trail",
  spicy: "hits the same style coordinate with a different fingerprint",
  unhinged: "found the same axis and left different claw marks",
});

const idsForSide = (
  evidenceIds: readonly string[],
  context: StoryPlanContext,
  side: Side,
): readonly string[] => {
  const known = side === "left" ? context.leftEvidenceIds : context.rightEvidenceIds;
  return evidenceIds.filter((id) => known.has(id));
};

const labelFor = (reading: CodeDnaOutcome): string =>
  measurableReading(reading) ? (reading.label?.name ?? "LIMITED READ") : "LIMITED READ";

const claim = (
  text: string,
  evidenceIds: readonly string[],
  sampleIds: readonly string[],
  target: StoryClaim["target"],
  slot: StoryClaim["slot"],
): StoryClaim => ({
  text,
  primaryEvidenceId: evidenceIds[0] ?? "",
  evidenceIds,
  sampleIds,
  target,
  slot,
});

const poleSides = (
  battle: BattleResult,
  plan: StoryReadPlan,
): { readonly first: string; readonly second: string } => {
  const leftIsSecond = [
    "left-more-abstract",
    "left-more-ritual",
    "left-more-ceremonial",
    "left-more-systems",
  ].includes(plan.contrastId);
  return leftIsSecond
    ? { first: battle.right.username, second: battle.left.username }
    : { first: battle.left.username, second: battle.right.username };
};

const templateValues = (
  battle: BattleResult,
  codeDna: SourceAnalysisCodeDna,
  plan: StoryReadPlan,
): Readonly<Record<string, string>> => {
  const poles = poleSides(battle, plan);
  const leftChimera = isChimera(codeDna.left);
  const leftCoverage = readingSampleCount(codeDna.left) + readingRepositoryCount(codeDna.left);
  const rightCoverage = readingSampleCount(codeDna.right) + readingRepositoryCount(codeDna.right);
  return {
    left: battle.left.username,
    right: battle.right.username,
    first: poles.first,
    second: poles.second,
    hybrid: leftChimera ? battle.left.username : battle.right.username,
    specialist: leftChimera ? battle.right.username : battle.left.username,
    broad: leftCoverage >= rightCoverage ? battle.left.username : battle.right.username,
    narrow: leftCoverage >= rightCoverage ? battle.right.username : battle.left.username,
  };
};

const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replaceAll(/\{([a-z]+)\}/g, (_match, key: string) => values[key] ?? "");

const personalizeFinisher = (battle: BattleResult, text: string): string => {
  const leftHandle = `@${battle.left.username}`;
  const rightHandle = `@${battle.right.username}`;
  const prefix = `${leftHandle}/${rightHandle}: `;
  const personalized = `${prefix}${text}`;
  if (Array.from(personalized).length <= 200) return personalized;
  return `${prefix}${text
    .replaceAll(leftHandle, "left side")
    .replaceAll(rightHandle, "right side")}`;
};

const variant = (
  battle: BattleResult,
  plan: StoryReadPlan,
  slot: "matchup" | "left" | "right" | "finisher",
  values: readonly string[],
): string =>
  selectTemplateVariant(
    values,
    `${battle.battleKey}:${STORY_TEMPLATE_SELECTION_VERSION}:${plan.themeId}:${plan.contrastId}:${plan.finisherId}:${plan.leftAngleId}:${plan.rightAngleId}:${battle.roast}:${slot}`,
  );

const swapsProfileTemplateSides = (
  codeDna: SourceAnalysisCodeDna,
  plan: StoryReadPlan,
): boolean => {
  if (
    [
      "left-more-abstract",
      "left-more-ritual",
      "left-more-ceremonial",
      "left-more-systems",
    ].includes(plan.contrastId)
  )
    return true;
  if (plan.themeId === "chimera-clash") return !isChimera(codeDna.left);
  if (plan.themeId === "coverage-gap") {
    const leftCoverage = readingSampleCount(codeDna.left) + readingRepositoryCount(codeDna.left);
    const rightCoverage = readingSampleCount(codeDna.right) + readingRepositoryCount(codeDna.right);
    return rightCoverage > leftCoverage;
  }
  return false;
};

export function renderStoryReadPlan(
  battle: BattleResult,
  codeDna: SourceAnalysisCodeDna,
  plan: StoryReadPlan,
  context: StoryPlanContext = buildStoryPlanContext(battle, codeDna),
): SourceAnalysisBattleRead {
  const templates = NARRATIVE_TEMPLATE_CORPUS[plan.themeId];
  const mode = battle.roast;
  const values = templateValues(battle, codeDna, plan);
  const leftEvidence = idsForSide(plan.evidenceIds, context, "left");
  const rightEvidence = idsForSide(plan.evidenceIds, context, "right");
  const swapProfiles = swapsProfileTemplateSides(codeDna, plan);
  const leftTemplate = variant(
    battle,
    plan,
    "left",
    (swapProfiles ? templates.rightRead : templates.leftRead)[mode],
  );
  const rightTemplate = variant(
    battle,
    plan,
    "right",
    (swapProfiles ? templates.leftRead : templates.rightRead)[mode],
  );
  return {
    matchupThesis: claim(
      fill(variant(battle, plan, "matchup", templates.matchup[mode]), values),
      plan.evidenceIds,
      [...plan.leftSampleIds, ...plan.rightSampleIds],
      "matchup",
      "matchup-thesis",
    ),
    leftRead: claim(
      fill(leftTemplate, {
        ...values,
        handle: battle.left.username,
        identity: labelFor(codeDna.left),
        angle: ANGLE_COPY[mode][plan.leftAngleId],
      }),
      leftEvidence,
      plan.leftSampleIds,
      "left",
      "left-read",
    ),
    rightRead: claim(
      fill(rightTemplate, {
        ...values,
        handle: battle.right.username,
        identity: labelFor(codeDna.right),
        angle:
          plan.rightAngleId === plan.leftAngleId
            ? MIRROR_ANGLE_COPY[mode]
            : ANGLE_COPY[mode][plan.rightAngleId],
      }),
      rightEvidence,
      plan.rightSampleIds,
      "right",
      "right-read",
    ),
    finisher: claim(
      personalizeFinisher(
        battle,
        fill(variant(battle, plan, "finisher", templates.finisher[mode]), values),
      ),
      plan.evidenceIds,
      [...plan.leftSampleIds, ...plan.rightSampleIds],
      "matchup",
      "finisher",
    ),
    alternates: [],
  };
}

/** Exported for calibration tests and reports. */
export const THEME_CONTRAST = SPECIAL_THEME_CONTRAST;
