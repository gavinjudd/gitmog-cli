import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { analyzeQualitySourceFiles, qualityCacheIdentity } from "../src/analyze.js";
import type { QualitySourceInput } from "../src/types.js";

const sourceInput = (
  path: string,
  source: string,
  options: Partial<
    Pick<QualitySourceInput, "repository" | "commitSha" | "blobSha" | "isTest" | "attribution">
  > = {},
): QualitySourceInput => ({
  repository: options.repository ?? "example/project",
  commitSha: options.commitSha ?? "a".repeat(40),
  blobSha: options.blobSha ?? "b".repeat(40),
  path,
  sourceUrl: `https://github.com/example/project/blob/${"a".repeat(40)}/${encodeURIComponent(path)}`,
  source,
  byteLength: Buffer.byteLength(source, "utf8"),
  isTest: options.isTest ?? false,
  attribution: options.attribution ?? { status: "attributed", commitSha: "c".repeat(40) },
});

const implementation = `
export function parseValue(value: unknown): number {
  if (typeof value !== "number") throw new TypeError("value");
  return value;
}
`;
const tests = `
test("accepts a number", () => { expect(parseValue(1)).toBe(1); });
test("rejects text", () => { expect(() => parseValue("x")).toThrow(); });
`;

describe("Quality Judge preview", () => {
  it("keeps maintained and attributed readings separate and score influence disabled", () => {
    const result = analyzeQualitySourceFiles([
      sourceInput("src/value.ts", implementation),
      sourceInput("tests/value.test.ts", tests, { isTest: true }),
    ]);
    expect(result.activation).toBe("preview-only");
    expect(result.scoreInfluence).toBe(0);
    expect(result.maintainedCodebase.status).toBe("ready");
    expect(result.attributedCode.attributionStatus).toBe("ready");
    expect(result.attributedCode.previewScore).not.toBeNull();
    expect(
      Object.values(result.maintainedCodebase.dimensions).reduce(
        (total, dimension) => total + dimension.previewWeight,
        0,
      ),
    ).toBe(29);
    expect(result.receipts.length).toBeGreaterThan(0);
    for (const receipt of result.receipts) {
      expect(receipt).not.toHaveProperty("source");
      expect(receipt.lineStart).toBeGreaterThanOrEqual(1);
      expect(receipt.lineEnd).toBeGreaterThanOrEqual(receipt.lineStart);
    }
  });

  it("never turns insufficient attribution into negative maintained evidence", () => {
    const attributed = analyzeQualitySourceFiles([
      sourceInput("src/value.ts", implementation),
      sourceInput("tests/value.test.ts", tests, { isTest: true }),
    ]);
    const notAttributed = analyzeQualitySourceFiles([
      sourceInput("src/value.ts", implementation, {
        attribution: { status: "not-attributed", commitSha: null },
      }),
      sourceInput("tests/value.test.ts", tests, {
        isTest: true,
        attribution: { status: "not-attributed", commitSha: null },
      }),
    ]);
    expect(notAttributed.maintainedCodebase).toEqual(attributed.maintainedCodebase);
    expect(notAttributed.attributedCode.attributionStatus).toBe("not-attributable");
    expect(notAttributed.attributedCode.previewScore).toBeNull();
  });

  it("makes formatting, identifier names, file order, and repository order score-invariant", () => {
    const compact = sourceInput(
      "src/a.ts",
      "export function add(left:number,right:number):number{return left+right;}",
      { blobSha: "1".repeat(40) },
    );
    const formattedRenamed = sourceInput(
      "src/a.ts",
      `export function sum(first: number, second: number): number {\n  return first + second;\n}\n`,
      { blobSha: "2".repeat(40) },
    );
    const other = sourceInput("src/b.ts", implementation, {
      repository: "example/second",
      blobSha: "3".repeat(40),
    });
    const left = analyzeQualitySourceFiles([compact, other]);
    const right = analyzeQualitySourceFiles([other, formattedRenamed]);
    expect(left.maintainedCodebase.previewScore).toBe(right.maintainedCodebase.previewScore);
    expect(left.maintainedCodebase.dimensions).toEqual(right.maintainedCodebase.dimensions);
  });

  it("does not let comments, empty tests, or unsupported source manufacture quality", () => {
    const base = analyzeQualitySourceFiles([
      sourceInput("src/value.ts", implementation),
      sourceInput("src/other.ts", "export const other = 1;", { blobSha: "4".repeat(40) }),
    ]);
    const comments = analyzeQualitySourceFiles([
      sourceInput("src/value.ts", `// great code\n${implementation}\n// perfect`),
      sourceInput("src/other.ts", "/** amazing */\nexport const other = 1;", {
        blobSha: "4".repeat(40),
      }),
      sourceInput("tests/empty.test.ts", 'test("empty", () => {});', {
        isTest: true,
        blobSha: "5".repeat(40),
      }),
      sourceInput("main.py", "# flawless\ndef main(): return 1", {
        blobSha: "6".repeat(40),
      }),
    ]);
    expect(comments.maintainedCodebase.dimensions.correctnessDiscipline).toEqual(
      base.maintainedCodebase.dimensions.correctnessDiscipline,
    );
    expect(comments.maintainedCodebase.dimensions.testQuality.previewScore).toBeLessThanOrEqual(35);
    expect(comments.maintainedCodebase.coverage).toBeLessThan(100);
    expect(comments.limitations.some((entry) => entry.code === "unsupported-language")).toBe(true);
  });

  it("scopes supported mutations to their applicable dimensions", () => {
    const baseline = analyzeQualitySourceFiles([
      sourceInput("src/a.ts", "import { b } from './b.js'; export function a(){ return b(); }"),
      sourceInput("src/b.ts", "export function b(){ return 1; }", { blobSha: "7".repeat(40) }),
    ]);
    const cycle = analyzeQualitySourceFiles([
      sourceInput("src/a.ts", "import { b } from './b.js'; export function a(){ return b(); }"),
      sourceInput("src/b.ts", "import { a } from './a.js'; export function b(){ return a(); }", {
        blobSha: "8".repeat(40),
      }),
    ]);
    expect(cycle.maintainedCodebase.dimensions.architecture.previewScore).toBeLessThan(
      baseline.maintainedCodebase.dimensions.architecture.previewScore as number,
    );
    for (const id of [
      "correctnessDiscipline",
      "testQuality",
      "maintainability",
      "contractQuality",
      "securityHygiene",
    ] as const) {
      expect(cycle.maintainedCodebase.dimensions[id]).toEqual(
        baseline.maintainedCodebase.dimensions[id],
      );
    }

    const unsafe = analyzeQualitySourceFiles([
      sourceInput("src/a.ts", "export function a(input:string){ return eval(input); }"),
      sourceInput("src/b.ts", "export function b(){ return 1; }", { blobSha: "9".repeat(40) }),
    ]);
    expect(unsafe.maintainedCodebase.dimensions.securityHygiene.previewScore).toBeLessThan(
      baseline.maintainedCodebase.dimensions.securityHygiene.previewScore as number,
    );
  });

  it("keeps Unicode paths distinct and raw source out of result JSON and cache identity", () => {
    const composed = sourceInput("src/café.ts", implementation, { blobSha: "a".repeat(40) });
    const decomposed = sourceInput("src/café.ts", implementation, { blobSha: "b".repeat(40) });
    expect(qualityCacheIdentity(composed)).not.toBe(qualityCacheIdentity(decomposed));
    const result = analyzeQualitySourceFiles([composed, decomposed]);
    const json = JSON.stringify(result);
    expect(json).not.toContain("parseValue(value");
    expect(json).not.toContain("throw new TypeError");
  });
});
