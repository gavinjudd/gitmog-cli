import type { PrivateContextAppConfig } from "./types.js";

/** Public GitHub App identifiers and the audited minimum-permission contract. */
export const PRIVATE_CONTEXT_APP_CONFIG = {
  version: "1.0.0",
  name: "Git Mog Private Context",
  slug: "git-mog-private-context",
  appId: "4711250",
  clientId: "Iv23liwSgKr5V8w6Qo7m",
  deviceFlow: true,
  permissions: {
    metadata: "read",
    contents: "read",
  },
  installationSelectionRequired: "selected",
  privateKeys: 0,
  clientSecrets: 0,
} as const satisfies PrivateContextAppConfig;
