#!/usr/bin/env node
import { createRequire } from "node:module";

import { resolveInvocationName, run } from "./cli.js";

for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
}

const manifest = createRequire(import.meta.url)("../package.json") as { version: string };
const interruption = new AbortController();
const interrupt = (): void => {
  interruption.abort();
  process.exit(130);
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
    terminalColumns: process.stderr.columns ?? process.stdout.columns ?? 80,
    writeOutput: (value) => process.stdout.write(value),
    prompt: async (question) => {
      const { createInterface } = await import("node:readline/promises");
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
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
  process.exitCode = result.exitCode;
} catch {
  process.stderr.write(
    "GIT MOG STOPPED\n\nGit Mog could not complete the command.\nRetry the command.\n",
  );
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
