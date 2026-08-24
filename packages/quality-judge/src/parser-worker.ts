import { parentPort } from "node:worker_threads";

import { parseQualitySource } from "./parser.js";
import type { ParseQualityResult } from "./types.js";

interface ParseMessage {
  readonly type: "parse";
  readonly id: number;
  readonly path: string;
  readonly source: string;
}

if (parentPort === null) throw new Error("Quality parser isolation is unavailable.");

const port = parentPort;
port.on("message", (value: unknown) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    value.type !== "parse" ||
    !("id" in value) ||
    !Number.isSafeInteger(value.id) ||
    !("path" in value) ||
    typeof value.path !== "string" ||
    !("source" in value) ||
    typeof value.source !== "string"
  ) {
    return;
  }
  const message = value as ParseMessage;
  let result: ParseQualityResult;
  try {
    result = parseQualitySource(message.path, message.source);
  } catch {
    result = { ok: false, reason: "isolation-failure" };
  }
  port.postMessage({ type: "result", id: message.id, result });
});
port.postMessage({ type: "ready" });
