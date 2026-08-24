import { describe, expect, it } from "vitest";

import {
  extractSourceFeatures,
  featureLanguageOf,
  mergeSourceFeatures,
} from "../src/source-features.js";
import { simplifySourceForFeatures } from "../src/source-simplify.js";

describe("source feature language detection", () => {
  it.each([
    ["src/app.ts", "typescript"],
    ["src/app.tsx", "typescript"],
    ["lib/app.js", "javascript"],
    ["pipeline/main.py", "python"],
    ["internal/main.go", "go"],
    ["src/lib.rs", "rust"],
    ["Main.java", "java"],
    ["Program.cs", "csharp"],
    ["app.rb", "ruby"],
    ["index.php", "php"],
    ["main.swift", "swift"],
    ["Main.kt", "kotlin"],
    ["main.c", "c"],
    ["main.cpp", "cpp"],
    ["main.zig", "unknown"],
  ])("detects %s as %s", (path, expected) => {
    expect(featureLanguageOf(path)).toBe(expected);
  });
});

describe("deterministic source features", () => {
  it("counts TypeScript structure, guards, types, async and tests", () => {
    const source = `
import { z } from "zod";

interface Input { readonly id: string }
type Output = { ok: boolean };

export async function handle(input: unknown): Promise<Output> {
  if (input === null) return { ok: false };
  const parsed: Input = z.object({ id: z.string() }).parse(input);
  try {
    await Promise.resolve(parsed);
    return { ok: true };
  } catch (error) {
    throw error;
  }
}

describe("handle", () => {
  it("rejects null", () => {
    expect(handle(null)).resolves.toEqual({ ok: false });
  });
});

`;
    const features = extractSourceFeatures("src/handle.ts", source);
    expect(features.language).toBe("typescript");
    expect(features.importCount).toBe(1);
    expect(features.functionCount).toBeGreaterThanOrEqual(2);
    expect(features.classOrTypeCount).toBeGreaterThanOrEqual(2);
    expect(features.typeAnnotationCount).toBeGreaterThan(0);
    expect(features.validationMarkers).toBeGreaterThan(0);
    expect(features.guardMarkers).toBeGreaterThan(0);
    expect(features.errorHandlingMarkers).toBeGreaterThan(0);
    expect(features.asyncMarkers).toBeGreaterThan(0);
    expect(features.testMarkers).toBeGreaterThan(0);
    expect(features.nonBlankLines).toBeGreaterThan(10);
  });

  it("counts Python data, algorithm and error-handling markers", () => {
    const source = `
import numpy as np
import pandas as pd

def dijkstra(graph: dict[str, list[str]]) -> list[str]:
    if not graph:
        raise ValueError("empty")
    visited = set()
    try:
        frame = pd.DataFrame(graph)
        return np.array(frame).tolist()
    except ValueError:
        return []
`;
    const features = extractSourceFeatures("src/pipeline.py", source);
    expect(features.language).toBe("python");
    expect(features.importCount).toBe(2);
    expect(features.dataLibraryMarkers).toBeGreaterThan(2);
    expect(features.algorithmMarkers).toBeGreaterThan(0);
    expect(features.errorHandlingMarkers).toBeGreaterThan(1);
    expect(features.maximumNestingDepth).toBeGreaterThanOrEqual(1);
  });

  it("counts Go protocol and guard markers", () => {
    const source = `
package wire

import "net"

type Server struct {
  listener net.TCPListener
}

func Serve(conn net.Conn) error {
  if conn == nil {
    return errors.New("nil connection")
  }
  buffer := make([]byte, 1024)
  _, err := conn.Read(buffer)
  if err != nil {
    return err
  }
  return nil
}
`;
    const features = extractSourceFeatures("internal/wire.go", source);
    expect(features.language).toBe("go");
    expect(features.functionCount).toBeGreaterThan(0);
    expect(features.classOrTypeCount).toBeGreaterThan(0);
    expect(features.protocolMarkers).toBeGreaterThan(0);
    expect(features.guardMarkers).toBeGreaterThan(0);
    expect(features.errorHandlingMarkers).toBeGreaterThan(0);
  });

  it("marks unsupported languages as uncovered rather than negative", () => {
    const features = extractSourceFeatures("src/main.zig", "pub fn main() void {}");
    expect(features.language).toBe("unknown");
    expect(features.languageSupported).toBe(false);
    // The feature vector still reports safe language-neutral facts.
    expect(features.totalLines).toBe(1);
    expect(features.nonBlankLines).toBe(1);
  });

  it("is byte-stable for the same input", () => {
    const source = "export function sum(a: number, b: number): number {\n  return a + b;\n}\n";
    expect(JSON.stringify(extractSourceFeatures("src/sum.ts", source))).toBe(
      JSON.stringify(extractSourceFeatures("src/sum.ts", source)),
    );
  });

  it("merges sample totals and recomputes coverage", () => {
    const supported = extractSourceFeatures("src/a.ts", "export const a: number = 1;\n");
    const unsupported = extractSourceFeatures("src/b.zig", "pub const b = 2;\n");
    const merged = mergeSourceFeatures([supported, unsupported]);
    expect(merged.sampleCount).toBe(2);
    expect(merged.supportedShare).toBe(0.5);
    expect(merged.nonBlankLines).toBe(2);
  });
});

describe("feature-facing source simplification", () => {
  it("removes straightforward comment-only content without touching inline code", () => {
    const source = [
      "// instruction-shaped prose",
      "/* a comment-only block",
      " * with another line",
      " */",
      "/* another block",
      " */ const afterBlock = true;",
      'const url = "https://example.test/path"; // useful inline context',
      "/* retained inline block */ const enabled = true;",
      "export const value = 1;",
    ].join("\n");
    const simplified = simplifySourceForFeatures("src/value.ts", source);
    expect(simplified.commentLinesRemoved).toBe(5);
    expect(simplified.text).not.toContain("instruction-shaped");
    expect(simplified.text).toContain("https://example.test/path");
    expect(simplified.text).toContain("useful inline context");
    expect(simplified.text).toContain("const enabled = true");
    expect(simplified.text).toContain("const afterBlock = true");
  });

  it("removes Python comment-only lines and shortens dominant string payloads", () => {
    const payload = "x".repeat(140);
    const simplified = simplifySourceForFeatures(
      "src/value.py",
      `# comment only\nvalue = "${payload}"\nprint(value)`,
    );
    expect(simplified.commentLinesRemoved).toBe(1);
    expect(simplified.stringsShortened).toBe(1);
    expect(simplified.text).toContain("«string:140 chars»");
    expect(simplified.text).not.toContain(payload);
  });

  it("is deterministic and leaves short implementation strings intact", () => {
    const source = 'export const method = "POST";\n';
    const first = simplifySourceForFeatures("src/http.ts", source);
    expect(simplifySourceForFeatures("src/http.ts", source)).toEqual(first);
    expect(first.text).toBe(source);
  });
});
