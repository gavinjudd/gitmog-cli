export {
  CATEGORY_WEIGHTS,
  MAXIMUM_SCORE,
  SCORE_CATEGORIES,
  type ScoreCategory,
} from "./categories.js";
export {
  foundationScoreFixture,
  type CategorySubscores,
  type FoundationScorecard,
} from "./foundation-fixture.js";
export { SCORING_VERSION } from "./version.js";

export {
  DEFAULT_PRESENTATION_VERSIONS,
  PRESENTATION_VERSION,
  absoluteUrl,
  battleKeyFor,
  battlePathFor,
  buildBattle,
  reproduceCommand,
  type BattlePresentationVersions,
  type BuildBattleOptions,
} from "./fast-scan/battle.js";
export {
  CATEGORY_BY_ID,
  CATEGORY_DEFINITIONS,
  FAST_SCAN_SCORING_VERSION,
  METRIC_BY_ID,
  METRIC_DEFINITIONS,
  SCAN_TYPE,
  UNMEASURABLE_IN_FAST_SCAN,
  gradeForScore,
  type CategoryDefinition,
  type MetricDefinition,
} from "./fast-scan/catalog.js";
export {
  FAST_SCAN_CONFIDENCE_CAP,
  MAXIMUM_FAST_SCAN_BASIS,
  gradeForConfidence,
} from "./fast-scan/confidence.js";
export { interpolate, round } from "./fast-scan/curves.js";
export { scoreProfileFastScan } from "./fast-scan/scorecard.js";
export {
  ACTIVE_WEEK_WINDOW,
  commitMessageStatistics,
  deriveSignals,
  type ProfileSignals,
  type RepositoryEvidence,
} from "./fast-scan/signals.js";
export {
  AURA_CLASSES,
  AURA_LEAK_DEFINITIONS,
  AURA_LEAK_VERSION,
  MOGSONA_DEFINITIONS,
  MOGSONA_VERSION,
  assignIdentity,
  auraClassRank,
  deriveIdentitySignals,
  type AuraClass,
  type AuraLeak,
  type AuraLeakDefinition,
  type AuraLeakSeverity,
  type IdentityCandidate,
  type IdentityInput,
  type IdentitySignals,
  type Mogsona,
  type MogsonaDefinition,
  type ProfileIdentity,
} from "./identity/index.js";

export {
  DEFAULT_ROAST_MODE,
  ROAST_MODES,
  parseRoastMode,
  type BattleChallenge,
  type BattleNarrative,
  type BattleResult,
  type BattleRound,
  type CategoryResult,
  type ConfidenceGrade,
  type ConfidenceReport,
  type Diagnostics,
  type EvidenceDiff,
  type EvidenceItem,
  type EvidencePolarity,
  type IdentityLines,
  type MemeLine,
  type MetricAvailability,
  type MetricResult,
  type ProfileScorecard,
  type RoastMode,
  type RoundWinner,
  type Side,
  type VerdictClass,
} from "./fast-scan/types.js";
export { VERDICT_CLASSES, classifyVerdict, type VerdictDefinition } from "./fast-scan/verdict.js";

export {
  ATOM_BY_ID,
  ATOM_PRIORITY,
  ATOM_TOKEN_NAMES,
  MEME_ATOMS,
  atomPriority,
  evaluateAtoms,
} from "./meme/atoms.js";
export {
  MOTIF_BUDGET,
  MemeEngine,
  fnv1a32,
  type MemeEngineOptions,
  type SelectedLine,
  type Surface,
} from "./meme/engine.js";
export { THEME_BOOST, selectTheme, themeBoostFor, type ThemeSelection } from "./meme/narrative.js";
export {
  GENERIC_COPY_PATTERNS,
  PROHIBITED_PATTERNS,
  UNSUPPORTED_CLAIM_PATTERNS,
  findGenericCopy,
  findSafetyViolations,
  findUnsupportedClaims,
  isSafeMemeText,
} from "./meme/safety.js";
export { MEME_TEMPLATES, TEMPLATE_COUNTS } from "./meme/templates.js";
export {
  MEME_ENGINE_VERSION,
  NARRATIVE_THEMES,
  SPICY_FULL_COPY_MINIMUM,
  SPICY_SHORT_COPY_MINIMUM,
  type AtomContext,
  type AtomFacts,
  type MemeAtom,
  type MemeSlot,
  type MemeTemplate,
  type NarrativeTheme,
} from "./meme/types.js";
