import {
  QUALITY_MAX_FILES_PER_PROFILE,
  QUALITY_MAX_SOURCE_BYTES_PER_PROFILE,
  analyzeQualityParseResults,
  type AnalyzeOptions,
} from "./analyze.js";
import { parseQualitySourcesIsolated, type IsolatedParserOptions } from "./isolate.js";
import type { ParseQualityResult, QualityJudgeResult, QualitySourceInput } from "./types.js";

export async function analyzeQualitySourceFilesIsolated(
  inputs: readonly QualitySourceInput[],
  options: AnalyzeOptions & IsolatedParserOptions = {},
): Promise<QualityJudgeResult> {
  const bounded = inputs.slice(0, QUALITY_MAX_FILES_PER_PROFILE);
  let bytes = 0;
  const eligible: QualitySourceInput[] = [];
  const eligibleIndices: number[] = [];
  const results: Array<ParseQualityResult | null> = Array.from(
    { length: bounded.length },
    () => null,
  );
  for (const [index, input] of bounded.entries()) {
    bytes += input.byteLength;
    if (bytes <= QUALITY_MAX_SOURCE_BYTES_PER_PROFILE) {
      eligible.push(input);
      eligibleIndices.push(index);
    }
  }
  const parsed = await parseQualitySourcesIsolated(eligible, options);
  for (const [position, result] of parsed.entries()) {
    const target = eligibleIndices[position];
    if (target !== undefined) results[target] = result;
  }
  return analyzeQualityParseResults(inputs, results, options);
}
