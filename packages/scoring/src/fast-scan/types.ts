import type { AuraLeak, Mogsona } from "../identity/types.js";

export type RoastMode = "clean" | "spicy" | "unhinged";

export const ROAST_MODES = Object.freeze(["clean", "spicy", "unhinged"] as const);

export const DEFAULT_ROAST_MODE: RoastMode = "spicy";

export function parseRoastMode(value: string | null | undefined): RoastMode | null {
  const candidate = (value ?? "").trim().toLowerCase();
  return (ROAST_MODES as readonly string[]).includes(candidate) ? (candidate as RoastMode) : null;
}

export type Dimension = "ship" | "craft";

export type MetricAvailability = "available" | "partial" | "unavailable";

export type EvidencePolarity = "positive" | "negative" | "neutral";

export interface EvidenceItem {
  readonly id: string;
  readonly category: string;
  readonly metric: string;
  readonly polarity: EvidencePolarity;
  readonly title: string;
  readonly detail: string;
  readonly value?: number | string;
  readonly repository?: string;
  readonly sourceUrl: string;
}

export interface MetricResult {
  readonly id: string;
  readonly category: string;
  readonly label: string;
  readonly weight: number;
  readonly availability: MetricAvailability;
  readonly earned: number;
  readonly ratio: number;
  readonly detail: string;
  readonly limitation?: string;
  readonly evidenceIds: readonly string[];
}

export interface CategoryResult {
  readonly id: string;
  readonly dimension: Dimension;
  readonly memeLabel: string;
  readonly subtitle: string;
  readonly scorecardSection: string;
  readonly weight: number;
  readonly measuredWeight: number;
  readonly earned: number;
  /** 0–100 inside the category, so two profiles are comparable even when different
   * metrics were measurable for each. `null` when nothing in the category could be
   * measured at all. */
  readonly score: number | null;
  readonly metrics: readonly MetricResult[];
}

export type ConfidenceGrade = "high" | "good" | "limited" | "low";

export interface ConfidenceReport {
  readonly grade: ConfidenceGrade;
  readonly score: number;
  readonly summary: string;
  readonly analyzedRepositories: number;
  readonly eligibleRepositories: number;
  readonly totalRepositories: number;
  readonly treeCoverage: number;
  readonly measuredWeight: number;
  readonly limitations: readonly string[];
}

/** SCORECARD.md "Roast diagnostics": calculated, displayed, never scored. */
export interface Diagnostics {
  readonly publicRepositories: number;
  readonly eligibleRepositories: number;
  readonly substantialRepositories: number;
  readonly archivedRepositories: number;
  readonly forkedRepositories: number;
  readonly abandonedSubstantialRepositories: number;
  readonly repositoriesWithoutTests: number;
  readonly repositoriesWithoutCi: number;
  readonly repositoriesInspected: number;
  /** Inspected repositories whose tree carries a workspace layout. */
  readonly monorepoRepositories: number;
  /** Inspected repositories with at least one published release. */
  readonly releaseRepositories: number;
  /** Substantial repositories spanning six months or more. */
  readonly sustainedRepositories: number;
  /** Languages seen on substantial repositories only, so breadth means project breadth. */
  readonly substantialLanguages: readonly string[];
  /** The largest substantial repository's share of all substantial repository bytes. */
  readonly dominantRepositoryShare: number;
  readonly observedPushes: number;
  readonly commitSampleSize: number;
  readonly annualizedCommitEstimate: number;
  readonly activeWeeksObserved: number;
  readonly activeWeeksWindow: number;
  readonly daysSinceLastPublicPush: number | null;
  readonly medianCommitMessageLength: number;
  readonly lowEffortCommitMessageRate: number;
  readonly repairCommitRate: number;
  readonly revertRate: number;
  readonly externalRepositoriesTouched: number;
  readonly mergedPullRequests: number;
  readonly releaseCount: number;
  readonly largestSourceFileBytes: number;
  readonly languagesObserved: readonly string[];
  readonly unsupportedLanguages: readonly string[];
}

export interface ProfileScorecard {
  readonly username: string;
  readonly displayName: string | null;
  readonly avatarUrl: string;
  readonly profileUrl: string;
  readonly scoringVersion: string;
  readonly scanType: "fast";
  readonly overallScore: number;
  readonly grade: string;
  readonly categoryScores: Readonly<Record<string, number>>;
  readonly categories: readonly CategoryResult[];
  readonly metrics: readonly MetricResult[];
  readonly confidence: ConfidenceReport;
  readonly evidence: readonly EvidenceItem[];
  readonly positiveEvidence: readonly EvidenceItem[];
  readonly negativeEvidence: readonly EvidenceItem[];
  readonly diagnostics: Diagnostics;
  /** The profile's primary identity. Deterministic, opponent-independent, always
   * present, and always chosen deterministically (ADR 0008 D1). */
  readonly mogsona: Mogsona;
  /** At most one evidence-backed gremlin trait, or `null` when none qualifies. */
  readonly auraLeak: AuraLeak | null;
  readonly snapshotKey: string;
  readonly referenceDate: string;
}

export type VerdictClass =
  "mutual-aura" | "photo-finish" | "aura-edge" | "clean-mog" | "extreme-diff" | "nuclear-repo-gap";

export type Side = "left" | "right";

export type RoundWinner = Side | "tie" | "unscored";

export interface MemeLine {
  readonly text: string;
  readonly templateId: string;
  readonly atomId: string;
  readonly evidenceIds: readonly string[];
}

export interface BattleRound {
  readonly categoryId: string;
  readonly memeLabel: string;
  readonly subtitle: string;
  readonly leftScore: number | null;
  readonly rightScore: number | null;
  readonly leftEarned: number;
  readonly rightEarned: number;
  readonly winner: RoundWinner;
  readonly margin: number;
  readonly line: MemeLine;
  readonly leftEvidenceId: string | null;
  readonly rightEvidenceId: string | null;
}

export interface EvidenceDiff {
  readonly stronger: Side;
  readonly delta: number;
  readonly summary: string;
}

/**
 * One deterministic theme for the whole battle, derived from the strongest real contrast
 * before any line is selected, so the result reads as one argument rather than as a
 * sequence of unrelated jokes (ADR 0010 D1).
 */
export interface BattleNarrative {
  readonly version: string;
  readonly themeId: string;
  readonly dominantAtomId: string;
  readonly supportingAtomIds: readonly string[];
  readonly matchupLine: MemeLine;
}

/** The roast-mode-resolved identity copy. The assignment itself is on the scorecard. */
export interface IdentityLines {
  readonly mogsonaLine: MemeLine;
  readonly auraLeakLine: MemeLine | null;
}

/** Reproduction commands, so a reader can re-run the result rather than trust it. */
export interface BattleChallenge {
  readonly canonical: string;
  readonly runItBack: string;
  readonly nextVictim: string;
  readonly shareReceipt: string;
}

export interface BattleResult {
  readonly battleKey: string;
  readonly battlePath: string;
  readonly scoringVersion: string;
  /** The presentation versions that can alter canonical output, joined (ADR 0008 D6). */
  readonly presentationVersion: string;
  readonly mogsonaVersion: string;
  readonly auraLeakVersion: string;
  readonly memeEngineVersion: string;
  readonly scanType: "fast";
  readonly roast: RoastMode;
  readonly left: ProfileScorecard;
  readonly right: ProfileScorecard;
  readonly winner: RoundWinner;
  readonly margin: number;
  readonly verdictClass: VerdictClass;
  readonly verdictLabel: string;
  readonly headline: string;
  readonly rounds: readonly BattleRound[];
  readonly narrative: BattleNarrative;
  readonly identity: Readonly<Record<Side, IdentityLines>>;
  readonly finishingMove: MemeLine;
  readonly battleSummary: readonly MemeLine[];
  readonly strengths: Readonly<Record<Side, MemeLine>>;
  readonly weaknesses: Readonly<Record<Side, MemeLine | null>>;
  readonly shareCaption: string;
  readonly cardFinisher: string;
  readonly challenge: BattleChallenge;
  readonly evidenceDiff: EvidenceDiff | null;
  readonly createdFromSnapshotKeys: readonly [string, string];
}
