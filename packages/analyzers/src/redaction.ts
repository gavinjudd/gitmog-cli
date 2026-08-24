/**
 * Secret-shaped-value redaction for bounded public source samples.
 *
 * **This is a heuristic, not a guarantee.** It matches shapes — private-key armour, known
 * credential prefixes, assignment to secret-shaped identifiers, and long high-entropy
 * quoted strings. It does not understand meaning, so a credential that looks like
 * ordinary prose or an ordinary identifier passes straight through.
 *
 * `SECURITY.md` states that boundary in the same words. Source is held only for the
 * duration of feature extraction (ADR 0015).
 *
 * Pure: no I/O, no clock, no randomness, and the original value is never returned,
 * logged, or retained anywhere in this module.
 */

export const REDACTION_TOKEN = "\u00ABredacted\u00BB";

/** Cache-key contract for the heuristic itself. Any pattern or threshold change must
 * move this version so a locally cached style reading cannot outlive its redaction
 * basis. */
export const SOURCE_REDACTION_VERSION = "1.0.0-secret-shapes";

/** Above this share of redacted bytes the file is not a style sample any more. */
export const MAX_REDACTED_SHARE = 0.15;

/** Base64/hex-ish strings shorter than this are far too common to treat as secrets. */
const ENTROPY_MINIMUM_LENGTH = 32;

/** Shannon entropy per character. English prose sits near 3; base64 keys sit above 4. */
const ENTROPY_THRESHOLD = 3.9;

const SECRET_IDENTIFIER =
  /\b(?:[a-z0-9_]*(?:secret|password|passwd|passphrase|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth|credential|bearer|session[_-]?key|encryption[_-]?key)[a-z0-9_]*)\b/i;

/** Prefixes published by the issuing service, so a match is a strong signal. */
const KNOWN_PREFIXES: readonly RegExp[] = Object.freeze([
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bASIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bxox[abprs]-[0-9A-Za-z-]{10,}/g,
  /\bglpat-[0-9A-Za-z_-]{20,}/g,
  /\bnpm_[0-9A-Za-z]{36}\b/g,
  /\bvercel_[0-9A-Za-z]{24,}/g,
  /\bdop_v1_[0-9a-f]{64}\b/g,
  /\bSG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
]);

const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;

const QUOTED_VALUE = /(["'`])((?:\\.|(?!\1)[^\\\r\n])*)\1/g;

export interface RedactionResult {
  readonly text: string;
  readonly redactions: number;
  readonly redactedBytes: number;
  /** True when redaction removed enough of the file that it is no longer representative. */
  readonly exhausted: boolean;
}

function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

const isCredentialShaped = (value: string): boolean =>
  value.length >= ENTROPY_MINIMUM_LENGTH &&
  /^[A-Za-z0-9+/=_.-]+$/.test(value) &&
  shannonEntropy(value) >= ENTROPY_THRESHOLD;

/**
 * Replaces secret-shaped values with a stable token. Line and column structure is
 * preserved for private-key blocks so the deterministic feature extractor still sees a
 * plausible file shape.
 */
export function redactSecretShapedValues(source: string): RedactionResult {
  let redactions = 0;
  let redactedBytes = 0;

  const swap = (matched: string): string => {
    redactions += 1;
    redactedBytes += matched.length;
    return REDACTION_TOKEN;
  };

  let text = source.replace(PRIVATE_KEY_BLOCK, (matched) => {
    redactions += 1;
    redactedBytes += matched.length;
    // Keep the newline count so line-based features are not distorted by the removal.
    const newlines = matched.split("\n").length - 1;
    return `${REDACTION_TOKEN}${"\n".repeat(newlines)}`;
  });

  for (const pattern of KNOWN_PREFIXES) {
    text = text.replace(pattern, swap);
  }

  // Quoted values are examined twice: once because the identifier beside them names a
  // secret, once because the value itself looks like one.
  text = text.replace(QUOTED_VALUE, (matched, quote: string, inner: string, offset: number) => {
    if (inner.length === 0 || inner === REDACTION_TOKEN) return matched;
    const preceding = text.slice(Math.max(0, offset - 80), offset);
    const named = SECRET_IDENTIFIER.test(preceding) && /[:=]\s*$|[:=]\s*\S{0,4}$/.test(preceding);
    if (!named && !isCredentialShaped(inner)) return matched;
    redactions += 1;
    redactedBytes += inner.length;
    return `${quote}${REDACTION_TOKEN}${quote}`;
  });

  return {
    text,
    redactions,
    redactedBytes,
    exhausted: source.length > 0 && redactedBytes / source.length > MAX_REDACTED_SHARE,
  };
}
