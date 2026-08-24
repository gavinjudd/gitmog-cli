import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

interface PackageManifest {
  readonly repository?: { readonly url?: unknown };
  readonly dependencies?: unknown;
  readonly scripts?: Readonly<Record<string, unknown>>;
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
});
