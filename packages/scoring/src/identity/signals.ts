import type {
  ConfidenceReport,
  Diagnostics,
  EvidenceItem,
  MetricResult,
} from "../fast-scan/types.js";

import type { IdentitySignals } from "./types.js";

/**
 * The subset of a scorecard identity reads. `ProfileScorecard` satisfies it
 * structurally, so a caller passes the whole card and the classifier still cannot reach
 * anything it should not — there is no repository list and no popularity field here.
 */
export interface IdentityInput {
  readonly metrics: readonly MetricResult[];
  readonly diagnostics: Diagnostics;
  readonly confidence: ConfidenceReport;
  readonly evidence: readonly EvidenceItem[];
  readonly categoryScores: Readonly<Record<string, number>>;
  readonly overallScore: number;
}

/** `null` when the metric left the scoring basis. A `null` blocks; it never scores. */
function ratioOf(metrics: readonly MetricResult[], id: string): number | null {
  const found = metrics.find((metric) => metric.id === id);
  return found === undefined || found.availability === "unavailable" ? null : found.ratio;
}

const share = (part: number, whole: number): number => (whole <= 0 ? 0 : part / whole);

const CATEGORY_IDS = [
  "ship.frequency",
  "ship.substance",
  "ship.discipline",
  "ship.breadth",
  "craft.testing",
  "craft.maintainability",
  "craft.tooling",
  "craft.hygiene",
  "craft.quality",
] as const;

export function deriveIdentitySignals(input: IdentityInput): IdentitySignals {
  const { metrics, diagnostics: d, confidence } = input;
  const categoryScores: Record<string, number | null> = {};
  const measured: number[] = [];
  for (const id of CATEGORY_IDS) {
    const score = input.categoryScores[id] ?? null;
    categoryScores[id] = score;
    if (score !== null) measured.push(score);
  }
  const measuredBaseline =
    measured.length === 0 ? 0 : measured.reduce((a, b) => a + b, 0) / measured.length / 100;

  return {
    commits: ratioOf(metrics, "ship.frequency.commits"),
    activeWeeks: ratioOf(metrics, "ship.frequency.activeWeeks"),
    recency: ratioOf(metrics, "ship.frequency.recency"),
    substantialProjects: ratioOf(metrics, "ship.substance.substantialProjects"),
    sustainedWork: ratioOf(metrics, "ship.substance.sustainedWork"),
    commitMessages: ratioOf(metrics, "ship.discipline.messages"),
    repairLoops: ratioOf(metrics, "ship.discipline.repairLoops"),
    mergeHygiene: ratioOf(metrics, "ship.discipline.mergeHygiene"),
    externalWork: ratioOf(metrics, "ship.breadth.external"),
    released: ratioOf(metrics, "ship.breadth.released"),
    continuity: ratioOf(metrics, "ship.breadth.continuity"),
    testsExist: ratioOf(metrics, "craft.testing.exists"),
    testBreadth: ratioOf(metrics, "craft.testing.breadth"),
    testWorkflow: ratioOf(metrics, "craft.testing.workflow"),
    fileSize: ratioOf(metrics, "craft.maintainability.fileSize"),
    ci: ratioOf(metrics, "craft.tooling.ci"),
    lint: ratioOf(metrics, "craft.tooling.lint"),
    typing: ratioOf(metrics, "craft.tooling.typing"),
    build: ratioOf(metrics, "craft.tooling.build"),
    automation: ratioOf(metrics, "craft.tooling.automation"),
    organization: ratioOf(metrics, "craft.hygiene.organization"),
    documentation: ratioOf(metrics, "craft.hygiene.documentation"),
    dependencies: ratioOf(metrics, "craft.hygiene.dependencies"),
    releaseHygiene: ratioOf(metrics, "craft.hygiene.releases"),
    abandonment: ratioOf(metrics, "craft.hygiene.abandonment"),

    categoryScores,

    publicCount: d.publicRepositories,
    eligibleCount: d.eligibleRepositories,
    substantialCount: d.substantialRepositories,
    sustainedCount: d.sustainedRepositories,
    archivedCount: d.archivedRepositories,
    forkCount: d.forkedRepositories,
    abandonedCount: d.abandonedSubstantialRepositories,
    inspectedCount: d.repositoriesInspected,
    testedCount: Math.max(0, d.repositoriesInspected - d.repositoriesWithoutTests),
    ciCount: Math.max(0, d.repositoriesInspected - d.repositoriesWithoutCi),
    monorepoCount: d.monorepoRepositories,
    releaseCount: d.releaseCount,
    releaseRepositoryCount: d.releaseRepositories,
    externalRepositoryCount: d.externalRepositoriesTouched,
    mergedPullRequests: d.mergedPullRequests,
    activeWeeksObserved: d.activeWeeksObserved,
    activeWeeksWindow: d.activeWeeksWindow,
    annualizedCommits: d.annualizedCommitEstimate,
    daysSinceLastPush: d.daysSinceLastPublicPush,
    commitSampleSize: d.commitSampleSize,
    lowEffortRate: d.lowEffortCommitMessageRate,
    repairRate: d.repairCommitRate,
    revertRate: d.revertRate,
    languageCount: d.languagesObserved.length,
    substantialLanguageCount: d.substantialLanguages.length,

    substantialRatio: share(d.substantialRepositories, d.eligibleRepositories),
    forkRatio: share(d.forkedRepositories, d.publicRepositories),
    abandonmentDensity: share(d.abandonedSubstantialRepositories, d.substantialRepositories),
    dominantRepositoryShare: d.dominantRepositoryShare,
    releaseDensity: share(d.releaseCount, d.substantialRepositories),

    confidence: confidence.score,
    measuredWeight: confidence.measuredWeight,
    treeCoverage: confidence.treeCoverage,
    overallScore: input.overallScore,
    measuredBaseline,
  };
}

/**
 * True when `own` stands out against the profile's own measured baseline. This is what
 * separates a specialist identity from a uniformly strong profile: a definition that
 * names one dimension may only fire when that dimension is what leads.
 */
export function leads(own: number | null, signals: IdentitySignals, margin: number): own is number {
  return own !== null && own >= signals.measuredBaseline + margin;
}

/** Ceiling-free 0–1 clamp used by every signal function. */
export const unit = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * A saturating ramp: 0 at or below `floor`, 1 at or above `ceiling`. Every threshold in
 * the identity catalog is expressed with this, so a definition is read as a set of
 * bands rather than as a chain of comparisons.
 */
export function ramp(value: number, floor: number, ceiling: number): number {
  if (ceiling <= floor) return value >= ceiling ? 1 : 0;
  return unit((value - floor) / (ceiling - floor));
}

/** The inverse ramp, for signals where less is better. */
export function inverseRamp(value: number, floor: number, ceiling: number): number {
  return 1 - ramp(value, floor, ceiling);
}

/** Weighted mean of `[weight, value]` pairs. Absent values drop out of both sides. */
export function weighted(parts: readonly (readonly [number, number | null])[]): number {
  let total = 0;
  let sum = 0;
  for (const [weight, value] of parts) {
    if (value === null) continue;
    total += weight;
    sum += weight * value;
  }
  return total === 0 ? 0 : unit(sum / total);
}
