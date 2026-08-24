import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { hasMainstreamLinter, usesGradualTyping } from "../src/languages.js";
import { isGeneratedPath, isSourcePath, isTestPath } from "../src/paths.js";
import { analyzeRepositoryTree, OVERSIZED_SOURCE_BYTES, type TreeEntry } from "../src/structure.js";

const blob = (path: string, sizeBytes = 800): TreeEntry => ({ path, type: "blob", sizeBytes });

const tree = (paths: readonly string[]): TreeEntry[] => paths.map((path) => blob(path));

describe("path classification", () => {
  it.each([
    ["src/index.ts", "source"],
    ["internal/server.go", "source"],
    ["tests/index.test.ts", "test"],
    ["src/parser.test.ts", "test"],
    ["pkg/store_test.go", "test"],
    ["test_helpers.py", "test"],
    ["node_modules/left-pad/index.js", "generated"],
    ["vendor/github.com/pkg/errors.go", "generated"],
    ["dist/bundle.js", "generated"],
    ["assets/app.min.js", "generated"],
    ["proto/service.pb.go", "generated"],
  ])("classifies %s as %s", (path, kind) => {
    const actual = isGeneratedPath(path)
      ? "generated"
      : isTestPath(path)
        ? "test"
        : isSourcePath(path)
          ? "source"
          : "other";
    expect(actual).toBe(kind);
  });

  it("never counts a generated file as source", () => {
    expect(isSourcePath("dist/index.js")).toBe(false);
    expect(isSourcePath("node_modules/pkg/index.ts")).toBe(false);
  });
});

describe("analyzeRepositoryTree", () => {
  it("detects tests, CI, linting, typing, docs and lockfiles", () => {
    const structure = analyzeRepositoryTree(
      tree([
        "README.md",
        "LICENSE",
        "CONTRIBUTING.md",
        "SECURITY.md",
        "package.json",
        "pnpm-lock.yaml",
        "tsconfig.json",
        "eslint.config.mjs",
        ".prettierrc.json",
        ".github/workflows/ci.yml",
        ".github/dependabot.yml",
        "docs/design.md",
        "Makefile",
        "src/index.ts",
        "src/store.ts",
        "tests/index.test.ts",
        "tests/store.test.ts",
        "tests/api.test.ts",
      ]),
    );

    expect(structure.hasTests).toBe(true);
    expect(structure.testFileCount).toBe(3);
    expect(structure.sourceFileCount).toBe(2);
    expect(structure.hasCi).toBe(true);
    expect(structure.ciSystems).toContain("github-actions");
    expect(structure.hasLinting).toBe(true);
    expect(structure.lintTools).toEqual(expect.arrayContaining(["eslint", "prettier"]));
    expect(structure.hasTypeChecking).toBe(true);
    expect(structure.hasLockfile).toBe(true);
    expect(structure.hasManifest).toBe(true);
    expect(structure.manifestKinds).toContain("npm");
    expect(structure.hasReadme).toBe(true);
    expect(structure.hasLicenseFile).toBe(true);
    expect(structure.hasContributingGuide).toBe(true);
    expect(structure.hasSecurityPolicy).toBe(true);
    expect(structure.hasDocsDirectory).toBe(true);
    expect(structure.hasAutomation).toBe(true);
    expect(structure.hasDependencyAutomation).toBe(true);
    expect(structure.separatesSourceFromTests).toBe(true);
    expect(structure.committedBuildOutput).toBe(false);
    expect(structure.committedDependencyDirectory).toBe(false);
  });

  it("reports absence as absence and never as a negative count", () => {
    const structure = analyzeRepositoryTree(tree(["index.js", "style.css"]));
    expect(structure.hasTests).toBe(false);
    expect(structure.hasCi).toBe(false);
    expect(structure.hasLinting).toBe(false);
    expect(structure.testFileCount).toBe(0);
    expect(Object.values(structure).every((value) => typeof value !== "number" || value >= 0)).toBe(
      true,
    );
  });

  it("excludes generated and vendored paths from source and test counts", () => {
    const structure = analyzeRepositoryTree(
      tree([
        "src/index.ts",
        "dist/index.js",
        "dist/index.d.ts",
        "node_modules/left-pad/index.js",
        "vendor/pkg/thing.go",
        "coverage/lcov-report/index.html",
      ]),
    );
    expect(structure.sourceFileCount).toBe(1);
    expect(structure.generatedFileCount).toBe(5);
    expect(structure.committedDependencyDirectory).toBe(true);
    expect(structure.committedBuildOutput).toBe(true);
  });

  it("flags oversized source files from blob size alone", () => {
    const structure = analyzeRepositoryTree([
      blob("src/small.ts", 900),
      blob("src/monolith.ts", OVERSIZED_SOURCE_BYTES + 1),
    ]);
    expect(structure.oversizedSourceFileCount).toBe(1);
    expect(structure.largestSourceFileBytes).toBe(OVERSIZED_SOURCE_BYTES + 1);
  });

  it("detects a workspace layout as a monorepo", () => {
    expect(
      analyzeRepositoryTree(tree(["packages/a/package.json", "packages/b/package.json"]))
        .isMonorepo,
    ).toBe(true);
    expect(analyzeRepositoryTree(tree(["pnpm-workspace.yaml"])).isMonorepo).toBe(true);
    expect(analyzeRepositoryTree(tree(["package.json"])).isMonorepo).toBe(false);
  });

  it("returns an all-zero structure for an empty tree", () => {
    const structure = analyzeRepositoryTree([]);
    expect(structure.fileCount).toBe(0);
    expect(structure.hasTests).toBe(false);
    expect(structure.hasReadme).toBe(false);
  });
});

describe("tool applicability", () => {
  it.each([
    ["TypeScript", true, true],
    ["Python", true, true],
    ["Go", true, false],
    ["Rust", true, false],
    ["Zig", false, false],
    [null, false, false],
  ])("%s: linter %s, gradual typing %s", (language, linter, typing) => {
    expect(hasMainstreamLinter(language)).toBe(linter);
    expect(usesGradualTyping(language)).toBe(typing);
  });
});

describe("analyzer safety invariants", () => {
  const sourceDirectory = new URL("../src/", import.meta.url);
  const sources = readdirSync(sourceDirectory)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => ({ file, text: readFileSync(new URL(file, sourceDirectory), "utf8") }));

  it("has source files to check", () => {
    expect(sources.length).toBeGreaterThan(3);
  });

  it.each(["node:child_process", "node:fs", "node:vm", "node:worker_threads", "node:http"])(
    "never imports %s",
    (module) => {
      for (const { file, text } of sources) {
        expect(text, file).not.toContain(module);
      }
    },
  );

  it.each(["eval(", "new Function(", "require(", "spawn(", "execSync", "import("])(
    "never uses %s",
    (pattern) => {
      for (const { file, text } of sources) {
        expect(text, file).not.toContain(pattern);
      }
    },
  );

  it("declares no dependencies at all", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies ?? {}).toEqual({});
  });
});
