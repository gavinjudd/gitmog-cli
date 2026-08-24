import type { EvidenceItem, MetricResult } from "../fast-scan/types.js";

import { AURA_LEAK_DEFINITIONS } from "./aura-leak-catalog.js";
import { MOGSONA_BY_ID, MOGSONA_DEFINITIONS, MOGSONA_FALLBACK_IDS } from "./mogsona-catalog.js";
import { deriveIdentitySignals, type IdentityInput } from "./signals.js";
import {
  AURA_LEAK_VERSION,
  MOGSONA_VERSION,
  auraClassRank,
  type AuraClass,
  type AuraLeak,
  type AuraLeakDefinition,
  type IdentityCandidate,
  type IdentitySignals,
  type Mogsona,
  type MogsonaDefinition,
  type ProfileIdentity,
} from "./types.js";

/**
 * Aura Class thresholds. Fast-scan confidence is capped at 70 (ADR 0004 D8), so `mythic`
 * at 62 and `rare` at 55 are deliberately close to that ceiling: the top classes are
 * reachable, but only with near-complete public coverage.
 */
const CLASS_RULES: readonly {
  readonly auraClass: Exclude<AuraClass, "unrated">;
  readonly signal: number;
  readonly confidence: number;
  readonly evidence: number;
  readonly signals: number;
  readonly requiresGate: boolean;
}[] = Object.freeze([
  {
    auraClass: "mythic",
    signal: 0.88,
    confidence: 62,
    evidence: 3,
    signals: 3,
    requiresGate: true,
  },
  { auraClass: "rare", signal: 0.78, confidence: 55, evidence: 3, signals: 3, requiresGate: false },
  {
    auraClass: "distinctive",
    signal: 0.62,
    confidence: 45,
    evidence: 2,
    signals: 2,
    requiresGate: false,
  },
  {
    auraClass: "standard",
    signal: 0.4,
    confidence: 0,
    evidence: 1,
    signals: 1,
    requiresGate: false,
  },
]);

function classify(
  definition: MogsonaDefinition,
  signals: IdentitySignals,
  signalScore: number,
  evidenceCount: number,
): AuraClass {
  const gateOpen = definition.mythicGate(signals);
  const independent = definition.qualifying(signals).length;
  for (const rule of CLASS_RULES) {
    if (rule.requiresGate && !gateOpen) continue;
    if (
      signalScore >= rule.signal &&
      signals.confidence >= rule.confidence &&
      evidenceCount >= rule.evidence &&
      independent >= rule.signals
    ) {
      return capClass(rule.auraClass, definition.maximumClass);
    }
  }
  return "unrated";
}

const capClass = (value: AuraClass, ceiling: AuraClass): AuraClass =>
  auraClassRank(value) <= auraClassRank(ceiling) ? value : ceiling;

/** Stable tie-break shared by both candidate lists and directly asserted in tests. */
export function compareIdentityCandidates(
  left: Pick<IdentityCandidate, "id" | "signalScore">,
  right: Pick<IdentityCandidate, "id" | "signalScore">,
): number {
  return right.signalScore === left.signalScore
    ? left.id.localeCompare(right.id)
    : right.signalScore - left.signalScore;
}

/**
 * Positive evidence ids belonging to the definition's own metrics, in the scorecard's
 * own order. `stealth_builder` is the sole definition allowed to fall back to neutral
 * coverage evidence, because "there is not much here" is itself a measured statement.
 */
function selectEvidence(
  evidence: readonly EvidenceItem[],
  metricIds: readonly string[],
  allowNeutral: boolean,
): readonly string[] {
  const wanted = new Set(metricIds);
  const positive = evidence.filter(
    (item) => wanted.has(item.metric) && item.polarity === "positive",
  );
  if (positive.length > 0 || !allowNeutral) return positive.map((item) => item.id);
  return evidence
    .filter((item) => wanted.has(item.metric) && item.polarity !== "negative")
    .map((item) => item.id);
}

const measured = (metrics: readonly MetricResult[], id: string): boolean => {
  const found = metrics.find((metric) => metric.id === id);
  return found !== undefined && found.availability !== "unavailable";
};

interface Scored {
  readonly definition: MogsonaDefinition;
  readonly signalScore: number;
  readonly evidenceIds: readonly string[];
  readonly candidate: IdentityCandidate;
}

function scoreMogsona(
  definition: MogsonaDefinition,
  input: IdentityInput,
  signals: IdentitySignals,
): Scored {
  const isFallback = (MOGSONA_FALLBACK_IDS as readonly string[]).includes(definition.id);
  const evidenceIds = selectEvidence(
    input.evidence,
    definition.evidenceMetrics,
    definition.id === "stealth_builder",
  );
  // Specificity is the ceiling on how high this identity's score can reach, so a broad
  // identity outranks a specialist on a profile that is strong across the board.
  const signalScore = definition.signal(signals) * definition.specificity;
  const missing = definition.requiredMetrics.filter((id) => !measured(input.metrics, id));
  const rejection =
    missing.length > 0
      ? `unmeasured: ${missing.join(", ")}`
      : definition.blocks(signals)
        ? "blocked"
        : signalScore < definition.minimumSignal
          ? `signal ${signalScore.toFixed(3)} below ${definition.minimumSignal.toFixed(2)}`
          : signals.confidence < definition.minimumConfidence
            ? `confidence ${String(signals.confidence)} below ${String(definition.minimumConfidence)}`
            : evidenceIds.length < definition.minimumEvidence
              ? `evidence ${String(evidenceIds.length)} below ${String(definition.minimumEvidence)}`
              : null;

  return {
    definition,
    signalScore,
    evidenceIds,
    candidate: {
      id: definition.id,
      signalScore: Math.round(signalScore * 1000) / 1000,
      evidenceCount: evidenceIds.length,
      eligible: rejection === null && !isFallback,
      rejection,
    },
  };
}

function buildMogsona(scored: Scored, signals: IdentitySignals): Mogsona {
  const { definition } = scored;
  return {
    version: MOGSONA_VERSION,
    id: definition.id,
    name: definition.name,
    auraClass: classify(definition, signals, scored.signalScore, scored.evidenceIds.length),
    signalScore: Math.round(scored.signalScore * 100),
    confidence: signals.confidence,
    summary: definition.summary,
    evidenceIds: scored.evidenceIds,
    qualifyingSignals: definition.qualifying(signals),
  };
}

function scoreAuraLeak(
  definition: AuraLeakDefinition,
  input: IdentityInput,
  signals: IdentitySignals,
): {
  readonly leak: AuraLeak | null;
  readonly signalScore: number;
  readonly candidate: IdentityCandidate;
} {
  // A leak cites every evidence item behind its metrics, whatever the polarity, because
  // most leaks are a *contradiction*: strong documentation and no releases needs both
  // halves on the page or the joke has no receipt.
  const wanted = new Set(definition.evidenceMetrics);
  const evidenceIds = input.evidence
    .filter((item) => wanted.has(item.metric))
    .map((item) => item.id);
  const signalScore = definition.signal(signals);
  const missing = definition.requiredMetrics.filter((id) => !measured(input.metrics, id));

  const rejection =
    missing.length > 0
      ? `unmeasured: ${missing.join(", ")}`
      : definition.blocks(signals)
        ? "blocked"
        : signalScore < definition.minimumSignal
          ? `signal ${signalScore.toFixed(3)} below ${definition.minimumSignal.toFixed(2)}`
          : evidenceIds.length < definition.minimumEvidence
            ? `evidence ${String(evidenceIds.length)} below ${String(definition.minimumEvidence)}`
            : null;

  return {
    leak:
      rejection === null
        ? {
            version: AURA_LEAK_VERSION,
            id: definition.id,
            name: definition.name,
            severity: definition.severity,
            evidenceIds,
            qualifyingSignals: definition.qualifying(signals),
          }
        : null,
    signalScore,
    candidate: {
      id: definition.id,
      signalScore: Math.round(signalScore * 1000) / 1000,
      evidenceCount: evidenceIds.length,
      eligible: rejection === null,
      rejection,
    },
  };
}

/**
 * Severity nudges the ranking rather than dominating it. Making severity the primary key
 * meant a marginal `notable` leak always beat an overwhelming `light` one, which is how
 * `RELEASE AVOIDER` ended up printed on profiles whose real story was something else.
 */
const SEVERITY_BONUS: Readonly<Record<string, number>> = Object.freeze({
  critical: 0.2,
  notable: 0.1,
  light: 0,
});

const leakRank = (severity: string, signalScore: number): number =>
  signalScore + (SEVERITY_BONUS[severity] ?? 0);

/**
 * Deterministic. Reads no clock, performs no I/O and uses no randomness.
 * Selection is: eligible definitions ranked by signal score, exact ties broken by
 * ascending stable id, then the documented fallback chain (ADR 0008 D5).
 */
export function assignIdentity(input: IdentityInput): ProfileIdentity {
  const signals = deriveIdentitySignals(input);

  const scored = MOGSONA_DEFINITIONS.map((definition) => scoreMogsona(definition, input, signals));
  const eligible = scored
    .filter((entry) => entry.candidate.eligible)
    .sort((left, right) =>
      compareIdentityCandidates(
        { id: left.definition.id, signalScore: left.signalScore },
        { id: right.definition.id, signalScore: right.signalScore },
      ),
    );

  const chosen = eligible[0] ?? resolveFallback(scored);
  const mogsona = buildMogsona(chosen, signals);

  const leaks = AURA_LEAK_DEFINITIONS.map((definition) =>
    scoreAuraLeak(definition, input, signals),
  );
  const qualified = leaks
    .filter((entry) => entry.leak !== null)
    .sort((left, right) => {
      const leftLeak = left.leak as AuraLeak;
      const rightLeak = right.leak as AuraLeak;
      const byRank =
        leakRank(rightLeak.severity, right.signalScore) -
        leakRank(leftLeak.severity, left.signalScore);
      if (byRank !== 0) return byRank;
      return leftLeak.id.localeCompare(rightLeak.id);
    });

  return {
    mogsona,
    auraLeak: qualified[0]?.leak ?? null,
    mogsonaCandidates: [...scored].map((entry) => entry.candidate).sort(compareIdentityCandidates),
    auraLeakCandidates: leaks.map((entry) => entry.candidate).sort(compareIdentityCandidates),
  };
}

/** `stealth_builder` blocks on nothing and needs no evidence, so this always resolves. */
function resolveFallback(scored: readonly Scored[]): Scored {
  for (const id of MOGSONA_FALLBACK_IDS) {
    const entry = scored.find((candidate) => candidate.definition.id === id);
    if (entry === undefined) continue;
    if (entry.candidate.rejection === null) return entry;
  }
  const stealth = scored.find((entry) => entry.definition.id === "stealth_builder");
  if (stealth === undefined) {
    throw new Error("stealth_builder must be present in the Mogsona catalog");
  }
  return stealth;
}

/** Exported for the calibration harness, which reports the vector beside the choice. */
export { deriveIdentitySignals, MOGSONA_BY_ID };
