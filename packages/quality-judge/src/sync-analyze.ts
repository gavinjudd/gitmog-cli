import {
  QUALITY_MAX_FILES_PER_PROFILE,
  QUALITY_MAX_SOURCE_BYTES_PER_PROFILE,
  analyzeQualityParseResults,
  type AnalyzeOptions,
} from "./analyze.js";
import { parseQualitySource } from "./parser.js";
import type { ParseQualityResult, QualityJudgeResult, QualitySourceInput } from "./types.js";

/** Test-only direct parser path. Product collection uses the worker-isolated async entrypoint. */
export function analyzeQualitySourceFiles(
  inputs: readonly QualitySourceInput[],
  options: AnalyzeOptions = {},
): QualityJudgeResult {
  const bounded = inputs.slice(0, QUALITY_MAX_FILES_PER_PROFILE);
  let bytes = 0;
  const results: Array<ParseQualityResult | null> = [];
  for (const input of bounded) {
    bytes += input.byteLength;
    results.push(
      bytes > QUALITY_MAX_SOURCE_BYTES_PER_PROFILE
        ? null
        : parseQualitySource(input.path, input.source),
    );
  }
  return analyzeQualityParseResults(inputs, results, options);
}
