const nonNegativeInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
};

const record = (value, label) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is missing or malformed.`);
  }
  return value;
};

const qualityResults = (payload) => {
  if (payload.qualityPreview === undefined) return [];
  const preview = record(payload.qualityPreview, "qualityPreview");
  return [
    record(preview.left, "qualityPreview.left"),
    record(preview.right, "qualityPreview.right"),
  ];
};

const sumQualityField = (results, section, field) =>
  results.reduce((total, result, index) => {
    const value = record(result[section], `qualityPreview[${String(index)}].${section}`)[field];
    return total + nonNegativeInteger(value, `${section}.${field}`);
  }, 0);

const compatibilityCheck = (results) => {
  for (const [index, result] of results.entries()) {
    const plan = record(result.requestPlan, `qualityPreview[${String(index)}].requestPlan`);
    const telemetry = record(
      result.requestTelemetry,
      `qualityPreview[${String(index)}].requestTelemetry`,
    );
    const compatibility = record(
      result.requestBudget,
      `qualityPreview[${String(index)}].requestBudget`,
    );
    for (const [compatibilityField, source, sourceField] of [
      ["sourcePlanned", plan, "sourcePlanned"],
      ["attributionPlanned", plan, "attributionPlanned"],
      ["completeOpportunity", plan, "completeOpportunity"],
      ["minimumUsefulOpportunity", plan, "minimumUsefulOpportunity"],
      ["sourceRequests", telemetry, "sourceRequests"],
      ["sourceCacheHits", telemetry, "sourceCacheHits"],
      ["attributionRequests", telemetry, "attributionRequests"],
      ["attributionCacheHits", telemetry, "attributionCacheHits"],
    ]) {
      if (compatibility[compatibilityField] !== source[sourceField]) {
        throw new Error(
          `Quality compatibility request accounting diverged at ${compatibilityField}.`,
        );
      }
    }
    if (compatibility.wholeResultCacheHit !== telemetry.wholeResultCacheHit) {
      throw new Error("Quality compatibility request accounting diverged at wholeResultCacheHit.");
    }
  }
};

export const stableQualityResults = (payload) =>
  qualityResults(record(payload, "payload")).map((result) => {
    const {
      requestBudget: _requestBudget,
      requestTelemetry: _requestTelemetry,
      ...stable
    } = result;
    return stable;
  });

export function reconcileBattleRequestAccounting({
  payload: rawPayload,
  observedFetches,
  observedByUserAgent = {},
  allowanceReads = 0,
}) {
  const payload = record(rawPayload, "payload");
  const sourceAnalysis = record(payload.sourceAnalysis, "sourceAnalysis");
  const canonicalBudget = record(sourceAnalysis.requestBudget, "sourceAnalysis.requestBudget");
  const left = record(canonicalBudget.left, "sourceAnalysis.requestBudget.left");
  const right = record(canonicalBudget.right, "sourceAnalysis.requestBudget.right");
  const canonicalMetadata =
    nonNegativeInteger(left.metadata, "canonical left metadata requests") +
    nonNegativeInteger(right.metadata, "canonical right metadata requests");
  const canonicalSource =
    nonNegativeInteger(left.source, "canonical left source requests") +
    nonNegativeInteger(right.source, "canonical right source requests");
  const canonicalTotal = nonNegativeInteger(canonicalBudget.total, "canonical total requests");
  if (canonicalMetadata + canonicalSource !== canonicalTotal) {
    throw new Error("Canonical request accounting does not reconcile.");
  }

  const results = qualityResults(payload);
  compatibilityCheck(results);
  const qualitySource = sumQualityField(results, "requestTelemetry", "sourceRequests");
  const qualityAttribution = sumQualityField(results, "requestTelemetry", "attributionRequests");
  const sourceCacheHits = sumQualityField(results, "requestTelemetry", "sourceCacheHits");
  const attributionCacheHits = sumQualityField(results, "requestTelemetry", "attributionCacheHits");
  const wholeResultCacheHits = results.filter(
    (result) => record(result.requestTelemetry, "requestTelemetry").wholeResultCacheHit === true,
  ).length;
  const qualitySourcePlanned = sumQualityField(results, "requestPlan", "sourcePlanned");
  const qualityAttributionPlanned = sumQualityField(results, "requestPlan", "attributionPlanned");
  const qualitySourceCaps = sumQualityField(results, "requestPlan", "sourceRequestCap");
  const qualityAttributionCaps = sumQualityField(results, "requestPlan", "attributionRequestCap");

  const fetches = nonNegativeInteger(observedFetches, "observed fetches");
  const allowance = nonNegativeInteger(allowanceReads, "allowance reads");
  const expectedFetches = canonicalTotal + qualitySource + qualityAttribution;
  if (fetches !== expectedFetches) {
    throw new Error(
      `Observed fetches did not reconcile: ${String(fetches)} observed, ${String(expectedFetches)} reported.`,
    );
  }

  const classified = Object.entries(observedByUserAgent).reduce(
    (total, [userAgent, value]) =>
      total + nonNegativeInteger(value, `observed ${userAgent} fetches`),
    0,
  );
  if (classified !== fetches) {
    throw new Error("User-agent request classification did not reconcile with observed fetches.");
  }
  if ((observedByUserAgent["gitmog-quality-source"] ?? 0) !== qualitySource) {
    throw new Error("Quality source request telemetry did not match observed source calls.");
  }
  if ((observedByUserAgent["gitmog-quality-attribution"] ?? 0) !== qualityAttribution) {
    throw new Error(
      "Quality attribution request telemetry did not match observed attribution calls.",
    );
  }

  return {
    canonicalRequests: {
      metadata: canonicalMetadata,
      source: canonicalSource,
      total: canonicalTotal,
    },
    qualityRequests: {
      source: qualitySource,
      attribution: qualityAttribution,
      total: qualitySource + qualityAttribution,
    },
    allowanceReads: allowance,
    cacheHits: {
      source: sourceCacheHits,
      attribution: attributionCacheHits,
      wholeResult: wholeResultCacheHits,
    },
    plannedQualityOpportunity: {
      source: qualitySourcePlanned,
      attribution: qualityAttributionPlanned,
      total: qualitySourcePlanned + qualityAttributionPlanned,
      sourceCap: qualitySourceCaps,
      attributionCap: qualityAttributionCaps,
    },
    totalObservedFetches: fetches,
    totalObservedOperations: fetches + allowance,
  };
}
