import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = resolve(packageDirectory, "../..");
const qualityVersions = JSON.parse(
  readFileSync(resolve(repositoryDirectory, "config/quality-versions.json"), "utf8"),
) as { readonly result: string; readonly parserContract: string };
const manifest = JSON.parse(readFileSync(resolve(packageDirectory, "package.json"), "utf8")) as {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly repository: { readonly type: string; readonly url: string };
  readonly publishConfig: { readonly access: string };
  readonly engines: { readonly node: string };
  readonly bin: Readonly<Record<string, string>>;
  readonly files: readonly string[];
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
};
const bundlePath = resolve(packageDirectory, "dist/gitmog.mjs");
const parserBundlePath = resolve(packageDirectory, "dist/parsers/quality-worker.mjs");
const binPath = resolve(packageDirectory, "bin/gitmog.mjs");

describe("standalone npm distribution", () => {
  it("has the public identity, release metadata, accepted engines and both bins", () => {
    expect(manifest.name).toBe("gitmog");
    expect(manifest.version).toBe("0.3.0");
    expect(manifest.license).toBe("MIT");
    expect(manifest.repository).toEqual({
      type: "git",
      url: "https://github.com/gavinjudd/gitmog-cli.git",
    });
    expect(manifest.publishConfig).toEqual({ access: "public" });
    expect(manifest.engines.node).toBe("^22.23.2 || >=24.16.0 <25 || ^26.7.0");
    expect(manifest.bin).toEqual({
      gitmog: "./bin/gitmog.mjs",
      "git-mog": "./bin/gitmog.mjs",
    });
  });

  it("contains only the reviewed runtime directories", () => {
    expect(manifest.files).toEqual(["bin/", "dist/", "README.md", "LICENSE"]);
    expect(readdirSync(resolve(packageDirectory, "dist")).sort()).toEqual([
      "build.json",
      "gitmog.mjs",
      "parsers",
    ]);
    expect(readdirSync(resolve(packageDirectory, "dist/parsers"))).toEqual(["quality-worker.mjs"]);
    expect(readdirSync(resolve(packageDirectory, "bin"))).toEqual(["gitmog.mjs"]);
    if (process.platform === "win32") {
      expect(readFileSync(binPath, "utf8")).toMatch(/^#!\/usr\/bin\/env node/);
    } else {
      expect(statSync(binPath).mode & 0o111).not.toBe(0);
    }
  });

  it("bundles every workspace package into one pure-Node executable", () => {
    const bundle = readFileSync(bundlePath, "utf8");
    const parserBundle = readFileSync(parserBundlePath, "utf8");
    expect(bundle.length).toBeGreaterThan(100_000);
    expect(bundle).not.toMatch(/(?:from|import\s*\()\s*["']@gitmog\//);
    expect(bundle).not.toContain("workspace:");
    expect(bundle).not.toContain("sourceMappingURL=");
    expect(bundle).not.toMatch(/@ai-sdk|api\.openai\.com/);
    expect(bundle).not.toContain("node:child_process");
    expect(bundle).toContain("2.0.0-source-opportunity-scope");
    expect(bundle).toContain("6.1.0-failure-fallback-opportunities");
    expect(bundle).toContain("1.2.0-cache-invariant-support");
    expect(bundle).toContain("2.0.0-default-full-profile-snapshot");
    expect(bundle).toContain("default-full-snapshot:2");
    expect(bundle).toContain(qualityVersions.result);
    expect(bundle).toContain(qualityVersions.parserContract);
    expect(bundle).toContain("parsers/quality-worker.mjs");
    expect(parserBundle).toContain(qualityVersions.parserContract);
    expect(parserBundle).not.toContain("sourceMappingURL=");
    expect(parserBundle).not.toContain("node:child_process");
    expect(bundle).not.toContain("5.0.0-raw-path-blob-receipts");
    expect(bundle).not.toContain("1.1.0-stable-cache-raw-receipts");
    expect(bundle).not.toContain("fast-scan:1");
    expect(bundle).not.toContain("4.0.0-reused-tree-features");
    expect(bundle).not.toContain("1.0.0-default-bounded-analysis");
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.devDependencies ?? {}).toEqual({});
    expect(JSON.stringify(manifest)).not.toContain("workspace:");
    expect(JSON.stringify(manifest)).not.toContain("@gitmog/");
    for (const command of ["npx -y gitmog torvalds gvanrossum", "npx -y gitmog karpathy geohot"]) {
      expect(bundle).toContain(command);
      expect(bundle.split(command)).toHaveLength(2);
    }
    for (const term of [
      ["ultra", "think"].join(""),
      ["ol", "lama"].join(""),
      ["qw", "en"].join(""),
      ["ora", "cle"].join(""),
      ["AI", "GATEWAY"].join("_"),
      ["114", "34"].join(""),
      ["/api", "/version"].join(""),
      ["/api", "/tags"].join(""),
      ["/api", "/pull"].join(""),
      ["/api", "/chat"].join(""),
      `--${["ora", "cle"].join("")}`,
      `--${["ultra", "think"].join("")}`,
    ]) {
      expect(bundle.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it("contains no tests, fixtures, source samples or repository handoff files", () => {
    const bundle = readFileSync(bundlePath, "utf8");
    const parserBundle = readFileSync(parserBundlePath, "utf8");
    for (const forbidden of [
      "docs/EXECUTION_STATE.md",
      "tests/fixtures",
      ".env.local",
      '"sourceFiles":{',
      "agent-transcripts",
      "synthetic fixture",
      "api.example.test",
      "instruction-shaped-comment",
      "secret-shaped-source",
    ]) {
      expect(bundle, forbidden).not.toContain(forbidden);
      expect(parserBundle, forbidden).not.toContain(forbidden);
    }
  });

  it("ships the same MIT license as the repository", () => {
    expect(readFileSync(resolve(packageDirectory, "LICENSE"), "utf8")).toBe(
      readFileSync(resolve(repositoryDirectory, "LICENSE"), "utf8"),
    );
  });

  it("has no repository-relative runtime assumption", () => {
    const bytes = readFileSync(bundlePath);
    const bundle = bytes.toString("utf8");
    expect(bundle).not.toContain("/Users/");
    expect(bundle).not.toMatch(/[A-Za-z]:\\Users\\/u);
    expect(bundle).not.toContain("packages/cli");
    expect(bundle).not.toContain("docs/EXECUTION_STATE.md");
    expect(bytes.includes(0x1b)).toBe(false);
  });

  it("runs --version and help through the built bin", () => {
    const version = execFileSync(process.execPath, [binPath, "--version"], {
      cwd: packageDirectory,
      encoding: "utf8",
    });
    expect(version).toBe(`${manifest.version}\n`);

    const help = execFileSync(process.execPath, [binPath, "help"], {
      cwd: packageDirectory,
      encoding: "utf8",
    });
    expect(help).toContain("npx -y gitmog <left> <right>");
    expect(help).toContain("npx -y gitmog <username>");
    expect(help).toContain("npx -y gitmog torvalds gvanrossum");
    expect(help).toContain("npx -y gitmog karpathy geohot");
    expect(help.indexOf("npx -y gitmog <left> <right>")).toBeLessThan(
      help.indexOf("Try a famous matchup:"),
    );
    expect(help).toContain("--receipts");
    expect(help).toContain("--details");
    expect(help).toContain("--card");
    expect(help).toContain("--share");
    expect(help).toContain("Coverage is the share of the public scorecard");
    expect(help).toContain("one-time sign-in");
    expect(help).toContain("--help-all");
    expect(help).not.toContain("higher-quality");
  });

  it("ships the current famous-matchup onboarding in the package README", () => {
    const readme = readFileSync(resolve(packageDirectory, "README.md"), "utf8");
    expect(readme).toContain("npx -y gitmog torvalds gvanrossum");
    expect(readme).toContain("npx -y gitmog karpathy geohot");
    expect(readme).toContain("npx -y gitmog --cache-info");
    expect(readme).toContain("npx -y gitmog --clear-cache");
    expect(readme).toContain("25 MiB");
    expect(readme).toContain("No affiliation or endorsement implied.");
  });
});
