import { posix } from "node:path";

import { digest } from "@gitmog/github";

import { parseQualitySource } from "./parser.js";
import {
  QUALITY_ATTRIBUTION_VERSION,
  QUALITY_CACHE_VERSION,
  QUALITY_DIMENSION_FORMULA_VERSION,
  QUALITY_DIMENSION_IDS,
  QUALITY_JUDGE_RESULT_VERSION,
  QUALITY_PARSER_CONTRACT_VERSION,
  QUALITY_SOURCE_SELECTION_VERSION,
  type AttributedQualityReading,
  type ParsedQualityFeatures,
  type QualityDimension,
  type QualityDimensionId,
  type QualityDimensions,
  type QualityFinding,
  type QualityJudgeResult,
  type QualityLimitation,
  type QualityReading,
  type QualityReceipt,
  type QualityRequestBudget,
  type QualitySourceInput,
} from "./types.js";

export const QUALITY_MAX_REPOSITORIES_PER_PROFILE = 3;
export const QUALITY_MAX_IMPLEMENTATION_FILES_PER_REPOSITORY = 5;
export const QUALITY_MAX_TEST_FILES_PER_REPOSITORY = 2;
export const QUALITY_MAX_FILES_PER_PROFILE = 18;
export const QUALITY_MAX_SOURCE_BYTES_PER_PROFILE = 300 * 1024;
export const QUALITY_MAX_ATTRIBUTION_REQUESTS_PER_PROFILE = 12;
export const QUALITY_MAX_SOURCE_REQUESTS_PER_PROFILE = 21;
export const QUALITY_COMPLETE_REQUEST_OPPORTUNITY = 33;
export const QUALITY_MINIMUM_USEFUL_REQUEST_OPPORTUNITY = 5;

const DIMENSION_WEIGHTS: Readonly<Record<QualityDimensionId, number>> = Object.freeze({
  correctnessDiscipline: 4,
  testQuality: 2,
  maintainability: 7,
  contractQuality: 4,
  architecture: 5,
  securityHygiene: 4,
  duplicationAndDeadPatterns: 3,
});

interface ParsedFile {
  readonly input: Omit<QualitySourceInput, "source">;
  readonly features: ParsedQualityFeatures;
}

interface AnalyzeOptions {
  readonly requestBudget?: Partial<QualityRequestBudget> | undefined;
  readonly collectionLimitations?: readonly QualityLimitation[] | undefined;
}

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
const ratio = (part: number, whole: number): number => (whole <= 0 ? 0 : part / whole);
const sum = (files: readonly ParsedFile[], key: keyof ParsedQualityFeatures): number =>
  files.reduce((total, file) => {
    const value = file.features[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);

const dimension = (
  available: boolean,
  previewScore: number,
  id: QualityDimensionId,
  observations: number,
): QualityDimension => ({
  available,
  previewScore: available ? clamp(previewScore) : null,
  previewWeight: DIMENSION_WEIGHTS[id],
  measuredPoints: available
    ? Math.round((clamp(previewScore) / 100) * DIMENSION_WEIGHTS[id] * 100) / 100
    : null,
  observations,
});

const cycleCount = (files: readonly ParsedFile[]): number => {
  const byPath = new Map(files.map((file) => [file.input.path.normalize("NFC"), file]));
  const edges = new Map<string, readonly string[]>();
  for (const file of files) {
    const directory = posix.dirname(file.input.path.replaceAll("\\", "/"));
    const targets = new Set<string>();
    for (const imported of file.features.localImports) {
      const base = posix.normalize(posix.join(directory, imported));
      const stem = base.replace(/\.(?:[cm]?[jt]sx?)$/iu, "");
      const candidates = [
        base,
        `${stem}.ts`,
        `${stem}.tsx`,
        `${stem}.js`,
        `${stem}.jsx`,
        posix.join(base, "index.ts"),
        posix.join(base, "index.js"),
      ];
      const target = candidates.find((candidate) => byPath.has(candidate));
      if (target !== undefined) targets.add(target);
    }
    edges.set(file.input.path, [...targets].sort());
  }
  const cycles = new Set<string>();
  for (const start of [...edges.keys()].sort()) {
    const stack: Array<{ node: string; route: readonly string[] }> = [
      { node: start, route: [start] },
    ];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || current.route.length > files.length) continue;
      for (const next of edges.get(current.node) ?? []) {
        const index = current.route.indexOf(next);
        if (index >= 0) {
          cycles.add([...current.route.slice(index), next].toSorted().join("|"));
        } else {
          stack.push({ node: next, route: [...current.route, next] });
        }
      }
    }
  }
  return cycles.size;
};

const duplicateShare = (files: readonly ParsedFile[]): number => {
  const appearances = new Map<string, number>();
  for (const file of files) {
    for (const shingle of new Set(file.features.tokenShingles)) {
      appearances.set(shingle, (appearances.get(shingle) ?? 0) + 1);
    }
  }
  const duplicated = [...appearances.values()].filter((count) => count > 1).length;
  return ratio(duplicated, appearances.size);
};

const dimensionsFor = (files: readonly ParsedFile[]): QualityDimensions => {
  const implementation = files.filter((file) => !file.input.isTest);
  const tests = files.filter((file) => file.input.isTest);
  const functions = sum(implementation, "functionCount");
  const validation = sum(implementation, "validationCount");
  const errorHandling = sum(implementation, "errorHandlingCount");
  const swallowed = sum(implementation, "swallowedErrors");
  const testCases = sum(tests, "testCaseCount");
  const assertions = sum(tests, "assertionCount");
  const failureAssertions = sum(tests, "failurePathAssertions");
  const skippedTests = sum(tests, "skippedTestCount");
  const highComplexity = sum(implementation, "highComplexityFunctions");
  const longFunctions = sum(implementation, "longFunctions");
  const maximumNesting = implementation.reduce(
    (largest, file) => Math.max(largest, file.features.maximumNesting),
    0,
  );
  const exported = sum(implementation, "exportedContractCount");
  const typed = sum(implementation, "typedContractCount");
  const unsafeAny = sum(implementation, "unsafeAnyCount");
  const imports = sum(implementation, "importCount");
  const cycles = cycleCount(implementation);
  const dynamicEvaluation = sum(implementation, "dynamicEvaluationCount");
  const unsafeShell = sum(implementation, "unsafeShellCount");
  const secrets = sum(implementation, "secretLiteralCount");
  const unreachable = sum(implementation, "unreachableStatementCount");
  const duplicates = duplicateShare(implementation);
  const typedLanguageFunctions = implementation
    .filter((file) => file.features.language === "typescript")
    .reduce((total, file) => total + file.features.functionCount, 0);

  return {
    correctnessDiscipline: dimension(
      functions > 0,
      72 + Math.min(18, ratio(validation + errorHandling, functions) * 24) - swallowed * 18,
      "correctnessDiscipline",
      validation + errorHandling + swallowed,
    ),
    testQuality: dimension(
      testCases > 0,
      35 +
        Math.min(45, ratio(assertions, testCases) * 45) +
        Math.min(20, ratio(failureAssertions, testCases) * 35) -
        skippedTests * 8,
      "testQuality",
      testCases,
    ),
    maintainability: dimension(
      functions > 0,
      92 -
        ratio(highComplexity, functions) * 70 -
        ratio(longFunctions, functions) * 45 -
        Math.max(0, maximumNesting - 7) * 4,
      "maintainability",
      functions,
    ),
    contractQuality: dimension(
      typedLanguageFunctions > 0,
      42 +
        ratio(typed, typedLanguageFunctions) * 58 -
        ratio(unsafeAny, Math.max(1, typedLanguageFunctions)) * 35,
      "contractQuality",
      exported + typed,
    ),
    architecture: dimension(
      implementation.length >= 2 && imports > 0,
      94 - cycles * 24 - Math.max(0, ratio(imports, implementation.length) - 12) * 2,
      "architecture",
      imports,
    ),
    securityHygiene: dimension(
      implementation.length > 0,
      96 - dynamicEvaluation * 35 - unsafeShell * 40 - secrets * 55,
      "securityHygiene",
      implementation.length,
    ),
    duplicationAndDeadPatterns: dimension(
      implementation.length >= 2,
      96 - duplicates * 100 - unreachable * 12,
      "duplicationAndDeadPatterns",
      implementation.length,
    ),
  };
};

const previewScoreFor = (dimensions: QualityDimensions): number | null => {
  const available = QUALITY_DIMENSION_IDS.filter((id) => dimensions[id].available);
  const weight = available.reduce((total, id) => total + dimensions[id].previewWeight, 0);
  if (weight === 0) return null;
  const points = available.reduce((total, id) => total + (dimensions[id].measuredPoints ?? 0), 0);
  return clamp((points / weight) * 100);
};

const receiptFor = (
  file: ParsedFile,
  id: string,
  metric: string,
  observed: number,
  lineStart = 1,
  lineEnd = 1,
  applicability = "parser-supported sampled file",
): QualityReceipt => ({
  id,
  repository: file.input.repository,
  commitSha: file.input.commitSha,
  path: file.input.path,
  lineStart,
  lineEnd,
  language: file.features.language,
  parserVersion: file.features.parserVersion,
  metric,
  observed,
  applicability,
  attributionStatus:
    file.input.attribution.status === "attributed"
      ? "ready"
      : file.input.attribution.status === "not-attributed"
        ? "not-attributable"
        : "insufficient",
  sourceUrl: file.input.sourceUrl,
});

const readingFor = (
  files: readonly ParsedFile[],
  allInputBytes: number,
): { readonly reading: QualityReading; readonly receipts: readonly QualityReceipt[] } => {
  const dimensions = dimensionsFor(files);
  const previewScore = previewScoreFor(dimensions);
  const sourceBytes = sum(files, "byteLength");
  const coverage = allInputBytes <= 0 ? 0 : clamp((sourceBytes / allInputBytes) * 100);
  const status =
    files.length >= 2 && coverage >= 50 ? "ready" : files.length > 0 ? "partial" : "insufficient";
  const receipts: QualityReceipt[] = [];
  const findings: QualityFinding[] = [];
  const firstImplementation = files.find((file) => !file.input.isTest) ?? files[0];
  const firstTest = files.find((file) => file.input.isTest);
  let nextId = 1;
  const add = (
    file: ParsedFile | undefined,
    dimensionId: QualityDimensionId,
    kind: "strength" | "weakness",
    summary: string,
    metric: string,
    observed: number,
  ): void => {
    if (file === undefined) return;
    const id = `Q${String(nextId)}`;
    nextId += 1;
    const located = file.features.metrics.find((entry) => entry.metric === metric);
    receipts.push(
      receiptFor(
        file,
        id,
        metric,
        observed,
        located?.lineStart,
        located?.lineEnd,
        located?.applicability,
      ),
    );
    findings.push({
      id: `F${String(nextId - 1)}`,
      dimension: dimensionId,
      kind,
      summary,
      receiptIds: [id],
    });
  };
  const functions = sum(
    files.filter((file) => !file.input.isTest),
    "functionCount",
  );
  const complex = sum(files, "highComplexityFunctions");
  const assertions = sum(files, "assertionCount");
  const testCases = sum(files, "testCaseCount");
  const failures = sum(files, "failurePathAssertions");
  const dynamic = sum(files, "dynamicEvaluationCount");
  const shell = sum(files, "unsafeShellCount");
  const swallowed = sum(files, "swallowedErrors");
  const cycles = cycleCount(files.filter((file) => !file.input.isTest));
  if (testCases > 0 && assertions >= testCases)
    add(
      firstTest,
      "testQuality",
      "strength",
      `${String(assertions)} assertions across ${String(testCases)} sampled tests.`,
      "assertions",
      assertions,
    );
  if (failures > 0)
    add(
      firstTest,
      "testQuality",
      "strength",
      `${String(failures)} sampled tests assert a failure path.`,
      "failure-path-assertions",
      failures,
    );
  if (functions > 0 && complex === 0)
    add(
      firstImplementation,
      "maintainability",
      "strength",
      `No sampled function exceeded the language complexity threshold.`,
      "high-complexity-function",
      0,
    );
  if (complex > 0)
    add(
      firstImplementation,
      "maintainability",
      "weakness",
      `${String(complex)} of ${String(functions)} sampled functions exceed the complexity threshold.`,
      "high-complexity-function",
      complex,
    );
  if (cycles > 0)
    add(
      firstImplementation,
      "architecture",
      "weakness",
      `${String(cycles)} import cycles appear across ${String(files.length)} sampled modules.`,
      "import-cycles",
      cycles,
    );
  if (dynamic + shell > 0)
    add(
      firstImplementation,
      "securityHygiene",
      "weakness",
      `${String(dynamic + shell)} supported unsafe execution pattern${dynamic + shell === 1 ? "" : "s"} found.`,
      dynamic > 0 ? "dynamic-evaluation" : "shell-template-construction",
      dynamic + shell,
    );
  if (swallowed > 0)
    add(
      firstImplementation,
      "correctnessDiscipline",
      "weakness",
      `${String(swallowed)} sampled catch block${swallowed === 1 ? "" : "s"} swallow errors.`,
      "empty-catch",
      swallowed,
    );
  if (findings.length === 0 && firstImplementation !== undefined)
    add(
      firstImplementation,
      "maintainability",
      "strength",
      `${String(files.length)} parser-supported files produced bounded structural evidence.`,
      "parsed-files",
      files.length,
    );
  return {
    reading: {
      status,
      previewScore: status === "insufficient" ? null : previewScore,
      coverage,
      dimensions,
      strengths: findings.filter((finding) => finding.kind === "strength").slice(0, 3),
      weaknesses: findings.filter((finding) => finding.kind === "weakness").slice(0, 3),
      repositories: new Set(files.map((file) => file.input.repository)).size,
      files: files.length,
      sourceBytes,
      nonBlankLines: sum(files, "nonBlankLines"),
      languages: [...new Set(files.map((file) => file.features.language))].sort(),
    },
    receipts,
  };
};

export function qualityCacheIdentity(
  input: Pick<QualitySourceInput, "repository" | "commitSha" | "blobSha" | "path">,
): string {
  return digest({
    cacheVersion: QUALITY_CACHE_VERSION,
    parserVersion: QUALITY_PARSER_CONTRACT_VERSION,
    formulaVersion: QUALITY_DIMENSION_FORMULA_VERSION,
    sampleVersion: QUALITY_SOURCE_SELECTION_VERSION,
    attributionVersion: QUALITY_ATTRIBUTION_VERSION,
    immutableSource: input,
  });
}

export function analyzeQualitySourceFiles(
  inputs: readonly QualitySourceInput[],
  options: AnalyzeOptions = {},
): QualityJudgeResult {
  const bounded = inputs.slice(0, QUALITY_MAX_FILES_PER_PROFILE);
  const parsed: ParsedFile[] = [];
  const limitations: QualityLimitation[] = [...(options.collectionLimitations ?? [])];
  const failures = new Map<QualityLimitation["code"], number>();
  let inputBytes = 0;
  for (const input of bounded) {
    inputBytes += input.byteLength;
    if (inputBytes > QUALITY_MAX_SOURCE_BYTES_PER_PROFILE) {
      failures.set("source-budget", (failures.get("source-budget") ?? 0) + 1);
      continue;
    }
    const result = parseQualitySource(input.path, input.source);
    if (!result.ok) {
      const code: QualityLimitation["code"] =
        result.reason === "unsupported-language"
          ? "unsupported-language"
          : result.reason === "timeout"
            ? "parser-timeout"
            : "parse-failure";
      failures.set(code, (failures.get(code) ?? 0) + 1);
      continue;
    }
    const { source: _source, ...safeInput } = input;
    parsed.push({ input: safeInput, features: result.features });
  }
  for (const [code, files] of failures) {
    limitations.push({
      code,
      files,
      detail:
        code === "unsupported-language"
          ? "Unsupported languages reduce preview coverage and receive no quality score."
          : code === "parser-timeout"
            ? "The parser time ceiling reduced preview coverage."
            : code === "source-budget"
              ? "The process-only source-byte ceiling reduced preview coverage."
              : "Parser-rejected source reduced preview coverage.",
    });
  }
  if (parsed.length === 0)
    limitations.push({
      code: "insufficient-source",
      detail: "Not enough parser-supported source was available for a quality claim.",
      files: bounded.length,
    });

  const maintained = readingFor(parsed, Math.max(1, inputBytes));
  const attributedFiles = parsed.filter((file) => file.input.attribution.status === "attributed");
  const attributed = readingFor(attributedFiles, Math.max(1, inputBytes));
  const checked = parsed.filter((file) => file.input.attribution.status !== "not-checked").length;
  const attributionCoverage =
    parsed.length === 0 ? 0 : clamp((attributedFiles.length / parsed.length) * 100);
  const attributionStatus: AttributedQualityReading["attributionStatus"] =
    checked === 0
      ? "insufficient"
      : attributedFiles.length === 0
        ? "not-attributable"
        : attributedFiles.length >= 2 && attributionCoverage >= 50
          ? "ready"
          : "partial";
  const attributedReading: AttributedQualityReading = {
    ...attributed.reading,
    status:
      attributionStatus === "ready"
        ? attributed.reading.status
        : attributionStatus === "partial"
          ? "partial"
          : "insufficient",
    previewScore: attributionStatus === "ready" ? attributed.reading.previewScore : null,
    attributionStatus,
    attributionCoverage,
    attributionMethodVersion: QUALITY_ATTRIBUTION_VERSION,
  };
  if (attributionStatus === "insufficient" || attributionStatus === "not-attributable") {
    limitations.push({
      code: "insufficient-attribution",
      detail:
        "Public attribution evidence was insufficient; it did not reduce maintained-codebase quality.",
      files: parsed.length - attributedFiles.length,
    });
  }
  const requestBudget: QualityRequestBudget = {
    sourcePlanned: options.requestBudget?.sourcePlanned ?? bounded.length,
    sourceRequests: options.requestBudget?.sourceRequests ?? bounded.length,
    sourceCacheHits: options.requestBudget?.sourceCacheHits ?? 0,
    attributionPlanned: options.requestBudget?.attributionPlanned ?? checked,
    attributionRequests: options.requestBudget?.attributionRequests ?? checked,
    attributionCacheHits: options.requestBudget?.attributionCacheHits ?? 0,
    completeOpportunity: QUALITY_COMPLETE_REQUEST_OPPORTUNITY,
    minimumUsefulOpportunity: QUALITY_MINIMUM_USEFUL_REQUEST_OPPORTUNITY,
  };
  const receipts = [
    ...maintained.receipts,
    ...attributed.receipts.map((receipt, index) => ({ ...receipt, id: `A${String(index + 1)}` })),
  ];
  const safeFeatureIdentity = parsed.map((file) => ({
    cacheKey: qualityCacheIdentity(file.input),
    parser: file.features.parserVersion,
    language: file.features.language,
    bytes: file.features.byteLength,
    nodes: file.features.nodeCount,
    dimensions: dimensionsFor([file]),
    attribution: file.input.attribution.status,
  }));
  return {
    version: QUALITY_JUDGE_RESULT_VERSION,
    status: maintained.reading.status,
    activation: "preview-only",
    scoreInfluence: 0,
    maintainedCodebase: maintained.reading,
    attributedCode: attributedReading,
    requestBudget,
    limitations,
    receipts,
    resultKey: digest({
      version: QUALITY_JUDGE_RESULT_VERSION,
      features: safeFeatureIdentity,
      limitations,
      requestBudget,
    }),
  };
}
