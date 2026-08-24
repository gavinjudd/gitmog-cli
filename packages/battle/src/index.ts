export {
  ERROR_PRESENTATION,
  presentBattleError,
  type BattleError,
  type BattleErrorCode,
} from "./errors.js";
export {
  parseHandles,
  parseMatchup,
  prepareBattle,
  resolveRoast,
  runBattle,
  runCanonicalBattle,
  runCanonicalProfile,
  runProfile,
  type BattleSnapshots,
  type AnalysisProgressEvent,
  type AnalysisProgressReporter,
  type BattleRequest,
  type BattleServiceResult,
  type CanonicalBattleServiceResult,
  type CanonicalProfileServiceResult,
  type PreparedBattleResult,
  type ProfileRequest,
  type ProfileServiceResult,
} from "./run.js";
export type {
  CodeDnaOutcome,
  CodeDnaPair,
  CodeDnaPartial,
  CodeDnaReady,
  CodeDnaStatus,
} from "@gitmog/personality";
export type { SourceAnalysisResult, StoryResult } from "@gitmog/source-analysis";
export type { QualityJudgePair, QualityJudgeResult } from "@gitmog/quality-judge";
