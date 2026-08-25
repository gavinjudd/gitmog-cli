import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { validatePrivateContextAppConfig } from "../src/config.js";
import { PRIVATE_CONTEXT_APP_CONFIG } from "../src/default-config.js";

const validConfig = () => ({
  version: "1.0.0",
  name: "Git Mog Private Context",
  slug: "git-mog-private-context",
  appId: "123456",
  clientId: "Iv123456789012345678",
  deviceFlow: true,
  permissions: { metadata: "read", contents: "read" },
  installationSelectionRequired: "selected",
  privateKeys: 0,
  clientSecrets: 0,
});

describe("Private Context app configuration", () => {
  it("ships the audited public GitHub App identifiers", () => {
    const repositoryConfig = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../../../config/private-context-app.json"),
        "utf8",
      ),
    ) as unknown;
    expect(validatePrivateContextAppConfig(PRIVATE_CONTEXT_APP_CONFIG)).toEqual({
      ok: true,
      config: PRIVATE_CONTEXT_APP_CONFIG,
    });
    expect(PRIVATE_CONTEXT_APP_CONFIG).toEqual(repositoryConfig);
  });

  it("accepts only the minimal public GitHub App contract", () => {
    expect(validatePrivateContextAppConfig(validConfig())).toEqual({
      ok: true,
      config: validConfig(),
    });
  });

  it.each([
    ["write access", { permissions: { metadata: "read", contents: "write" } }],
    ["unknown permission", { permissions: { metadata: "read", contents: "read", issues: "read" } }],
    ["all repositories", { installationSelectionRequired: "all" }],
    ["private key metadata", { privateKeys: 1 }],
    ["client secret metadata", { clientSecrets: 1 }],
    ["webhook metadata", { webhook: { active: false } }],
    ["organization permission", { organizationPermissions: { members: "read" } }],
    ["malformed client ID", { clientId: "not-a-client-id" }],
  ] as const)("rejects %s", (_label, change) => {
    expect(validatePrivateContextAppConfig({ ...validConfig(), ...change }).ok).toBe(false);
  });
});
