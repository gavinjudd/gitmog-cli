import type { AxisContribution, CodeDnaOutcome } from "@gitmog/personality";

export const SOURCE_ANALYSIS_VERSION = "1.2.0-cache-invariant-support";
export const STORY_VERSION = "1.2.0-human-readability-story";
export type SourceAnalysisStatus = "ready" | "partial" | "insufficient";
export type StoryTarget = "left" | "right" | "matchup";
export type StorySlot = "matchup-thesis" | "left-read" | "right-read" | "finisher" | "alternate";

export interface StoryClaim {
  readonly text: string;
  readonly primaryEvidenceId: string;
  readonly evidenceIds: readonly string[];
  readonly sampleIds: readonly string[];
  readonly target: StoryTarget;
  readonly slot: StorySlot;
}
export interface SourceAnalysisBattleRead {
  readonly matchupThesis: StoryClaim;
  readonly leftRead: StoryClaim;
  readonly rightRead: StoryClaim;
  readonly finisher: StoryClaim;
  readonly alternates: readonly StoryClaim[];
}

export const STORY_THEME_IDS = Object.freeze([
  "architecture-clash",
  "defense-clash",
  "density-clash",
  "domain-clash",
  "mirror-match",
  "chimera-clash",
  "hybrid-match",
  "coverage-gap",
  "limited-evidence",
] as const);
export type AllowedThemeId = (typeof STORY_THEME_IDS)[number];
export const STORY_ANGLE_IDS = Object.freeze([
  "direct-doer",
  "layer-builder",
  "guard-rails",
  "happy-path",
  "compact-core",
  "ceremony-stack",
  "application-wiring",
  "systems-depth",
  "mixed-method",
  "chimera-blend",
  "limited-read",
] as const);
export type AllowedAngleId = (typeof STORY_ANGLE_IDS)[number];
export const STORY_CONTRAST_IDS = Object.freeze([
  "left-more-abstract",
  "right-more-abstract",
  "left-more-ritual",
  "right-more-ritual",
  "left-more-ceremonial",
  "right-more-ceremonial",
  "left-more-systems",
  "right-more-systems",
  "similar-signals",
  "chimera-vs-specialist",
  "hybrid-vs-hybrid",
  "unequal-coverage",
  "limited-evidence",
] as const);
export type AllowedContrastId = (typeof STORY_CONTRAST_IDS)[number];
export const STORY_FINISHER_IDS = Object.freeze([
  "blueprint-vs-shortcut",
  "callsite-vs-layers",
  "concrete-vs-indirect",
  "checks-vs-instinct",
  "contract-vs-trust",
  "guards-vs-flow",
  "framework-vs-function",
  "pocket-vs-scaffold",
  "line-vs-structure",
  "product-vs-protocol",
  "workflow-vs-primitive",
  "service-vs-system",
  "same-tools-different-grip",
  "same-pole-different-receipt",
  "mirror-with-texture",
  "many-tools-vs-one",
  "range-vs-specialty",
  "coalition-vs-specialist",
  "hybrid-handoff",
  "shared-range-different-order",
  "hybrid-different-lead",
  "receipts-vs-range",
  "broad-vs-narrow-window",
  "coverage-weight",
  "small-sample-sharp-read",
  "bounded-but-valid",
  "narrow-window",
] as const);
export type AllowedFinisherId = (typeof STORY_FINISHER_IDS)[number];

export interface StoryReadPlan {
  readonly themeId: AllowedThemeId;
  readonly leftAngleId: AllowedAngleId;
  readonly rightAngleId: AllowedAngleId;
  readonly contrastId: AllowedContrastId;
  readonly finisherId: AllowedFinisherId;
  readonly evidenceIds: readonly string[];
  readonly leftSampleIds: readonly string[];
  readonly rightSampleIds: readonly string[];
}
export interface RankedStoryReadPlans {
  readonly plans: readonly [StoryReadPlan, StoryReadPlan, StoryReadPlan];
}
export interface SourceAnalysisCodeDna {
  readonly left: CodeDnaOutcome;
  readonly right: CodeDnaOutcome;
}

export interface ProfileSourceAnalysis {
  readonly codeDna: CodeDnaOutcome;
  readonly samples: CodeDnaOutcome["samples"];
  readonly featureContributions: readonly AxisContribution[];
  readonly limitations: readonly string[];
}
export interface SourceAnalysisResult {
  readonly status: SourceAnalysisStatus;
  readonly version: string;
  readonly analysisKey: string;
  readonly left: ProfileSourceAnalysis;
  readonly right: ProfileSourceAnalysis;
  readonly requestBudget: {
    readonly left: {
      readonly metadata: number;
      readonly source: number;
      readonly total: number;
      readonly cap: number;
    };
    readonly right: {
      readonly metadata: number;
      readonly source: number;
      readonly total: number;
      readonly cap: number;
    };
    readonly total: number;
    readonly cap: number;
  };
}
export interface StoryResult {
  /** Source plans exist only when both characterized profiles have valid source support. */
  readonly basis: "source" | "canonical";
  readonly version: string;
  readonly planId: string | null;
  readonly candidatePlanIds: readonly string[];
  readonly candidateScores: Readonly<Record<string, number>>;
  readonly selectionFactors: Readonly<Record<string, unknown>>;
  readonly theme: AllowedThemeId | null;
  readonly contrast: AllowedContrastId | null;
  readonly leftAngle: AllowedAngleId | null;
  readonly rightAngle: AllowedAngleId | null;
  readonly finisherFamily: AllowedFinisherId | null;
  readonly evidenceIds: readonly string[];
  readonly sampleIds: readonly string[];
  readonly matchup: StoryClaim;
  readonly leftRead: StoryClaim | null;
  readonly rightRead: StoryClaim | null;
  readonly finisher: StoryClaim;
}
