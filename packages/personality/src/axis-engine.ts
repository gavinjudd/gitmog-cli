import {
  mergeSourceFeatures,
  type MergedSourceFeatures,
  type SourceFeatures,
} from "@gitmog/analyzers";
import type { CodeSample, SourceSampleSet } from "@gitmog/github";

import {
  CODE_AXIS_ENGINE_VERSION,
  CODE_AXIS_IDS,
  SOURCE_STYLE_FEATURE_IDS,
  type AxisContribution,
  type AxisCoverage,
  type CodeAxes,
  type CodeAxisId,
  type SourceStyleFeatureId,
  type SourceStyleFeatureReading,
} from "./types.js";

/**
 * Versioned deterministic Code DNA axis formula.
 *
 * Scores start from a declared neutral/application-aware baseline. Each measured
 * feature contributes only through the table below, and every term has an explicit
 * cap. The deliberately larger algorithm/protocol terms are visible here rather than
 * hidden in a tuned coefficient.
 */
export interface AxisFormulaTerm {
  readonly featureId: SourceStyleFeatureId;
  readonly direction: "first-pole" | "second-pole";
  readonly cap: number;
}

export interface AxisFormula {
  readonly axis: CodeAxisId;
  readonly baseline: number;
  readonly terms: readonly AxisFormulaTerm[];
}

const formula = (
  axis: CodeAxisId,
  baseline: number,
  terms: readonly AxisFormulaTerm[],
): AxisFormula => ({ axis, baseline, terms });

export const AXIS_FORMULAS: Readonly<Record<CodeAxisId, AxisFormula>> = Object.freeze({
  directAbstract: formula("directAbstract", 50, [
    { featureId: "thin-wrapper", direction: "first-pole", cap: 14 },
    { featureId: "compact-control-flow", direction: "first-pole", cap: 18 },
    { featureId: "layered-abstraction", direction: "second-pole", cap: 20 },
    { featureId: "generic-framework", direction: "second-pole", cap: 18 },
    { featureId: "ceremonial-boilerplate", direction: "second-pole", cap: 10 },
    { featureId: "stateful-orchestration", direction: "second-pole", cap: 8 },
  ]),
  vibeRitual: formula("vibeRitual", 42, [
    { featureId: "implicit-assumptions", direction: "first-pole", cap: 20 },
    { featureId: "compact-control-flow", direction: "first-pole", cap: 7 },
    { featureId: "explicit-validation", direction: "second-pole", cap: 20 },
    { featureId: "typed-contracts", direction: "second-pole", cap: 15 },
    { featureId: "guard-heavy", direction: "second-pole", cap: 18 },
    { featureId: "error-boundary", direction: "second-pole", cap: 14 },
  ]),
  compactCeremonial: formula("compactCeremonial", 48, [
    { featureId: "thin-wrapper", direction: "first-pole", cap: 12 },
    { featureId: "compact-control-flow", direction: "first-pole", cap: 20 },
    { featureId: "ceremonial-boilerplate", direction: "second-pole", cap: 20 },
    { featureId: "layered-abstraction", direction: "second-pole", cap: 14 },
    { featureId: "generic-framework", direction: "second-pole", cap: 15 },
    { featureId: "typed-contracts", direction: "second-pole", cap: 7 },
  ]),
  applicationSystems: formula("applicationSystems", 25, [
    { featureId: "application-orchestration", direction: "first-pole", cap: 12 },
    { featureId: "stateful-orchestration", direction: "first-pole", cap: 5 },
    { featureId: "protocol-handling", direction: "second-pole", cap: 30 },
    { featureId: "systems-primitives", direction: "second-pole", cap: 25 },
    { featureId: "algorithmic-core", direction: "second-pole", cap: 45 },
    { featureId: "data-pipeline", direction: "second-pole", cap: 24 },
  ]),
});

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));
const strength = (value: number, fullAt: number): number =>
  Math.round(clamp(value / fullAt, 0, 1) * 1000) / 1000;
const per100 = (count: number, lines: number): number => (lines === 0 ? 0 : (count / lines) * 100);
const average = (...values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

/** Detector support is explicit. Tier-one languages have the best-calibrated regexes;
 * tier-two languages retain useful measurements but carry a confidence limitation. */
const LANGUAGE_SUPPORT: Readonly<Record<string, number>> = Object.freeze({
  typescript: 1,
  javascript: 1,
  python: 1,
  go: 1,
  rust: 0.88,
  java: 0.85,
  csharp: 0.85,
  ruby: 0.82,
  php: 0.82,
  swift: 0.82,
  kotlin: 0.82,
  c: 0.8,
  cpp: 0.8,
  unknown: 0,
});

function featureStrengths(
  features: MergedSourceFeatures,
  typedLanguageRitual = ["typescript", "javascript", "python", "ruby", "php"].includes(
    features.language,
  )
    ? 1
    : 0.25,
): Readonly<Record<SourceStyleFeatureId, number>> {
  if (features.nonBlankLines === 0) {
    return Object.freeze(
      Object.fromEntries(SOURCE_STYLE_FEATURE_IDS.map((id) => [id, 0])) as Record<
        SourceStyleFeatureId,
        number
      >,
    );
  }
  const lines = features.nonBlankLines;
  const functions = per100(features.functionCount, lines);
  const types = per100(features.classOrTypeCount + features.typeAnnotationCount, lines);
  const classes = per100(features.classOrTypeCount, lines);
  const imports = per100(features.importCount, lines);
  const validation = per100(features.validationMarkers, lines);
  const guards = per100(features.guardMarkers, lines);
  const errors = per100(features.errorHandlingMarkers, lines);
  const async = per100(features.asyncMarkers, lines);
  const generics = per100(features.genericMarkers, lines);
  const factories = per100(features.factoryMarkers, lines);
  const protocols = per100(features.protocolMarkers, lines);
  const data = per100(features.dataLibraryMarkers, lines);
  const algorithms = per100(features.algorithmMarkers, lines);
  const ritual = validation + guards + errors + types * 0.22;
  const structure = classes + generics + factories;
  const classEvidence = strength(features.classOrTypeCount, 5);
  const genericEvidence = strength(features.genericMarkers, 5);
  const factoryEvidence = strength(features.factoryMarkers, 3);
  const importEvidence = strength(features.importCount, 6);
  const nestingEvidence = strength(Math.max(0, features.maximumNestingDepth - 3), 6);
  const frameworkEvidence = Math.max(factoryEvidence, Math.min(genericEvidence, classEvidence));
  return Object.freeze({
    "thin-wrapper": strength(
      average(strength(functions, 10), strength(Math.max(0, 5 - structure), 5)),
      1,
    ),
    "layered-abstraction": strength(
      average(classEvidence, factoryEvidence, Math.min(nestingEvidence, classEvidence)),
      1,
    ),
    "generic-framework": frameworkEvidence,
    "explicit-validation": strength(validation, 6),
    "typed-contracts": Math.round(strength(types, 20) * typedLanguageRitual * 1000) / 1000,
    "guard-heavy": strength(guards, 7),
    "implicit-assumptions": functions < 2 ? 0 : strength(Math.max(0, 5 - ritual), 5),
    "compact-control-flow": strength(
      average(
        strength(functions, 10),
        strength(Math.max(0, 78 - features.averageLineLength), 38),
        strength(Math.max(0, 7 - features.maximumNestingDepth), 6),
        strength(Math.max(0, 5 - structure), 5),
      ),
      1,
    ),
    "ceremonial-boilerplate": strength(
      average(classEvidence, factoryEvidence, importEvidence, frameworkEvidence),
      1,
    ),
    "application-orchestration":
      protocols + algorithms + data > 2
        ? 0
        : strength(average(strength(async, 5), strength(imports, 10), strength(functions, 8)), 1),
    "protocol-handling": strength(protocols, 5),
    "systems-primitives": strength(protocols + Math.max(0, features.maximumNestingDepth - 5), 8),
    "algorithmic-core": strength(algorithms, 3),
    "data-pipeline": strength(data, 4),
    "error-boundary":
      Math.round(strength(errors, 6) * (typedLanguageRitual === 1 ? 1 : 0.45) * 1000) / 1000,
    "stateful-orchestration": strength(
      average(strength(async, 5), strength(Math.max(0, features.maximumNestingDepth - 3), 5)),
      1,
    ),
  });
}

const sortedUnique = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const sampleFeatures = (
  samples: readonly CodeSample[],
): readonly { readonly sample: CodeSample; readonly features: SourceFeatures }[] =>
  samples.map((sample) => ({
    sample,
    features: sample.features,
  }));

function sampleIdsForFeature(
  featureId: SourceStyleFeatureId,
  measured: readonly { readonly sample: CodeSample; readonly features: SourceFeatures }[],
): readonly string[] {
  return measured
    .filter((entry) => {
      const merged = mergeSourceFeatures([entry.features]);
      return featureStrengths(merged)[featureId] > 0;
    })
    .map((entry) => entry.sample.sampleId)
    .sort((left, right) => left.localeCompare(right));
}

function axisConfidence(
  axis: AxisFormula,
  coverage: AxisCoverage,
  contributions: readonly AxisContribution[],
  input: SourceSampleSet,
): { readonly confidence: number; readonly limitations: readonly string[] } {
  const limitations: string[] = [];
  if (coverage.sampleCount < 2) limitations.push("single-file source view");
  if (coverage.repositoryCount < 2) limitations.push("single-repository source view");
  if (coverage.totalNonBlankLines < 24) limitations.push("limited measured source lines");
  if (coverage.supportedShare < 1) limitations.push("partial language-detector coverage");
  if (input.treeTruncated) limitations.push("at least one repository tree was truncated");
  if (input.samples.some((sample) => sample.truncated))
    limitations.push("at least one source sample was truncated");

  const sampleEvidence = Math.min(1, coverage.sampleCount / 3);
  const repositoryEvidence = Math.min(1, coverage.repositoryCount / 2);
  const lineEvidence = Math.min(1, coverage.totalNonBlankLines / 90);
  const diversity = Math.min(1, contributions.filter((entry) => entry.value >= 0.25).length / 3);
  const confidence = Math.round(
    20 +
      20 * coverage.supportedShare +
      18 * sampleEvidence +
      14 * repositoryEvidence +
      16 * lineEvidence +
      12 * diversity -
      (input.treeTruncated ? 7 : 0) -
      Math.min(12, input.samples.filter((sample) => sample.truncated).length * 4),
  );
  // An axis with no measured feature support cannot inherit confidence from unrelated files.
  const supported = contributions.some((entry) => entry.value >= 0.15);
  if (!supported) limitations.push(`weak measured support for ${axis.axis}`);
  return { confidence: clamp(supported ? confidence : confidence - 18, 0, 92), limitations };
}

export interface DeterministicAxisEvaluation {
  readonly axes: CodeAxes;
  readonly features: MergedSourceFeatures;
  readonly featureReadings: readonly SourceStyleFeatureReading[];
  readonly confidence: number;
  readonly coverage: AxisCoverage;
  readonly limitations: readonly string[];
}

export function calculateDeterministicAxes(input: SourceSampleSet): DeterministicAxisEvaluation {
  const measured = sampleFeatures(input.samples);
  // Unsupported languages contribute to coverage limitations, never to axis movement.
  // This prevents generic regex matches in an uncalibrated language from manufacturing
  // a strong style reading.
  const scored = measured.filter((entry) => (LANGUAGE_SUPPORT[entry.features.language] ?? 0) > 0);
  const features = mergeSourceFeatures(scored.map((entry) => entry.features));
  const languages = measured.map((entry) => entry.features.language);
  const supportedLanguages = sortedUnique(
    languages.filter((language) => (LANGUAGE_SUPPORT[language] ?? 0) > 0),
  );
  const unsupportedLanguages = sortedUnique(
    languages.filter((language) => (LANGUAGE_SUPPORT[language] ?? 0) === 0),
  );
  const supportedWeight = measured.reduce(
    (total, entry) => total + (LANGUAGE_SUPPORT[entry.features.language] ?? 0),
    0,
  );
  const coverage: AxisCoverage = Object.freeze({
    sampleCount: input.samples.length,
    repositoryCount: input.repositoriesRepresented,
    supportedSampleCount: measured.filter(
      (entry) => (LANGUAGE_SUPPORT[entry.features.language] ?? 0) > 0,
    ).length,
    supportedShare:
      measured.length === 0 ? 0 : Math.round((supportedWeight / measured.length) * 1000) / 1000,
    totalNonBlankLines: features.nonBlankLines,
    supportedLanguages,
    unsupportedLanguages,
  });
  // MergedSourceFeatures retains one compatibility language field. Use a stable
  // per-sample average instead, so mixed-language axes do not depend on sample order.
  const typedLanguageRitual =
    scored.length === 0
      ? 0
      : average(
          ...scored.map((entry) =>
            ["typescript", "javascript", "python", "ruby", "php"].includes(entry.features.language)
              ? 1
              : 0.25,
          ),
        );
  const strengths = featureStrengths(features, typedLanguageRitual);
  const featureReadings = SOURCE_STYLE_FEATURE_IDS.map((id) => ({
    id,
    strength: strengths[id],
    sampleIds: sampleIdsForFeature(id, scored),
  })).filter((entry) => entry.strength >= 0.15);
  const featureById = new Map(featureReadings.map((entry) => [entry.id, entry]));
  const sharedLimitations: string[] = [];
  if (input.samples.length === 0)
    sharedLimitations.push("no bounded source sample survived collection");
  if (unsupportedLanguages.length > 0)
    sharedLimitations.push(`unsupported feature language: ${unsupportedLanguages.join(", ")}`);

  const entries = CODE_AXIS_IDS.map((id): readonly [CodeAxisId, CodeAxes[CodeAxisId]] => {
    const axis = AXIS_FORMULAS[id];
    const contributions = axis.terms
      .map((term): AxisContribution | null => {
        const reading = featureById.get(term.featureId);
        if (reading === undefined) return null;
        const contribution = Math.min(
          term.cap,
          Math.round(reading.strength * term.cap * 100) / 100,
        );
        return {
          id: term.featureId,
          family: id,
          value: reading.strength,
          weight: term.cap,
          contribution,
          explanation: `${term.featureId} moves ${id} toward the ${term.direction === "first-pole" ? "first" : "second"} displayed pole.`,
          direction: term.direction,
          sampleIds: reading.sampleIds,
        };
      })
      .filter((entry): entry is AxisContribution => entry !== null);
    const offset = contributions.reduce(
      (total, entry) =>
        total + (entry.direction === "second-pole" ? entry.contribution : -entry.contribution),
      0,
    );
    const score = clamp(Math.round(axis.baseline + offset), 0, 100);
    const confidenceResult = axisConfidence(axis, coverage, contributions, input);
    const featureIds = contributions.filter((entry) => entry.value >= 0.2).map((entry) => entry.id);
    const sampleIds = sortedUnique(contributions.flatMap((entry) => entry.sampleIds));
    const limitations = sortedUnique([...sharedLimitations, ...confidenceResult.limitations]);
    return [
      id,
      {
        id,
        score,
        confidence: confidenceResult.confidence,
        direction: score < 40 ? "first-pole" : score > 60 ? "second-pole" : "neutral",
        sampleIds,
        signalCodes: featureIds,
        featureIds,
        contributions,
        coverage,
        limitations,
        axisEngineVersion: CODE_AXIS_ENGINE_VERSION,
      },
    ];
  });
  const axes = Object.fromEntries(entries) as CodeAxes;
  const confidence = Math.round(
    CODE_AXIS_IDS.reduce((total, id) => total + axes[id].confidence, 0) / CODE_AXIS_IDS.length,
  );
  return {
    axes,
    features,
    featureReadings,
    confidence,
    coverage,
    limitations: sortedUnique(CODE_AXIS_IDS.flatMap((id) => axes[id].limitations)),
  };
}
