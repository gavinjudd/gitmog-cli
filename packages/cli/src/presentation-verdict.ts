import type { CodeDnaOutcome } from "@gitmog/personality";
import type { SourceAnalysisResult } from "@gitmog/source-analysis";
import type { BattleResult, VerdictClass } from "@gitmog/scoring";

export const PRESENTATION_VERDICT_VERSION = "1.0.0-coverage-aware";

export type PresentationVerdictBand = "full-strength" | "qualified" | "limited";
export type PresentationVerdictReason =
  | "full-coverage"
  | "coverage-below-70"
  | "coverage-below-50"
  | "coverage-gap-over-20"
  | "coverage-gap-over-30"
  | "material-collector-degradation";

export interface PresentationVerdict {
  readonly version: typeof PRESENTATION_VERDICT_VERSION;
  readonly band: PresentationVerdictBand;
  readonly label: string;
  readonly minimumCoverage: number;
  readonly coverageDifference: number;
  readonly reasonCodes: readonly PresentationVerdictReason[];
}

const EXTREME_VERDICTS = new Set<VerdictClass>(["extreme-diff", "nuclear-repo-gap"]);
const MATERIAL_SOURCE_FAILURES = new Set([
  "rate-limited",
  "request-budget-exhausted",
  "tree-unavailable",
  "blob-unavailable",
  "timeout",
  "transport-failure",
  "upstream-failure",
  "incomplete-github-response",
  "unknown",
]);

const sourceFailureReasons = (outcome: CodeDnaOutcome): readonly string[] =>
  "sourceFailureReasons" in outcome
    ? outcome.sourceFailureReasons
    : outcome.sourceFailureReason === undefined
      ? []
      : [outcome.sourceFailureReason];

export const hasMaterialCollectorDegradation = (
  battle: BattleResult,
  source: SourceAnalysisResult,
): boolean =>
  EXTREME_VERDICTS.has(battle.verdictClass) &&
  [source.left.codeDna, source.right.codeDna]
    .flatMap(sourceFailureReasons)
    .some((reason) => MATERIAL_SOURCE_FAILURES.has(reason));

const qualifiedLabel = (battle: BattleResult): string => {
  if (battle.winner === "tie") return "PUBLIC TAPE EVEN";
  switch (battle.verdictClass) {
    case "nuclear-repo-gap":
    case "extreme-diff":
      return "PUBLIC REPO GAP";
    case "clean-mog":
      return "CLEAR PUBLIC EDGE";
    default:
      return "PUBLIC TAPE GAP";
  }
};

const limitedLabel = (battle: BattleResult): string =>
  battle.winner === "tie" ? "INCOMPLETE TAPE" : "PUBLIC EDGE · LIMITED READ";

export function derivePresentationVerdict(
  battle: BattleResult,
  source: SourceAnalysisResult,
): PresentationVerdict {
  const leftCoverage = battle.left.confidence.measuredWeight;
  const rightCoverage = battle.right.confidence.measuredWeight;
  const minimumCoverage = Math.min(leftCoverage, rightCoverage);
  const coverageDifference = Math.abs(leftCoverage - rightCoverage);
  const materialCollectorDegradation = hasMaterialCollectorDegradation(battle, source);
  const reasonCodes: PresentationVerdictReason[] = [];

  let band: PresentationVerdictBand;
  if (minimumCoverage < 50 || coverageDifference > 30 || materialCollectorDegradation) {
    band = "limited";
    if (minimumCoverage < 50) reasonCodes.push("coverage-below-50");
    if (coverageDifference > 30) reasonCodes.push("coverage-gap-over-30");
    if (materialCollectorDegradation) reasonCodes.push("material-collector-degradation");
  } else if (minimumCoverage < 70 || coverageDifference > 20) {
    band = "qualified";
    if (minimumCoverage < 70) reasonCodes.push("coverage-below-70");
    if (coverageDifference > 20) reasonCodes.push("coverage-gap-over-20");
  } else {
    band = "full-strength";
    reasonCodes.push("full-coverage");
  }

  return {
    version: PRESENTATION_VERDICT_VERSION,
    band,
    label:
      band === "full-strength"
        ? battle.verdictLabel
        : band === "qualified"
          ? qualifiedLabel(battle)
          : limitedLabel(battle),
    minimumCoverage,
    coverageDifference,
    reasonCodes,
  };
}
