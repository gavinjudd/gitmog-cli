import type { RoastMode } from "../fast-scan/types.js";

/** Mogsona catalog and classifier. Joins the battle key (ADR 0008 D6). */
export const MOGSONA_VERSION = "1.0.0-mogsona";

/** Aura Leak catalog and classifier. Joins the battle key (ADR 0008 D6). */
export const AURA_LEAK_VERSION = "1.0.0-aura-leak";

/**
 * How strongly the evidence supports the taxonomy assignment — **not** a percentile.
 *
 * Aura Class represents the strength and confidence of the evidence supporting this
 * taxonomy assignment. It is not a claim about percentile rarity across GitHub. Git Mog
 * has never measured a population, so it never describes one (ADR 0008 D3).
 */
export type AuraClass = "unrated" | "standard" | "distinctive" | "rare" | "mythic";

export const AURA_CLASSES = Object.freeze([
  "unrated",
  "standard",
  "distinctive",
  "rare",
  "mythic",
] as const);

export const auraClassRank = (value: AuraClass): number => AURA_CLASSES.indexOf(value);

export type AuraLeakSeverity = "light" | "notable" | "critical";

export interface Mogsona {
  readonly version: string;
  readonly id: string;
  readonly name: string;
  readonly auraClass: AuraClass;
  /** 0–100. Ranking only; the product prints the class, not this number. */
  readonly signalScore: number;
  /** The scorecard's own confidence, carried so a reader can weigh the assignment. */
  readonly confidence: number;
  readonly summary: string;
  readonly evidenceIds: readonly string[];
  readonly qualifyingSignals: readonly string[];
}

export interface AuraLeak {
  readonly version: string;
  readonly id: string;
  readonly name: string;
  readonly severity: AuraLeakSeverity;
  readonly evidenceIds: readonly string[];
  readonly qualifyingSignals: readonly string[];
}

/** One rejected or lower-scoring candidate. Diagnostic output for calibration only. */
export interface IdentityCandidate {
  readonly id: string;
  readonly signalScore: number;
  readonly evidenceCount: number;
  readonly eligible: boolean;
  readonly rejection: string | null;
}

export interface ProfileIdentity {
  readonly mogsona: Mogsona;
  readonly auraLeak: AuraLeak | null;
  readonly mogsonaCandidates: readonly IdentityCandidate[];
  readonly auraLeakCandidates: readonly IdentityCandidate[];
}

/**
 * The normalized vector every definition reads. Metric fields are the scorecard's own
 * `ratio` in 0–1, or `null` when the metric left the scoring basis — a `null` never
 * becomes a claim, it makes the definition that needs it ineligible.
 *
 * Popularity is absent by construction. Stars, forks and followers reach exactly one
 * place in this repository, the collector's selection ranking (ADR 0004 D6), and a test
 * asserts that mutating them cannot move a Mogsona.
 */
export interface IdentitySignals {
  readonly commits: number | null;
  readonly activeWeeks: number | null;
  readonly recency: number | null;
  readonly substantialProjects: number | null;
  readonly sustainedWork: number | null;
  readonly commitMessages: number | null;
  readonly repairLoops: number | null;
  readonly mergeHygiene: number | null;
  readonly externalWork: number | null;
  readonly released: number | null;
  readonly continuity: number | null;
  readonly testsExist: number | null;
  readonly testBreadth: number | null;
  readonly testWorkflow: number | null;
  readonly fileSize: number | null;
  readonly ci: number | null;
  readonly lint: number | null;
  readonly typing: number | null;
  readonly build: number | null;
  readonly automation: number | null;
  readonly organization: number | null;
  readonly documentation: number | null;
  readonly dependencies: number | null;
  readonly releaseHygiene: number | null;
  readonly abandonment: number | null;

  /** Category score 0–100, or `null` when nothing inside it was measurable. */
  readonly categoryScores: Readonly<Record<string, number | null>>;

  readonly publicCount: number;
  readonly eligibleCount: number;
  readonly substantialCount: number;
  readonly sustainedCount: number;
  readonly archivedCount: number;
  readonly forkCount: number;
  readonly abandonedCount: number;
  readonly inspectedCount: number;
  readonly testedCount: number;
  readonly ciCount: number;
  readonly monorepoCount: number;
  readonly releaseCount: number;
  readonly releaseRepositoryCount: number;
  readonly externalRepositoryCount: number;
  readonly mergedPullRequests: number;
  readonly activeWeeksObserved: number;
  readonly activeWeeksWindow: number;
  readonly annualizedCommits: number;
  readonly daysSinceLastPush: number | null;
  readonly commitSampleSize: number;
  readonly lowEffortRate: number;
  readonly repairRate: number;
  readonly revertRate: number;
  readonly languageCount: number;
  readonly substantialLanguageCount: number;

  /** Substantial repositories over eligible ones. 0 when nothing is eligible. */
  readonly substantialRatio: number;
  /** Forks over public repositories. 0 when there are none. */
  readonly forkRatio: number;
  /** Abandoned substantial repositories over substantial ones. */
  readonly abandonmentDensity: number;
  /** The largest substantial repository's share of all substantial repository bytes. */
  readonly dominantRepositoryShare: number;
  /** Releases per substantial repository. */
  readonly releaseDensity: number;

  readonly confidence: number;
  readonly measuredWeight: number;
  readonly treeCoverage: number;
  readonly overallScore: number;
  /**
   * Mean measured category score in 0–1. A specialized definition requires its own
   * dimension to *lead* this, so "CI ENJOYER" means CI is what stands out rather than
   * "this profile happens to be strong at everything, including CI".
   */
  readonly measuredBaseline: number;
}

export type SignalFunction = (signals: IdentitySignals) => number;
export type SignalPredicate = (signals: IdentitySignals) => boolean;

export interface MogsonaDefinition {
  readonly id: string;
  readonly name: string;
  /** The comedic premise, shared with the meme library for whole-battle dedupe. */
  readonly motif: string;
  /** Never `negative`: a negative-only signal cannot become a primary identity. */
  readonly polarity: "positive" | "neutral";
  /** Metric ids that must be measured, or the definition is ineligible. */
  readonly requiredMetrics: readonly string[];
  /** Metric ids whose evidence justifies the assignment. */
  readonly evidenceMetrics: readonly string[];
  readonly minimumEvidence: number;
  readonly minimumSignal: number;
  readonly minimumConfidence: number;
  /**
   * How much of a profile this identity explains, in 0–1, and therefore the highest
   * signal score it can reach. A broad identity like `ship_goblin` reads many dimensions
   * and can reach 1; a single-dimension specialist cannot, because a profile that is
   * strong at everything is not best described by one of its parts.
   *
   * This is what stops a uniformly excellent profile from producing a five-way tie at
   * 1.0 that then resolves alphabetically (ADR 0008 D5).
   */
  readonly specificity: number;
  /** Class ceiling. A definition that cannot honestly be extraordinary says so here. */
  readonly maximumClass: AuraClass;
  /** The extra, definition-specific condition `MYTHIC` requires (ADR 0008 D3). */
  readonly mythicGate: SignalPredicate;
  readonly blocks: SignalPredicate;
  readonly signal: SignalFunction;
  readonly qualifying: (signals: IdentitySignals) => readonly string[];
  readonly summary: string;
  readonly copy: Readonly<Record<RoastMode, string>>;
}

export interface AuraLeakDefinition {
  readonly id: string;
  readonly name: string;
  /** The comedic premise, shared with the meme template library for whole-battle dedupe. */
  readonly motif: string;
  readonly severity: AuraLeakSeverity;
  readonly requiredMetrics: readonly string[];
  readonly evidenceMetrics: readonly string[];
  readonly minimumEvidence: number;
  readonly minimumSignal: number;
  readonly blocks: SignalPredicate;
  readonly signal: SignalFunction;
  readonly qualifying: (signals: IdentitySignals) => readonly string[];
  readonly copy: Readonly<Record<RoastMode, string>>;
}
