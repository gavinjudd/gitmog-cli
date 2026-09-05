import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { QUALITY_MAX_DECODED_BYTES_PER_FILE, parseQualitySource } from "../src/parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (path: string): string => readFileSync(resolve(here, "fixtures", path), "utf8");

describe("parser-backed quality lane", () => {
  it.each([
    ["typescript/healthy.ts", "typescript"],
    ["javascript/healthy.js", "javascript"],
    ["javascript/optional-chaining.js", "javascript"],
  ] as const)("parses %s with the real TypeScript compiler AST", (path, language) => {
    const result = parseQualitySource(path, fixture(path));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.features.language).toBe(language);
    expect(result.features.parserVersion).toContain("typescript-");
    expect(result.features.nodeCount).toBeGreaterThan(5);
    expect(result.features.functionCount).toBeGreaterThan(0);
  });
  it("keeps optional chaining bounded and source-free in derived output", () => {
  const source = fixture("javascript/optional-chaining.js");
  const result = parseQualitySource("javascript/optional-chaining.js", source);

  expect(result.ok).toBe(true);
  if (!result.ok) return;

  expect(result.features.language).toBe("javascript");
  expect(result.features.parserVersion).toContain("typescript-");
  expect(result.features.functionCount).toBe(2);
  expect(result.features.nodeCount).toBeGreaterThan(5);
  expect(result.features.nodeCount).toBeLessThan(100);
  expect(JSON.stringify(result)).not.toContain(source);
  expect(JSON.stringify(result)).not.toContain("getOwnerName");
  expect(JSON.stringify(result)).not.toContain("getFirstItem");
});

  it("leaves Python and Go unsupported instead of applying lexical quality claims", () => {
    expect(parseQualitySource("main.py", "def main():\n    return 1")).toEqual({
      ok: false,
      reason: "unsupported-language",
    });
    expect(parseQualitySource("main.go", "package main\nfunc main() {}\n")).toEqual({
      ok: false,
      reason: "unsupported-language",
    });
  });

  it("fails closed on malformed, oversized, timed-out, and deeply hostile source", () => {
    expect(parseQualitySource("bad.ts", "export function broken( {")).toEqual({
      ok: false,
      reason: "malformed-source",
    });
    expect(
      parseQualitySource("huge.ts", "x".repeat(QUALITY_MAX_DECODED_BYTES_PER_FILE + 1)),
    ).toEqual({ ok: false, reason: "oversized" });
    let tick = 0;
    expect(
      parseQualitySource("slow.ts", "export const value = 1;", {
        now: () => {
          tick += 200;
          return tick;
        },
        timeoutMs: 150,
      }),
    ).toEqual({ ok: false, reason: "timeout" });
    const deep = `${"(".repeat(8_000)}1${")".repeat(8_000)}`;
    const deepResult = parseQualitySource("deep.ts", deep);
    expect(deepResult.ok).toBe(false);
  });

  it("reports supported security and correctness findings without source excerpts", () => {
    const source = fixture("typescript/hostile.ts");
    const result = parseQualitySource("hostile.ts", source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.features.dynamicEvaluationCount).toBe(1);
    expect(result.features.unsafeShellCount).toBe(1);
    expect(result.features.swallowedErrors).toBe(1);
    expect(JSON.stringify(result)).not.toContain("command: string");
    expect(JSON.stringify(result)).not.toContain("eval(input)");
  });
});
