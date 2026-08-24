export { AURA_LEAK_BY_ID, AURA_LEAK_DEFINITIONS } from "./aura-leak-catalog.js";
export {
  calibrationRow,
  checkCalibration,
  renderCalibrationReport,
  type CalibrationExpectation,
  type CalibrationFinding,
  type CalibrationRow,
} from "./calibrate.js";
export { assignIdentity, compareIdentityCandidates, deriveIdentitySignals } from "./classify.js";
export { MOGSONA_BY_ID, MOGSONA_DEFINITIONS, MOGSONA_FALLBACK_IDS } from "./mogsona-catalog.js";
export { inverseRamp, leads, ramp, unit, weighted, type IdentityInput } from "./signals.js";
export {
  AURA_CLASSES,
  AURA_LEAK_VERSION,
  MOGSONA_VERSION,
  auraClassRank,
  type AuraClass,
  type AuraLeak,
  type AuraLeakDefinition,
  type AuraLeakSeverity,
  type IdentityCandidate,
  type IdentitySignals,
  type Mogsona,
  type MogsonaDefinition,
  type ProfileIdentity,
} from "./types.js";
