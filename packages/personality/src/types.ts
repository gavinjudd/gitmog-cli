import type { CodeSampleReceipt, SourceSampleFailureReason } from "@gitmog/github";

export const CODE_AXIS_ENGINE_VERSION = "3.1.0-explainable-source-style";
export const CODE_DNA_VERSION = CODE_AXIS_ENGINE_VERSION;
export type AnalysisCacheDisposition = "stable" | "transient";

export const CODE_AXIS_IDS = Object.freeze([
  "directAbstract",
  "vibeRitual",
  "compactCeremonial",
  "applicationSystems",
] as const);
export type CodeAxisId = (typeof CODE_AXIS_IDS)[number];

export const NEUTRAL_LOW = 40;
export const NEUTRAL_HIGH = 60;
export const CODE_AXIS_POLES: Readonly<Record<CodeAxisId, readonly [string, string]>> =
  Object.freeze({
    directAbstract: ["DIRECT", "ABSTRACT"],
    vibeRitual: ["VIBE", "RITUAL"],
    compactCeremonial: ["COMPACT", "CEREMONIAL"],
    applicationSystems: ["APPLICATION", "SYSTEMS"],
  });

export const CODE_SIGNAL_CODES = Object.freeze([
  "thin-wrapper",
  "layered-abstraction",
  "generic-framework",
  "explicit-validation",
  "typed-contracts",
  "guard-heavy",
  "implicit-assumptions",
  "compact-control-flow",
  "ceremonial-boilerplate",
  "application-orchestration",
  "protocol-handling",
  "systems-primitives",
  "algorithmic-core",
  "data-pipeline",
  "error-boundary",
  "stateful-orchestration",
] as const);
export type CodeSignalCode = (typeof CODE_SIGNAL_CODES)[number];
export const SOURCE_STYLE_FEATURE_IDS = CODE_SIGNAL_CODES;
export type SourceStyleFeatureId = CodeSignalCode;

export interface AxisCoverage {
  readonly sampleCount: number;
  readonly repositoryCount: number;
  readonly supportedSampleCount: number;
  readonly supportedShare: number;
  readonly totalNonBlankLines: number;
  readonly supportedLanguages: readonly string[];
  readonly unsupportedLanguages: readonly string[];
}

export interface AxisContribution {
  readonly id: SourceStyleFeatureId;
  readonly family: string;
  readonly value: number;
  readonly weight: number;
  readonly contribution: number;
  readonly explanation: string;
  readonly direction: "first-pole" | "second-pole";
  readonly sampleIds: readonly string[];
}

export interface CodeAxisReading {
  readonly id: CodeAxisId;
  readonly score: number;
  readonly confidence: number;
  readonly direction: "first-pole" | "neutral" | "second-pole";
  readonly sampleIds: readonly string[];
  readonly signalCodes: readonly CodeSignalCode[];
  readonly featureIds: readonly SourceStyleFeatureId[];
  readonly contributions: readonly AxisContribution[];
  readonly coverage: AxisCoverage;
  readonly limitations: readonly string[];
  readonly axisEngineVersion: string;
}
export type CodeAxes = Readonly<Record<CodeAxisId, CodeAxisReading>>;

export interface SourceStyleFeatureReading {
  readonly id: SourceStyleFeatureId;
  readonly strength: number;
  readonly sampleIds: readonly string[];
}

export interface CodeDnaLabel {
  readonly id: string;
  readonly name: string;
  readonly copy: Readonly<Record<"clean" | "spicy" | "unhinged", string>>;
  readonly confidence: number;
  readonly featureIds: readonly SourceStyleFeatureId[];
  readonly sampleIds: readonly string[];
  readonly axisEngineVersion: string;
}

export interface CodeDnaCandidate {
  readonly id: string;
  readonly distance: number;
  readonly eligible: boolean;
  readonly rejection: string | null;
  readonly featureIds: readonly SourceStyleFeatureId[];
  readonly sampleIds: readonly string[];
}

interface CodeDnaMeasured {
  readonly version: string;
  readonly sampleVersion: string;
  readonly axisEngineVersion: string;
  readonly sampleKey: string;
  readonly axes: CodeAxes;
  readonly labelCandidates: readonly CodeDnaCandidate[];
  readonly confidence: number;
  readonly sourceConfidence: number;
  readonly featureIds: readonly SourceStyleFeatureId[];
  readonly featureContributions: readonly SourceStyleFeatureReading[];
  readonly samples: readonly CodeSampleReceipt[];
  readonly repositoriesRepresented: number;
  readonly limitations: readonly string[];
  /** Structured collection provenance; cache policy never depends on display copy. */
  readonly sourceFailureReasons: readonly SourceSampleFailureReason[];
}

export interface CodeDnaReady extends CodeDnaMeasured {
  readonly status: "ready";
  readonly cacheDisposition: "stable";
  readonly label: CodeDnaLabel;
}
export interface CodeDnaPartial extends CodeDnaMeasured {
  readonly status: "partial";
  readonly cacheDisposition: AnalysisCacheDisposition;
  readonly reason: string;
  readonly label?: CodeDnaLabel | undefined;
}
export interface CodeDnaInsufficient {
  readonly status: "insufficient";
  readonly version: string;
  readonly reason: string;
  readonly sourceFailureReason?: SourceSampleFailureReason | undefined;
  readonly samples: readonly CodeSampleReceipt[];
  readonly limitations: readonly string[];
}

export type CodeDnaStatus = "ready" | "partial" | "insufficient";
export type CodeDnaOutcome = CodeDnaReady | CodeDnaPartial | CodeDnaInsufficient;
export interface CodeDnaPair {
  readonly left: CodeDnaOutcome;
  readonly right: CodeDnaOutcome;
}

export const CODE_DNA_CONFIDENCE_FLOOR = 45;
export const isNeutralScore = (score: number): boolean =>
  score >= NEUTRAL_LOW && score <= NEUTRAL_HIGH;
