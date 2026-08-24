import { nodeTestConfig } from "@gitmog/config/vitest/node";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  nodeTestConfig(),
  defineConfig({
    test: {
      // CLI acceptance exercises parser-backed analysis repeatedly. Keep those integration-style
      // tests on one hosted-runner lane so synthetic test concurrency cannot consume the parser's
      // production wall-time budget.
      fileParallelism: false,
      testTimeout: 30_000,
    },
  }),
);
