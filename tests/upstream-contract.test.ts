import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { releaseMetadata } from "../scripts/build-release-artifact.mjs";
import { comparePackedRuntimeReports } from "../scripts/compare-packed-runtime-reports.mjs";

const root = resolve(import.meta.dirname, "..");

interface PackageManifest {
  readonly repository?: { readonly url?: unknown };
  readonly dependencies?: unknown;
  readonly scripts?: Readonly<Record<string, unknown>>;
}

interface ReleaseEvidenceContract {
  readonly package: {
    readonly dependencies: Readonly<Record<string, string>>;
    readonly installScripts: Readonly<Record<string, string>>;
    readonly unpackedBytes: number;
    readonly members: readonly { readonly path: string; readonly bytes: number }[];
  };
  readonly quality: {
    readonly policy: { readonly state: string; readonly scoreInfluence: number };
  };
  readonly evidence: Readonly<Record<string, unknown>>;
}

function readManifest(...segments: readonly string[]): PackageManifest {
  const parsed: unknown = JSON.parse(readFileSync(resolve(root, ...segments), "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Expected a package manifest object.");
  }
  return parsed;
}

const sourceTextBelow = (directory: string): string =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name))
    .map((entry) => readFileSync(resolve(entry.parentPath, entry.name), "utf8"))
    .join("\n");

describe("public upstream contract", () => {
  it("owns the package repository metadata", () => {
    const rootManifest = readManifest("package.json");
    const distribution = readManifest("packages", "distribution", "package.json");
    expect(rootManifest.repository?.url).toBe("https://github.com/gavinjudd/gitmog-cli.git");
    expect(distribution.repository?.url).toBe("https://github.com/gavinjudd/gitmog-cli.git");
  });

  it("keeps the packed package dependency and install-script free", () => {
    const manifest = readManifest("packages", "distribution", "package.json");
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.scripts?.preinstall).toBeUndefined();
    expect(manifest.scripts?.install).toBeUndefined();
    expect(manifest.scripts?.postinstall).toBeUndefined();
  });

  it("serializes workspace test packages so parser wall clocks are not measured under CPU starvation", () => {
    const manifest = readManifest("package.json");
    expect(manifest.scripts?.test).toContain("turbo.mjs run test --concurrency=1");
  });

  it("binds every direct toolchain pin to a reviewed compatible license", () => {
    const review = JSON.parse(
      readFileSync(resolve(root, "config", "toolchain-licenses.json"), "utf8"),
    ) as {
      readonly dependencies: readonly {
        readonly name: string;
        readonly version: string;
        readonly license: string;
      }[];
    };
    expect(review.dependencies).toHaveLength(11);
    expect(new Set(review.dependencies.map(({ name }) => name)).size).toBe(11);
    expect(
      review.dependencies.every(({ license }) => ["MIT", "Apache-2.0"].includes(license)),
    ).toBe(true);
    const workspace = readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8");
    for (const dependency of review.dependencies) {
      const yamlName = dependency.name.startsWith("@") ? `"${dependency.name}"` : dependency.name;
      expect(workspace).toContain(`${yamlName}: ${dependency.version}`);
    }
  });

  it("binds exact candidate acceptance and release evidence", () => {
    const metadata = releaseMetadata({
      commit: "a".repeat(40),
      version: "0.3.0",
      filename: "gitmog-0.3.0.tgz",
      bytes: 1,
      unpackedBytes: 2,
      files: ["package.json", "dist/gitmog.mjs"],
      members: [
        { path: "package.json", bytes: 1 },
        { path: "dist/gitmog.mjs", bytes: 1 },
      ],
      sha1: "b".repeat(40),
      sha256: "c".repeat(64),
      integrity: "sha512-synthetic",
      manifest: {
        license: "MIT",
        repository: { type: "git", url: "https://github.com/gavinjudd/gitmog-cli.git" },
        engines: { node: ">=22" },
        bin: { gitmog: "./bin/gitmog.mjs" },
        scripts: { prepack: "node build.mjs" },
      },
      parserAssets: [],
      policy: {
        state: "informational-only",
        scoreInfluence: 0,
        reason: "Quality Judge is a separate product signal",
      },
      qualityVersions: null,
      evidence: {
        "platform-acceptance.json": { bytes: 1, sha256: "d".repeat(64) },
      },
    }) as ReleaseEvidenceContract;
    expect(metadata.package.dependencies).toEqual({});
    expect(metadata.package.unpackedBytes).toBe(2);
    expect(metadata.package.members).toHaveLength(2);
    expect(metadata.package.installScripts).toEqual({});
    expect(metadata.quality.policy).toEqual({
      state: "informational-only",
      scoreInfluence: 0,
      reason: "Quality Judge is a separate product signal",
    });
    expect(metadata.evidence).toHaveProperty("platform-acceptance.json");
  });

  it("keeps canonical scoring and Quality Judge dependency directions separate", () => {
    const scoringManifest = readManifest("packages", "scoring", "package.json");
    const qualityManifest = readManifest("packages", "quality-judge", "package.json");
    const scoringSource = sourceTextBelow(resolve(root, "packages", "scoring", "src"));
    const qualitySource = sourceTextBelow(resolve(root, "packages", "quality-judge", "src"));
    expect(scoringManifest.dependencies ?? {}).not.toHaveProperty("@gitmog/quality-judge");
    expect(qualityManifest.dependencies ?? {}).not.toHaveProperty("@gitmog/scoring");
    expect(scoringSource).not.toMatch(/quality-judge|qualityPreview/u);
    expect(qualitySource).not.toMatch(/@gitmog\/scoring/u);
  });

  it("binds parser versions, limits, and the exact package asset allowlist", () => {
    const versions = JSON.parse(
      readFileSync(resolve(root, "config", "quality-versions.json"), "utf8"),
    ) as {
      readonly parserContract: string;
      readonly parserImplementations: readonly {
        readonly version: string;
        readonly asset: string;
      }[];
      readonly unsupportedLanguages: readonly string[];
      readonly bounds: Readonly<Record<string, number>>;
    };
    const assets = JSON.parse(
      readFileSync(resolve(root, "config", "parser-assets.json"), "utf8"),
    ) as { readonly assets: readonly string[] };
    expect(versions.parserContract).toBe("1.0.0-typescript-ast");
    expect(versions.parserImplementations).toEqual([
      {
        languages: ["typescript", "javascript"],
        package: "typescript",
        version: "6.0.3",
        license: "Apache-2.0",
        asset: "dist/parsers/quality-worker.mjs",
      },
    ]);
    expect(versions.unsupportedLanguages).toEqual(["python", "go"]);
    expect(versions.bounds).toMatchObject({
      decodedBytesPerFile: 20 * 1024,
      decodedBytesPerProfile: 300 * 1024,
      parserWallTimePerFileMs: 500,
      parserWallTimePerProfileMs: 2_000,
      workerOldGenerationMb: 96,
    });
    expect(assets.assets).toEqual(["dist/parsers/quality-worker.mjs"]);
  });

  it("compares additive JSON and canonical battle bytes separately across Node lanes", () => {
    const directory = mkdtempSync(join(tmpdir(), "gitmog-node-reports-"));
    const paths = ["22.23.2", "24.19.0", "26.7.0"].map((version, index) => {
      const path = join(directory, `${String(index)}.json`);
      writeFileSync(
        path,
        `${JSON.stringify({
          node: `v${version}`,
          checks: [{ name: "synthetic", detail: "passed" }],
          canonicalJsonSha256: "a".repeat(64),
          canonicalBattleSha256: "b".repeat(64),
        })}\n`,
      );
      return path;
    });
    try {
      expect(comparePackedRuntimeReports(paths)).toHaveLength(3);
      const changed = JSON.parse(readFileSync(paths[2] as string, "utf8")) as Record<
        string,
        unknown
      >;
      changed.canonicalBattleSha256 = "c".repeat(64);
      writeFileSync(paths[2] as string, `${JSON.stringify(changed)}\n`);
      expect(() => {
        comparePackedRuntimeReports(paths);
      }).toThrow("Canonical battle bytes differ");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
