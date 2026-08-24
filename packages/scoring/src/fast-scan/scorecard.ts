import type { ProfileSnapshot } from "@gitmog/github";

import { assignIdentity } from "../identity/classify.js";

import {
  CATEGORY_DEFINITIONS,
  FAST_SCAN_SCORING_VERSION,
  SCAN_TYPE,
  gradeForScore,
} from "./catalog.js";
import { buildConfidence } from "./confidence.js";
import { round } from "./curves.js";
import { scoreMetrics } from "./metrics.js";
import { commitMessageStatistics, ACTIVE_WEEK_WINDOW, deriveSignals } from "./signals.js";
import type {
  CategoryResult,
  Diagnostics,
  EvidenceItem,
  MetricResult,
  ProfileScorecard,
} from "./types.js";

const ORDERED_CATEGORIES = [...CATEGORY_DEFINITIONS].sort(
  (left, right) => left.displayOrder - right.displayOrder,
);

const isMeasured = (metric: MetricResult): boolean => metric.availability !== "unavailable";

/**
 * Pure. Reads no clock, performs no I/O, and contains no randomness: every age is
 * derived from `snapshot.referenceDate`. The same snapshot always produces the same
 * scorecard at the same scoring version.
 */
export function scoreProfileFastScan(snapshot: ProfileSnapshot): ProfileScorecard {
  const signals = deriveSignals(snapshot);
  const { metrics, evidence } = scoreMetrics(signals);

  const categories: CategoryResult[] = ORDERED_CATEGORIES.map((definition) => {
    const owned = metrics.filter((metric) => metric.category === definition.id);
    const measured = owned.filter(isMeasured);
    const measuredWeight = measured.reduce((total, metric) => total + metric.weight, 0);
    const earned = measured.reduce((total, metric) => total + metric.earned, 0);
    return {
      id: definition.id,
      dimension: definition.dimension,
      memeLabel: definition.memeLabel,
      subtitle: definition.subtitle,
      scorecardSection: definition.scorecardSection,
      weight: definition.weight,
      measuredWeight: round(measuredWeight, 2),
      earned: round(earned, 3),
      score: measuredWeight === 0 ? null : round((earned / measuredWeight) * 100, 1),
      metrics: owned,
    };
  });

  const measuredMetrics = metrics.filter(isMeasured);
  const basis = measuredMetrics.reduce((total, metric) => total + metric.weight, 0);
  const earned = measuredMetrics.reduce((total, metric) => total + metric.earned, 0);
  const overallScore = basis === 0 ? 0 : Math.round((earned / basis) * 100);

  const categoryScores: Record<string, number> = {};
  for (const category of categories) {
    if (category.score !== null) categoryScores[category.id] = category.score;
  }

  const confidence = buildConfidence(signals, metrics, basis);
  const ordered = orderEvidence(evidence, categories);
  const diagnostics = buildDiagnostics(signals);
  // Identity is a pure function of what scoring just measured (ADR 0008 D1). It reads no
  // clock, makes no external prose call, and never touches a popularity field.
  const identity = assignIdentity({
    metrics,
    diagnostics,
    confidence,
    evidence: ordered,
    categoryScores,
    overallScore,
  });

  return {
    username: snapshot.profile.login,
    displayName: snapshot.profile.name,
    avatarUrl: snapshot.profile.avatarUrl,
    profileUrl: snapshot.profile.htmlUrl,
    scoringVersion: FAST_SCAN_SCORING_VERSION,
    scanType: SCAN_TYPE,
    overallScore,
    grade: gradeForScore(overallScore),
    categoryScores,
    categories,
    metrics,
    confidence,
    evidence: ordered,
    positiveEvidence: ordered.filter((item) => item.polarity === "positive"),
    negativeEvidence: ordered.filter((item) => item.polarity === "negative"),
    diagnostics,
    mogsona: identity.mogsona,
    auraLeak: identity.auraLeak,
    snapshotKey: snapshot.snapshotKey,
    referenceDate: snapshot.referenceDate,
  };
}

function orderEvidence(
  evidence: readonly EvidenceItem[],
  categories: readonly CategoryResult[],
): readonly EvidenceItem[] {
  const order = new Map(categories.map((category, index) => [category.id, index]));
  return [...evidence].sort((left, right) => {
    const leftOrder = order.get(left.category) ?? 99;
    const rightOrder = order.get(right.category) ?? 99;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.id.localeCompare(right.id);
  });
}

function buildDiagnostics(signals: ReturnType<typeof deriveSignals>): Diagnostics {
  const stats = commitMessageStatistics(signals.commitMessages);
  const analyzed = signals.analyzed;
  return {
    publicRepositories: signals.repositories.length,
    eligibleRepositories: signals.eligible.length,
    substantialRepositories: signals.substantial.length,
    archivedRepositories: signals.archivedCount,
    forkedRepositories: signals.forkCount,
    abandonedSubstantialRepositories: signals.abandoned.length,
    repositoriesWithoutTests: analyzed.filter(
      (repository) => repository.structure?.hasTests !== true,
    ).length,
    repositoriesWithoutCi: analyzed.filter((repository) => repository.structure?.hasCi !== true)
      .length,
    repositoriesInspected: analyzed.length,
    monorepoRepositories: signals.monorepoCount,
    releaseRepositories: signals.releaseRepositoryCount,
    sustainedRepositories: signals.sustainedCount,
    substantialLanguages: signals.substantialLanguages,
    dominantRepositoryShare: round(signals.dominantRepositoryShare, 4),
    observedPushes: signals.observedPushes,
    commitSampleSize: signals.commitSampleSize,
    annualizedCommitEstimate: Math.round(signals.annualizedCommits),
    activeWeeksObserved: signals.activeWeeks,
    activeWeeksWindow: ACTIVE_WEEK_WINDOW,
    daysSinceLastPublicPush:
      signals.daysSinceLastPublicPush === null ? null : Math.round(signals.daysSinceLastPublicPush),
    medianCommitMessageLength: Math.round(stats.medianLength),
    lowEffortCommitMessageRate: round(stats.lowEffortRate, 3),
    repairCommitRate: round(stats.repairRate, 3),
    revertRate: round(stats.revertRate, 3),
    externalRepositoriesTouched: signals.externalRepositories.length,
    mergedPullRequests: signals.mergedPullRequests,
    releaseCount: signals.totalReleases,
    largestSourceFileBytes: analyzed.reduce(
      (largest, repository) => Math.max(largest, repository.structure?.largestSourceFileBytes ?? 0),
      0,
    ),
    languagesObserved: signals.languagesObserved,
    unsupportedLanguages: signals.languageCoverage.unsupported,
  };
}
