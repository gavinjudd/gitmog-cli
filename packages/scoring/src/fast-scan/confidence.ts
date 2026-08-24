import { clampUnit, interpolate, round } from "./curves.js";
import type { ProfileSignals } from "./signals.js";
import type { ConfidenceGrade, ConfidenceReport, MetricResult } from "./types.js";

/**
 * A fast scan has read no source, and SCORECARD.md weights "amount of representative
 * code sampled" as a very-high confidence input. No fast scan can therefore be a
 * high-confidence result, and this cap is what stops the product implying otherwise.
 */
export const FAST_SCAN_CONFIDENCE_CAP = 70;

/** The basis a profile reaches when every fast-scan-measurable metric is measurable
 * for it. See ADR 0004 D2. */
export const MAXIMUM_FAST_SCAN_BASIS = 59;

/**
 * SCORECARD.md weights "number of analyzable substantial repos" and "amount of
 * representative code sampled" as very high, and the rest as high or medium. Depth
 * and substance are kept as separate factors because a profile can have full tree
 * coverage of one two-file repository, which is complete coverage of almost nothing.
 */
const FACTOR_WEIGHTS = Object.freeze({
  analyzedDepth: 0.25,
  substanceEvidence: 0.15,
  treeCoverage: 0.15,
  measuredWeight: 0.2,
  activityHistory: 0.15,
  languageCoverage: 0.1,
});

export function gradeForConfidence(score: number): ConfidenceGrade {
  if (score >= 90) return "high";
  if (score >= 70) return "good";
  if (score >= 50) return "limited";
  return "low";
}

export function buildConfidence(
  signals: ProfileSignals,
  metrics: readonly MetricResult[],
  measuredWeight: number,
): ConfidenceReport {
  const analyzed = signals.analyzed.length;
  const eligible = signals.eligible.length;
  const selected = signals.snapshot.selectedRepositories.length;

  const analyzedDepth = interpolate(analyzed, [
    [0, 0],
    [1, 0.35],
    [2, 0.62],
    [3, 0.85],
    [5, 1],
  ]);
  const substanceEvidence = interpolate(signals.substantial.length, [
    [0, 0],
    [1, 0.5],
    [2, 0.75],
    [3, 0.9],
    [5, 1],
  ]);
  const treeCoverage = selected === 0 ? 0 : analyzed / selected;
  const supported = signals.languageCoverage.supported.length;
  const unsupported = signals.languageCoverage.unsupported.length;
  const languageCoverage =
    supported + unsupported === 0 ? 0 : supported / (supported + unsupported);
  const activityHistory = !signals.hasEventEvidence
    ? 0.2
    : signals.snapshot.eventWindow.truncated
      ? 0.8
      : 1;

  const raw =
    FACTOR_WEIGHTS.analyzedDepth * clampUnit(analyzedDepth) +
    FACTOR_WEIGHTS.substanceEvidence * clampUnit(substanceEvidence) +
    FACTOR_WEIGHTS.treeCoverage * clampUnit(treeCoverage) +
    FACTOR_WEIGHTS.measuredWeight * clampUnit(measuredWeight / MAXIMUM_FAST_SCAN_BASIS) +
    FACTOR_WEIGHTS.activityHistory * activityHistory +
    FACTOR_WEIGHTS.languageCoverage * clampUnit(languageCoverage);

  const score = Math.min(FAST_SCAN_CONFIDENCE_CAP, Math.round(raw * 100));
  const grade = gradeForConfidence(score);

  const limitations = [
    `Public score: ${String(round(measuredWeight, 1))} of the scorecard's 100 points were measurable. Code DNA is versioned separately.`,
    ...new Set(
      metrics
        .map((metric) => metric.limitation)
        .filter((limitation): limitation is string => limitation !== undefined),
    ),
    ...signals.snapshot.degradations,
  ];
  if (unsupported > 0) {
    limitations.push(
      `Unsupported languages seen: ${signals.languageCoverage.unsupported.join(", ")}. Coverage is reduced; no penalty is applied.`,
    );
  }
  if (signals.analyzed.some((repository) => repository.treeTruncated)) {
    limitations.push("At least one repository tree was too large to read completely.");
  }

  return {
    grade,
    score,
    summary: summarize(grade, analyzed, eligible),
    analyzedRepositories: analyzed,
    eligibleRepositories: eligible,
    totalRepositories: signals.repositories.length,
    treeCoverage: round(clampUnit(treeCoverage), 3),
    measuredWeight: round(measuredWeight, 1),
    limitations,
  };
}

function summarize(grade: ConfidenceGrade, analyzed: number, eligible: number): string {
  const repositories = `${String(analyzed)} of ${String(eligible)} eligible ${
    eligible === 1 ? "repository" : "repositories"
  } inspected`;
  if (grade === "low") return `Low — thin public evidence, ${repositories}.`;
  if (grade === "limited") return `Limited — public score evidence, ${repositories}.`;
  return `Good — public score evidence, ${repositories}.`;
}
