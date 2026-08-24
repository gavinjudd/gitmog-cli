import { createHash } from "node:crypto";

/** Key-sorted JSON, so two structurally identical snapshots hash identically no
 * matter what order the API returned their fields in. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(",")}}`;
}

export function digest(value: unknown, length = 32): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, length);
}
