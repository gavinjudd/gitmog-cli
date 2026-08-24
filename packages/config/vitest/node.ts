import { fileURLToPath } from "node:url";

import { defaultExclude, defineConfig } from "vitest/config";

export interface TestPresetOptions {
  include?: string[];
}

export const setupFiles = [fileURLToPath(new URL("./no-network.ts", import.meta.url))];

/**
 * Integration tests are excluded unless GITMOG_INTEGRATION=1, so the default
 * suite needs no running service.
 */
export function integrationExcludes(): string[] {
  return process.env["GITMOG_INTEGRATION"] === "1" ? [] : ["**/*.integration.test.*"];
}

export function nodeTestConfig(options: TestPresetOptions = {}) {
  return defineConfig({
    test: {
      environment: "node",
      include: options.include ?? ["tests/**/*.test.ts"],
      exclude: [...defaultExclude, ...integrationExcludes()],
      setupFiles,
      restoreMocks: true,
    },
  });
}
