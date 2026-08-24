import {
  SOURCE_FEATURE_VERSION,
  SOURCE_REDACTION_VERSION,
  SOURCE_SIMPLIFICATION_VERSION,
} from "@gitmog/analyzers";
import {
  CODE_DNA_SAMPLE_VERSION,
  collectSourceSamples,
  digest,
  resolveSourceOpportunityScope,
  type CollectSourceSampleOptions,
  type ProfileSnapshot,
  type SnapshotCache,
  type SourceOpportunityScope,
  type SourceSampleFailureReason,
  type SourceSampleSet,
} from "@gitmog/github";

import { calculateDeterministicAxes } from "./axis-engine.js";
import { deriveCodeDna } from "./derive.js";
import {
  CODE_AXIS_ENGINE_VERSION,
  CODE_AXIS_IDS,
  CODE_DNA_VERSION,
  type AnalysisCacheDisposition,
  type CodeDnaOutcome,
  type CodeDnaPartial,
  type CodeDnaReady,
} from "./types.js";

type StableCodeDnaPartial = CodeDnaPartial & { readonly cacheDisposition: "stable" };
type CacheableCodeDna = CodeDnaReady | StableCodeDnaPartial;
export interface CodeDnaOptions extends CollectSourceSampleOptions {
  readonly cache?: SnapshotCache<CacheableCodeDna> | null | undefined;
  /** Operational telemetry sink. It is deliberately outside the canonical reading. */
  readonly onRequestsUsed?: ((requests: number) => void) | undefined;
}

export const CODE_DNA_CACHE_KEY_VERSION = "2.0.0-source-opportunity-scope";

export function codeDnaCacheKey(
  snapshotKey: string,
  opportunityScope: SourceOpportunityScope,
): string {
  return [
    "codeDna",
    CODE_DNA_CACHE_KEY_VERSION,
    `codeDnaVersion=${CODE_DNA_VERSION}`,
    `axisEngineVersion=${CODE_AXIS_ENGINE_VERSION}`,
    `sourceSampleVersion=${CODE_DNA_SAMPLE_VERSION}`,
    `sourceFeatureVersion=${SOURCE_FEATURE_VERSION}`,
    `sourceSimplificationVersion=${SOURCE_SIMPLIFICATION_VERSION}`,
    `sourceRedactionVersion=${SOURCE_REDACTION_VERSION}`,
    `sourceRequestAllowance=${String(opportunityScope.sourceRequestAllowance)}`,
    `snapshotKey=${snapshotKey}`,
  ].join(":");
}

const insufficient = (
  reason: string,
  samples: CodeDnaOutcome["samples"] = [],
  sourceFailureReason?: SourceSampleFailureReason,
): CodeDnaOutcome => ({
  status: "insufficient",
  version: CODE_DNA_VERSION,
  reason,
  ...(sourceFailureReason === undefined ? {} : { sourceFailureReason }),
  samples,
  limitations: [reason],
});

export async function readCodeDna(
  snapshot: ProfileSnapshot,
  options: CodeDnaOptions = {},
): Promise<CodeDnaOutcome> {
  const opportunityScope = resolveSourceOpportunityScope(snapshot, options);
  const cacheKey = codeDnaCacheKey(snapshot.snapshotKey, opportunityScope);
  const cachePolicy = options.cachePolicy ?? { read: true, write: true };
  const cached = cachePolicy.read ? options.cache?.get(cacheKey) : undefined;
  if (cached?.cacheDisposition === "stable") {
    options.onRequestsUsed?.(0);
    return cached;
  }
  if (cached !== undefined) options.cache?.delete(cacheKey);
  let sampleSet: SourceSampleSet;
  try {
    sampleSet = await collectSourceSamples(snapshot, options);
  } catch {
    options.onRequestsUsed?.(0);
    return insufficient("source analysis could not be completed", [], "unknown");
  }
  options.onRequestsUsed?.(sampleSet.requestsUsed);
  const outcome = evaluateCodeDnaSampleSet(sampleSet);
  if (
    cachePolicy.write &&
    outcome.status !== "insufficient" &&
    outcome.cacheDisposition === "stable"
  ) {
    options.cache?.set(cacheKey, outcome as CacheableCodeDna);
  }
  return outcome;
}

const STABLE_SOURCE_FAILURES = new Set<SourceSampleFailureReason>([
  "no-source-candidate",
  "request-budget-exhausted",
  "oversized",
  "non-text",
  "redaction-threshold",
  "unsupported-language",
]);

export const analysisCacheDisposition = (
  sampleSet: Pick<SourceSampleSet, "failures" | "treeTruncated">,
): AnalysisCacheDisposition =>
  !sampleSet.treeTruncated &&
  sampleSet.failures.every((failure) => STABLE_SOURCE_FAILURES.has(failure.reason))
    ? "stable"
    : "transient";

export function evaluateCodeDnaSampleSet(sampleSet: SourceSampleSet): CodeDnaOutcome {
  const receipts = sampleSet.samples.map(({ features: _features, ...receipt }) => receipt);
  if (sampleSet.samples.length === 0) {
    const reason = sampleSet.zeroSampleReason ?? "unknown";
    return insufficient(sourceUnavailableMessage(reason), receipts, reason);
  }

  const evaluation = calculateDeterministicAxes(sampleSet);
  const derived = deriveCodeDna(evaluation.axes, evaluation.features, evaluation.confidence);
  const cacheDisposition = analysisCacheDisposition(sampleSet);
  const sourceFailureReasons = [
    ...new Set(sampleSet.failures.map((failure) => failure.reason)),
  ].sort();
  const limitations = [
    ...evaluation.limitations,
    ...sampleSet.failures.map((failure) => failure.detail),
  ]
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
  const common = {
    version: CODE_DNA_VERSION,
    sampleVersion: sampleSet.sampleVersion,
    axisEngineVersion: CODE_AXIS_ENGINE_VERSION,
    sampleKey: sampleSet.sampleKey,
    axes: evaluation.axes,
    confidence: evaluation.confidence,
    sourceConfidence: evaluation.confidence,
    featureIds: evaluation.featureReadings.map((entry) => entry.id),
    featureContributions: evaluation.featureReadings,
    samples: receipts,
    repositoriesRepresented: sampleSet.repositoriesRepresented,
    labelCandidates: derived.candidates,
    limitations,
    sourceFailureReasons,
  } as const;
  const complete =
    cacheDisposition === "stable" &&
    sampleSet.samples.length >= 3 &&
    sampleSet.repositoriesRepresented >= 2 &&
    sampleSet.failures.every((failure) => failure.reason === "no-source-candidate");
  if (derived.label !== null && complete)
    return { status: "ready", cacheDisposition, ...common, label: derived.label };
  return {
    status: "partial",
    cacheDisposition,
    ...common,
    ...(derived.label === null ? {} : { label: derived.label }),
    reason: derived.reason ?? "bounded source coverage is incomplete",
  };
}

const sourceUnavailableMessage = (reason: SourceSampleFailureReason): string =>
  reason === "no-source-candidate"
    ? "no bounded source sample survived; no readable public source file was found"
    : `no bounded source sample survived (${reason})`;

export function codeDnaFingerprint(reading: CodeDnaReady | CodeDnaPartial): string {
  return digest({
    version: reading.version,
    engine: reading.axisEngineVersion,
    sample: reading.sampleVersion,
    sampleKey: reading.sampleKey,
    axes: Object.fromEntries(CODE_AXIS_IDS.map((id) => [id, reading.axes[id].score])),
    label: reading.label?.id ?? null,
  });
}
