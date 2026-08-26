#!/usr/bin/env node
import { createRequire } from "node:module";
import { createInterface } from "node:readline";

import { PRIVATE_CONTEXT_APP_CONFIG } from "@gitmog/private-context";

import { openExternal } from "./open-external.js";
import { resolveInvocationName, run } from "./cli.js";

for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
}

const manifest = createRequire(import.meta.url)("../package.json") as { version: string };
const interruption = new AbortController();
let interrupted = false;
const interrupt = (): void => {
  interrupted = true;
  interruption.abort();
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

try {
  const result = await run(process.argv, {
    invokedAs: resolveInvocationName(process.argv[1], process.env),
    version: manifest.version,
    env: process.env,
    isTty: process.stdout.isTTY === true,
    stderrIsTty: process.stderr.isTTY === true,
    stdinIsTty: process.stdin.isTTY === true,
    terminalColumns: process.stderr.columns ?? process.stdout.columns ?? 80,
    privateContextAppConfig: PRIVATE_CONTEXT_APP_CONFIG,
    openExternal,
    authorizationInput: {
      start: (callbacks) => {
        const input = createInterface({
          input: process.stdin,
          crlfDelay: Number.POSITIVE_INFINITY,
        });
        const onLine = (line: string): void => {
          const answer = line.trim().toLowerCase();
          if (answer === "") void callbacks.onEnter();
          else if (answer === "q" || answer === "quit" || answer === "cancel") {
            callbacks.onCancel();
          }
        };
        input.on("line", onLine);
        return {
          close: () => {
            input.removeListener("line", onLine);
            input.close();
          },
        };
      },
    },
    writeOutput: (value) => process.stderr.write(value),
    prompt: async (question) => {
      const { createInterface } = await import("node:readline/promises");
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await prompt.question(question, { signal: interruption.signal });
      } finally {
        prompt.close();
      }
    },
    writeProgress: (value) => process.stderr.write(value),
    signal: interruption.signal,
    useFilesystem: true,
  });
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  process.exitCode = interrupted ? 130 : result.exitCode;
} catch {
  if (!interrupted) {
    process.stderr.write(
      "GIT MOG STOPPED\n\nGit Mog could not complete the command.\nRetry the command.\n",
    );
  }
  process.exitCode = interrupted ? 130 : 1;
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
