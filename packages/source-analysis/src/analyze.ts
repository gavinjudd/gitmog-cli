import {
  CODE_AXIS_IDS,
  readCodeDna,
  type CodeDnaOptions,
  type CodeDnaOutcome,
} from "@gitmog/personality";
import { digest, type ProfileSnapshot } from "@gitmog/github";
import type { BattleResult, MemeLine } from "@gitmog/scoring";

import {
  buildStoryPlanContext,
  renderStoryReadPlan,
  selectDeterministicStoryReadPlan,
  sourceStoryEligibility,
} from "./story.js";
import {
  SOURCE_ANALYSIS_VERSION,
  STORY_VERSION,
  type ProfileSourceAnalysis,
  type SourceAnalysisCodeDna,
  type SourceAnalysisResult,
  type StoryClaim,
  type StoryResult,
} from "./types.js";

export interface AnalyzeBattleSourceOptions extends CodeDnaOptions {
  readonly battle: BattleResult;
  readonly snapshots: { readonly left: ProfileSnapshot; readonly right: ProfileSnapshot };
  /** Current-invocation metadata calls. Snapshots retain historical collection budgets
   * to keep source opportunity selection canonical across cache state. */
  readonly metadataRequestsUsed?: { readonly left: number; readonly right: number } | undefined;
  /** Remaining current-invocation source allowance after metadata collection. */
  readonly sourceRequestCaps?: { readonly left: number; readonly right: number } | undefined;
  readonly motifHistory?: Readonly<Record<string, number>> | undefined;
  readonly onSourceAnalysisComplete?: ((result: SourceAnalysisResult) => void) | undefined;
  readonly onStoryStart?: (() => void) | undefined;
  readonly onStoryComplete?: ((story: StoryResult) => void) | undefined;
}

export interface CompleteSourceAnalysis {
  readonly sourceAnalysis: SourceAnalysisResult;
  readonly story: StoryResult;
}

const measurable = (
  reading: CodeDnaOutcome,
): reading is Extract<CodeDnaOutcome, { status: "ready" | "partial" }> =>
  reading.status === "ready" || reading.status === "partial";

const profileResult = (codeDna: CodeDnaOutcome): ProfileSourceAnalysis => ({
  codeDna,
  samples: codeDna.samples,
  featureContributions: measurable(codeDna)
    ? CODE_AXIS_IDS.flatMap((axis) => codeDna.axes[axis].contributions)
    : [],
  limitations: codeDna.limitations,
});

const combinedStatus = (pair: SourceAnalysisCodeDna): SourceAnalysisResult["status"] =>
  pair.left.status === "ready" && pair.right.status === "ready"
    ? "ready"
    : pair.left.status === "insufficient" && pair.right.status === "insufficient"
      ? "insufficient"
      : "partial";

const canonicalClaim = (
  line: MemeLine,
  target: StoryClaim["target"],
  slot: StoryClaim["slot"],
): StoryClaim => ({
  text: line.text,
  primaryEvidenceId: line.evidenceIds[0] ?? "",
  evidenceIds: line.evidenceIds,
  sampleIds: [],
  target,
  slot,
});

export async function analyzeBattleSource(
  options: AnalyzeBattleSourceOptions,
): Promise<CompleteSourceAnalysis> {
  let leftSourceRequests = 0;
  let rightSourceRequests = 0;
  const [left, right] = await Promise.all([
    readCodeDna(options.snapshots.left, {
      ...options,
      ...(options.sourceRequestCaps === undefined
        ? {}
        : { maxRequests: options.sourceRequestCaps.left }),
      onRequestsUsed: (requests) => {
        leftSourceRequests = requests;
      },
    }),
    readCodeDna(options.snapshots.right, {
      ...options,
      ...(options.sourceRequestCaps === undefined
        ? {}
        : { maxRequests: options.sourceRequestCaps.right }),
      onRequestsUsed: (requests) => {
        rightSourceRequests = requests;
      },
    }),
  ]);
  const codeDna: SourceAnalysisCodeDna = { left, right };
  const eligibility = sourceStoryEligibility(codeDna);
  const analysisKey = digest({
    version: SOURCE_ANALYSIS_VERSION,
    left: options.snapshots.left.snapshotKey,
    right: options.snapshots.right.snapshotKey,
    leftSample: measurable(left) ? left.sampleKey : left.status,
    rightSample: measurable(right) ? right.sampleKey : right.status,
  });
  const leftMetadataRequests = options.metadataRequestsUsed?.left ?? 0;
  const rightMetadataRequests = options.metadataRequestsUsed?.right ?? 0;
  const leftBudget = {
    metadata: leftMetadataRequests,
    source: leftSourceRequests,
    total: leftMetadataRequests + leftSourceRequests,
    cap: options.snapshots.left.budget.maxRequests,
  };
  const rightBudget = {
    metadata: rightMetadataRequests,
    source: rightSourceRequests,
    total: rightMetadataRequests + rightSourceRequests,
    cap: options.snapshots.right.budget.maxRequests,
  };
  const sourceAnalysis: SourceAnalysisResult = {
    status: combinedStatus(codeDna),
    version: SOURCE_ANALYSIS_VERSION,
    analysisKey,
    left: profileResult(left),
    right: profileResult(right),
    requestBudget: {
      left: leftBudget,
      right: rightBudget,
      total: leftBudget.total + rightBudget.total,
      cap: leftBudget.cap + rightBudget.cap,
    },
  };
  options.onSourceAnalysisComplete?.(sourceAnalysis);
  options.onStoryStart?.();
  let story: StoryResult;
  if (eligibility.plan) {
    const context = buildStoryPlanContext(options.battle, codeDna);
    const selection = selectDeterministicStoryReadPlan(options.battle, codeDna, context, {
      ...(options.motifHistory === undefined ? {} : { motifHistory: options.motifHistory }),
    });
    const read = renderStoryReadPlan(options.battle, codeDna, selection.plan, context);
    story = {
      basis: "source",
      version: STORY_VERSION,
      planId: selection.planId,
      candidatePlanIds: selection.scoredCandidates.map((candidate) => candidate.planId),
      candidateScores: Object.fromEntries(
        selection.scoredCandidates.map((candidate) => [candidate.planId, candidate.score]),
      ),
      selectionFactors: Object.fromEntries(
        selection.scoredCandidates.map((candidate) => [candidate.planId, candidate.factors]),
      ),
      theme: selection.plan.themeId,
      contrast: selection.plan.contrastId,
      leftAngle: selection.plan.leftAngleId,
      rightAngle: selection.plan.rightAngleId,
      finisherFamily: selection.plan.finisherId,
      evidenceIds: selection.plan.evidenceIds,
      sampleIds: [...selection.plan.leftSampleIds, ...selection.plan.rightSampleIds],
      matchup: read.matchupThesis,
      leftRead: read.leftRead,
      rightRead: read.rightRead,
      finisher: read.finisher,
    };
  } else {
    const matchup = canonicalClaim(
      options.battle.narrative.matchupLine,
      "matchup",
      "matchup-thesis",
    );
    const finisher = canonicalClaim(options.battle.finishingMove, "matchup", "finisher");
    story = {
      basis: "canonical",
      version: STORY_VERSION,
      planId: null,
      candidatePlanIds: [],
      candidateScores: {},
      selectionFactors: {
        basis: "canonical-metadata-repository-battle",
        reason: "bilateral source-story eligibility was not met",
        eligibility,
      },
      theme: null,
      contrast: null,
      leftAngle: null,
      rightAngle: null,
      finisherFamily: null,
      evidenceIds: [...new Set([...matchup.evidenceIds, ...finisher.evidenceIds])],
      sampleIds: [],
      matchup,
      leftRead: null,
      rightRead: null,
      finisher,
    };
  }
  options.onStoryComplete?.(story);
  return { sourceAnalysis, story };
}
