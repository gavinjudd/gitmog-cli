import type { MergedSourceFeatures } from "@gitmog/analyzers";

import { CODE_DNA_DEFINITIONS, type CodeDnaDefinition } from "./catalog.js";
import {
  CODE_AXIS_ENGINE_VERSION,
  CODE_AXIS_IDS,
  CODE_DNA_CONFIDENCE_FLOOR,
  isNeutralScore,
  type CodeAxes,
  type CodeDnaLabel,
  type CodeDnaCandidate,
  type SourceStyleFeatureId,
} from "./types.js";

export interface DerivedCodeDna {
  readonly label: CodeDnaLabel | null;
  readonly reason: string | null;
  readonly candidates: readonly CodeDnaCandidate[];
}

/** Euclidean distance across the four axis scores, normalized to 0–1. */
function axisDistance(axes: CodeAxes, definition: CodeDnaDefinition): number {
  let total = 0;
  for (const id of CODE_AXIS_IDS) {
    const delta = axes[id].score - definition.centroid[id];
    total += delta * delta;
  }
  // 200 is the diagonal of a 100-unit four-dimensional cube.
  return Math.sqrt(total) / 200;
}

/**
 * Local derivation. The deterministic axis engine returns axes, confidence, sample
 * references and feature ids; this function turns those measurements into a name.
 *
 * Deterministic: distance ranks, feature gates and blocks filter, and an exact tie
 * resolves on ascending id. Nothing here reads a clock or a random number.
 */
export function deriveCodeDna(
  axes: CodeAxes,
  features: MergedSourceFeatures,
  overallConfidence: number,
): DerivedCodeDna {
  if (overallConfidence < CODE_DNA_CONFIDENCE_FLOOR) {
    return {
      label: null,
      reason: "source sample too narrow for a confident style reading",
      candidates: [],
    };
  }

  const cited = new Set<SourceStyleFeatureId>();
  for (const id of CODE_AXIS_IDS) {
    for (const code of axes[id].featureIds) cited.add(code);
  }
  const neutralAxes = CODE_AXIS_IDS.filter((id) => isNeutralScore(axes[id].score)).length;

  const featureSampleIds = (featureIds: readonly SourceStyleFeatureId[]): readonly string[] =>
    [
      ...new Set(
        CODE_AXIS_IDS.flatMap((axisId) =>
          axes[axisId].contributions
            .filter((entry) => featureIds.includes(entry.id))
            .flatMap((entry) => entry.sampleIds),
        ),
      ),
    ].sort((left, right) => left.localeCompare(right));

  const specialistDefinitions = CODE_DNA_DEFINITIONS.filter((entry) => entry.hybrid !== true);

  const scoreDefinition = (entry: CodeDnaDefinition) => {
    const distance = axisDistance(axes, entry);
    const matchedFeatures = [...cited].filter((featureId) =>
      entry.requiredFeatureGroups.some((group) => group.includes(featureId)),
    );
    const failedAxisGate = entry.axisGates.find((gate) => {
      const score = axes[gate.axis].score;
      return (
        (gate.minimum !== undefined && score < gate.minimum) ||
        (gate.maximum !== undefined && score > gate.maximum)
      );
    });
    const rejection =
      failedAxisGate !== undefined
        ? failedAxisGate.reason
        : !entry.requiresFeatures(features)
          ? "deterministic source features do not support this label"
          : entry.requiredFeatureGroups.some(
                (group) => !group.some((featureId) => cited.has(featureId)),
              )
            ? "required deterministic feature support is absent"
            : entry.blocks(features, axes)
              ? "blocked"
              : overallConfidence < entry.minimumConfidence
                ? `confidence ${String(overallConfidence)} below ${String(entry.minimumConfidence)}`
                : null;
    return {
      entry,
      distance,
      candidate: {
        id: entry.id,
        distance: Math.round(distance * 1000) / 1000,
        eligible: rejection === null,
        rejection,
        featureIds: matchedFeatures,
        sampleIds: featureSampleIds(matchedFeatures),
      },
    };
  };

  const specialistScored = specialistDefinitions.map(scoreDefinition);
  const eligibleSpecialists = specialistScored
    .filter((item) => item.candidate.eligible)
    .sort((left, right) =>
      left.distance === right.distance
        ? left.entry.id.localeCompare(right.entry.id)
        : left.distance - right.distance,
    );

  const strongFeatures = [
    ...new Map(
      CODE_AXIS_IDS.flatMap((axisId) => axes[axisId].contributions)
        .filter((entry) => entry.value >= 0.45)
        .map((entry) => [entry.id, entry.value] as const),
    ).entries(),
  ];
  const familyOf = (featureId: SourceStyleFeatureId): string => {
    if (
      [
        "thin-wrapper",
        "layered-abstraction",
        "generic-framework",
        "compact-control-flow",
        "ceremonial-boilerplate",
      ].includes(featureId)
    )
      return "structure";
    if (
      [
        "explicit-validation",
        "typed-contracts",
        "guard-heavy",
        "implicit-assumptions",
        "error-boundary",
      ].includes(featureId)
    )
      return "defense";
    if (
      [
        "application-orchestration",
        "protocol-handling",
        "systems-primitives",
        "algorithmic-core",
        "data-pipeline",
      ].includes(featureId)
    )
      return "domain";
    return "orchestration";
  };
  const strongFamilies = new Set(strongFeatures.map(([featureId]) => familyOf(featureId)));
  const sortedStrengths = strongFeatures
    .map(([, featureStrength]) => featureStrength)
    .sort((a, b) => b - a);
  const topStrength = sortedStrengths[0] ?? 0;
  const totalStrength = sortedStrengths.reduce((total, value) => total + value, 0);
  const nonDominating = strongFeatures.length >= 4 && topStrength <= totalStrength * 0.45;
  const coverage = axes.directAbstract.coverage;
  const minimumAxisConfidence = Math.min(...CODE_AXIS_IDS.map((id) => axes[id].confidence));
  const bestSpecialist = eligibleSpecialists[0];
  const nextSpecialist = eligibleSpecialists[1];
  const specialistClearlyWins =
    bestSpecialist !== undefined &&
    bestSpecialist.distance <= 0.16 &&
    (nextSpecialist === undefined || nextSpecialist.distance - bestSpecialist.distance >= 0.04);
  const chimeraDefinition = CODE_DNA_DEFINITIONS.find((entry) => entry.hybrid === true);
  const chimeraBase = chimeraDefinition === undefined ? null : scoreDefinition(chimeraDefinition);
  const chimeraRejection =
    chimeraBase === null
      ? "CODE CHIMERA definition is unavailable"
      : (chimeraBase.candidate.rejection ??
        (coverage.sampleCount < 3 || coverage.repositoryCount < 2
          ? "CODE CHIMERA needs at least three samples across two repositories"
          : minimumAxisConfidence < 65
            ? "CODE CHIMERA needs at least 65 confidence on every axis"
            : strongFamilies.size < 3 || !nonDominating
              ? "CODE CHIMERA needs multiple strong, non-dominating style families"
              : specialistClearlyWins
                ? "a specialist identity clearly wins"
                : null));
  const chimeraScored =
    chimeraBase === null
      ? []
      : [
          {
            ...chimeraBase,
            candidate: {
              ...chimeraBase.candidate,
              eligible: chimeraRejection === null,
              rejection: chimeraRejection,
              featureIds: strongFeatures.map(([featureId]) => featureId),
              sampleIds: featureSampleIds(strongFeatures.map(([featureId]) => featureId)),
            },
          },
        ];
  const scored = [...specialistScored, ...chimeraScored];

  const candidates = scored
    .map((item) => item.candidate)
    .sort((left, right) =>
      left.distance === right.distance
        ? left.id.localeCompare(right.id)
        : left.distance - right.distance,
    );

  const eligible = scored
    .filter((item) => item.candidate.eligible)
    .sort((left, right) =>
      left.distance === right.distance
        ? left.entry.id.localeCompare(right.entry.id)
        : left.distance - right.distance,
    );

  const eligibleChimera = eligible.find((item) => item.entry.hybrid === true);
  const chosen = eligibleChimera ?? eligible[0];
  if (chosen === undefined) {
    const axisContradiction = scored.some((item) =>
      item.entry.axisGates.some((gate) => item.candidate.rejection === gate.reason),
    );
    return {
      label: null,
      reason: axisContradiction
        ? "bounded source coverage did not support a compatible Code DNA identity"
        : "bounded source evidence did not support a Code DNA identity",
      candidates,
    };
  }
  if (neutralAxes === CODE_AXIS_IDS.length && chosen.entry.hybrid !== true) {
    return { label: null, reason: "low-distinction source evidence", candidates };
  }
  const selectedFeatures = chosen.candidate.featureIds;
  return {
    label: {
      id: chosen.entry.id,
      name: chosen.entry.name,
      copy: chosen.entry.copy,
      confidence: overallConfidence,
      featureIds: selectedFeatures,
      sampleIds: chosen.candidate.sampleIds,
      axisEngineVersion: CODE_AXIS_ENGINE_VERSION,
    },
    reason: null,
    candidates,
  };
}
