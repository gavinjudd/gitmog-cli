#!/usr/bin/env node
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const moduleUrl = pathToFileURL(
  resolve(root, "packages", "quality-judge", "dist", "isolated-analyze.js"),
).href;
const { analyzeQualitySourceFilesIsolated } = await import(moduleUrl);

const FILES = 18;
const TOTAL_BYTES = 300 * 1024;
const ITERATIONS = 10;
const sha = (value) => createHash("sha1").update(value).digest("hex");

const files = [];
let remaining = TOTAL_BYTES;
for (let fileIndex = 0; fileIndex < FILES; fileIndex += 1) {
  const remainingFiles = FILES - fileIndex;
  const target = Math.floor(remaining / remainingFiles);
  const functions = [];
  let functionIndex = 0;
  while (Buffer.byteLength(functions.join("\n"), "utf8") < target - 120) {
    functions.push(
      `export function f${String(fileIndex)}_${String(functionIndex)}(value: number): number { return value + ${String(functionIndex % 11)}; }`,
    );
    functionIndex += 1;
  }
  let source = `${functions.join("\n")}\n`;
  const padding = target - Buffer.byteLength(source, "utf8");
  if (padding >= 5) source += `/*${"x".repeat(padding - 5)}*/\n`;
  const byteLength = Buffer.byteLength(source, "utf8");
  remaining -= byteLength;
  const path = `src/benchmark-${String(fileIndex).padStart(2, "0")}.ts`;
  files.push({
    repository: "synthetic/quality-benchmark",
    commitSha: sha("synthetic-quality-benchmark-commit"),
    blobSha: sha(source),
    path,
    sourceUrl: `https://example.invalid/${path}`,
    source,
    byteLength,
    isTest: false,
    attribution: { status: "not-checked", commitSha: null },
  });
}

const measuredBytes = files.reduce((total, file) => total + file.byteLength, 0);
if (measuredBytes > TOTAL_BYTES || files.length !== FILES)
  throw new Error("Synthetic quality benchmark exceeded the reviewed corpus bound.");

const durations = [];
for (let index = 0; index < ITERATIONS; index += 1) {
  const started = performance.now();
  const result = await analyzeQualitySourceFilesIsolated(files);
  durations.push(performance.now() - started);
  if (
    result.maintainedCodebase.files !== FILES ||
    result.limitations.some((limitation) =>
      ["parser-timeout", "parse-failure"].includes(limitation.code),
    )
  )
    throw new Error("Quality benchmark did not parse the complete bounded synthetic corpus.");
}

const sorted = durations.toSorted((left, right) => left - right);
const percentile = (value) => sorted[Math.ceil((value / 100) * sorted.length) - 1] ?? 0;
const report = {
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  files: FILES,
  sourceBytes: measuredBytes,
  iterations: ITERATIONS,
  p50Ms: Math.round(percentile(50) * 100) / 100,
  p95Ms: Math.round(percentile(95) * 100) / 100,
  maximumMs: Math.round(Math.max(...durations) * 100) / 100,
  thresholdMs: 2_000,
};
if (report.p95Ms > report.thresholdMs)
  throw new Error("Quality parser exceeded the 2-second p95 profile-corpus threshold.");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
