import { createHash } from "node:crypto";

/** The only non-pure-arithmetic primitive the scoring package uses. Hashing is
 * deterministic and reads nothing outside its argument, so scoring stays a pure
 * function of the snapshot. */
export function sha256Hex(parts: readonly string[], length = 24): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, length);
}
