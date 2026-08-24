import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { releaseMetadata } from "../scripts/build-release-artifact.mjs";

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
  };
  readonly quality: { readonly activation: { readonly state: string } };
  readonly evidence: Readonly<Record<string, unknown>>;
}

function readManifest(...segments: readonly string[]): PackageManifest {
  const parsed: unknown = JSON.parse(readFileSync(resolve(root, ...segments), "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Expected a package manifest object.");
  }
  return parsed;
}

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
      files: ["package.json", "dist/gitmog.mjs"],
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
      activation: { state: "disabled", reason: "human calibration pending" },
      qualityVersions: null,
      evidence: {
        "platform-acceptance.json": { bytes: 1, sha256: "d".repeat(64) },
      },
    }) as ReleaseEvidenceContract;
    expect(metadata.package.dependencies).toEqual({});
    expect(metadata.package.installScripts).toEqual({});
    expect(metadata.quality.activation.state).toBe("disabled");
    expect(metadata.evidence).toHaveProperty("platform-acceptance.json");
  });
});
