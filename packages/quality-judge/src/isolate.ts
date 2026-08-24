import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";

import { QUALITY_MAX_DECODED_BYTES_PER_FILE, QUALITY_PARSER_WALL_TIME_MS } from "./limits.js";
import type { ParseQualityResult, QualitySourceInput } from "./types.js";

export const QUALITY_PARSER_PROFILE_WALL_TIME_MS = 2_000;
export const QUALITY_PARSER_MAX_OLD_GENERATION_MB = 96;
export const QUALITY_PARSER_MAX_YOUNG_GENERATION_MB = 16;
export const QUALITY_PARSER_MAX_STACK_MB = 4;
// TypeScript is loaded inside the isolated worker before it reports ready. Standard hosted
// runners under concurrent package-test load can need over 1.5 seconds for that cold import, so
// keep a bounded startup lane
// separate from the stricter per-file parse timer while remaining inside the two-second profile
// deadline.
const WORKER_STARTUP_TIME_MS = 1_900;

export interface IsolatedParserOptions {
  readonly signal?: AbortSignal | undefined;
  readonly workerUrl?: URL | undefined;
  readonly perFileTimeoutMs?: number | undefined;
  readonly profileTimeoutMs?: number | undefined;
}

const defaultWorkerUrl = (): URL =>
  import.meta.url.endsWith("/gitmog.mjs")
    ? new URL("./parsers/quality-worker.mjs", import.meta.url)
    : new URL("./parser-worker.js", import.meta.url);

const supportedPath = (path: string): boolean => /\.(?:[cm]?[jt]sx?)$/iu.test(path);

const startWorker = async (
  url: URL,
  deadline: number,
  signal: AbortSignal | undefined,
): Promise<Worker | null> => {
  if (signal?.aborted === true || performance.now() >= deadline) return null;
  const worker = new Worker(url, {
    resourceLimits: {
      maxOldGenerationSizeMb: QUALITY_PARSER_MAX_OLD_GENERATION_MB,
      maxYoungGenerationSizeMb: QUALITY_PARSER_MAX_YOUNG_GENERATION_MB,
      stackSizeMb: QUALITY_PARSER_MAX_STACK_MB,
    },
    stdout: true,
    stderr: true,
  });
  worker.stdout.resume();
  worker.stderr.resume();
  return await new Promise((resolve) => {
    let settled = false;
    const settle = (value: Worker | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.off("message", message);
      worker.off("error", failed);
      worker.off("exit", exited);
      resolve(value);
    };
    const abort = (): void => {
      void worker.terminate();
      settle(null);
    };
    const message = (value: unknown): void => {
      if (typeof value === "object" && value !== null && "type" in value && value.type === "ready")
        settle(worker);
    };
    const failed = (): void => settle(null);
    const exited = (): void => settle(null);
    const remaining = Math.max(1, deadline - performance.now());
    const timer = setTimeout(
      () => {
        void worker.terminate();
        settle(null);
      },
      Math.min(WORKER_STARTUP_TIME_MS, remaining),
    );
    timer.unref();
    signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", message);
    worker.once("error", failed);
    worker.once("exit", exited);
  });
};

const parseWithWorker = async (
  worker: Worker,
  id: number,
  input: QualitySourceInput,
  deadline: number,
  perFileTimeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<{ readonly result: ParseQualityResult; readonly reusable: boolean }> =>
  await new Promise((resolve) => {
    let settled = false;
    const settle = (result: ParseQualityResult, reusable: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.off("message", message);
      worker.off("error", failed);
      worker.off("exit", exited);
      resolve({ result, reusable });
    };
    const stop = (reason: "cancelled" | "timeout" | "isolation-failure"): void => {
      void worker.terminate();
      settle({ ok: false, reason }, false);
    };
    const abort = (): void => stop("cancelled");
    const failed = (): void => settle({ ok: false, reason: "isolation-failure" }, false);
    const exited = (): void => settle({ ok: false, reason: "isolation-failure" }, false);
    const message = (value: unknown): void => {
      if (
        typeof value === "object" &&
        value !== null &&
        "type" in value &&
        value.type === "result" &&
        "id" in value &&
        value.id === id &&
        "result" in value
      ) {
        settle(value.result as ParseQualityResult, true);
      }
    };
    const remaining = Math.max(0, deadline - performance.now());
    const timer = setTimeout(
      () => stop("timeout"),
      Math.max(1, Math.min(perFileTimeoutMs, remaining)),
    );
    timer.unref();
    signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", message);
    worker.once("error", failed);
    worker.once("exit", exited);
    worker.postMessage({ type: "parse", id, path: input.path, source: input.source });
  });

/**
 * Parses adversarial source behind a hard worker timeout and V8 resource boundary. Source is sent
 * only to the worker, is never returned, and disappears when the worker terminates.
 */
export async function parseQualitySourcesIsolated(
  inputs: readonly QualitySourceInput[],
  options: IsolatedParserOptions = {},
): Promise<readonly (ParseQualityResult | null)[]> {
  const started = performance.now();
  const deadline = started + (options.profileTimeoutMs ?? QUALITY_PARSER_PROFILE_WALL_TIME_MS);
  const workerUrl = options.workerUrl ?? defaultWorkerUrl();
  const perFileTimeoutMs = options.perFileTimeoutMs ?? QUALITY_PARSER_WALL_TIME_MS;
  const results: Array<ParseQualityResult | null> = Array.from(
    { length: inputs.length },
    () => null,
  );
  const cancelled = (): boolean => options.signal?.aborted ?? false;
  let worker: Worker | null = null;
  for (const [index, input] of inputs.entries()) {
    if (cancelled()) {
      results[index] = { ok: false, reason: "cancelled" };
      continue;
    }
    if (!supportedPath(input.path)) {
      results[index] = { ok: false, reason: "unsupported-language" };
      continue;
    }
    if (Buffer.byteLength(input.source, "utf8") > QUALITY_MAX_DECODED_BYTES_PER_FILE) {
      results[index] = { ok: false, reason: "oversized" };
      continue;
    }
    if (performance.now() >= deadline) {
      results[index] = { ok: false, reason: "timeout" };
      continue;
    }
    worker ??= await startWorker(workerUrl, deadline, options.signal);
    if (worker === null) {
      results[index] = {
        ok: false,
        reason: cancelled() ? "cancelled" : "isolation-failure",
      };
      continue;
    }
    const parsed = await parseWithWorker(
      worker,
      index,
      input,
      deadline,
      perFileTimeoutMs,
      options.signal,
    );
    results[index] = parsed.result;
    if (!parsed.reusable) worker = null;
  }
  if (worker !== null) await worker.terminate();
  return results;
}
