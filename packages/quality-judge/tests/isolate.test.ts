import { describe, expect, it } from "vitest";

import { analyzeQualitySourceFilesIsolated } from "../src/isolated-analyze.js";
import { parseQualitySourcesIsolated } from "../src/isolate.js";
import type { QualitySourceInput } from "../src/types.js";

const sourceInput = (path: string, source: string): QualitySourceInput => ({
  repository: "public/example",
  commitSha: "a".repeat(40),
  blobSha: "b".repeat(40),
  path,
  sourceUrl: `https://github.com/public/example/blob/${"a".repeat(40)}/${path}`,
  source,
  byteLength: Buffer.byteLength(source),
  isTest: false,
  attribution: { status: "not-checked", commitSha: null },
});

const builtWorker = new URL("../dist/parser-worker.js", import.meta.url);

describe("quality parser isolation", () => {
  it("parses supported source in a bounded worker and fails unsupported lanes closed", async () => {
    const results = await parseQualitySourcesIsolated(
      [
        sourceInput(
          "main.ts",
          "export function value(input: number): number { return input + 1; }",
        ),
        sourceInput("main.py", "def value(input):\n    return input + 1\n"),
      ],
      { workerUrl: builtWorker },
    );
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toEqual({ ok: false, reason: "unsupported-language" });
  });

  it("terminates a parser that exceeds the hard per-file wall clock", async () => {
    const started = performance.now();
    const [result] = await parseQualitySourcesIsolated(
      [sourceInput("hostile.ts", "export const bounded = true;")],
      {
        workerUrl: new URL("./fixtures/hanging-worker.mjs", import.meta.url),
        perFileTimeoutMs: 20,
        profileTimeoutMs: 500,
      },
    );
    expect(result).toEqual({ ok: false, reason: "timeout" });
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("honors cancellation without starting parser work", async () => {
    const controller = new AbortController();
    controller.abort();
    const [result] = await parseQualitySourcesIsolated(
      [sourceInput("cancelled.ts", "export const value = true;")],
      { signal: controller.signal, workerUrl: builtWorker },
    );
    expect(result).toEqual({ ok: false, reason: "cancelled" });
  });

  it("returns only safe derived output from isolated product analysis", async () => {
    const marker = "RAW_SOURCE_MUST_NOT_SURVIVE";
    const result = await analyzeQualitySourceFilesIsolated(
      [sourceInput("safe.ts", `export const value = "${marker}";`)],
      { workerUrl: builtWorker },
    );
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(result.scoreInfluence).toBe(0);
  });
});
