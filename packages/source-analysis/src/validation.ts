import {
  findGenericCopy,
  findSafetyViolations,
  findUnsupportedClaims,
  type RoastMode,
} from "@gitmog/scoring";

import type { StoryClaim, StorySlot, StoryTarget, SourceAnalysisBattleRead } from "./types.js";

export interface ClaimEvidenceIndex {
  readonly leftEvidenceIds: ReadonlySet<string>;
  readonly rightEvidenceIds: ReadonlySet<string>;
  readonly leftSampleIds: ReadonlySet<string>;
  readonly rightSampleIds: ReadonlySet<string>;
  readonly leftHandle: string;
  readonly rightHandle: string;
  readonly roast: RoastMode;
}

export type BattleReadValidation =
  | { readonly ok: true; readonly value: SourceAnalysisBattleRead }
  | { readonly ok: false; readonly errors: readonly string[] };

const BUDGET_BY_SLOT: Readonly<Record<StorySlot, number>> = Object.freeze({
  "matchup-thesis": 220,
  "left-read": 220,
  "right-read": 220,
  finisher: 200,
  alternate: 180,
});

const PROHIBITED_GENERATED_PATTERNS: readonly RegExp[] = Object.freeze([
  /\b(?:wins?|winner|loses?|loser|victory|defeat(?:s|ed)?|outscor(?:e|es|ed)|mogged|beats?|dominates?|dominated)\b/i,
  /\b(?:takes?|owns?|claims?)\s+(?:the\s+)?(?:battle|matchup|round|crown)\b/i,
  /\b\d+(?:\.\d+)?\s*(?:\/\s*100|points?|score|percent|%|st|nd|rd|th)\b/i,
  /\b\d+(?:\.\d+)?\s*[-–—:]\s*\d+(?:\.\d+)?\b/,
  /\b(?:senior|junior|staff|principal|expert|genius|talented|skilled|competent)\b/i,
  /\b(?:is|seems?|appears?|looks?)\s+(?:smart|intelligent|brilliant|clever|gifted)\b/i,
  /\b(?:hireable|employable|career|job prospects?|employment|employer|paycheck|raise)\b/i,
  /(?:[$€£]\s?\d|\b\d+\s?(?:k|million)\s+(?:salary|compensation|pay)\b)/i,
  /\b(?:handsome|beautiful|attractive|unattractive|appearance|good-looking|bad-looking)\b/i,
  /\b(?:family|children|kids|home life|relationship|dating)\b/i,
  /\b(?:anxious|anxiety|ocd|trauma|sanity|mentally stable|mentally unstable)\b/i,
  /\b(?:race|racial|ethni\w*|religio\w*|christian|muslim|jewish|hindu|atheist|gender|male|female|nonbinary|transgender|sexuality|gay|lesbian|bisexual|nationality|citizen\w*|immigrant\w*)\b/i,
  /\b(?:liar|lies|lying|dishonest|deceptive|illegal|lawbreaker|law-breaking|fraud\w*|scam\w*|theft|criminal|crime)\b/i,
  /\b(?:human worth|personal worth|worth as a person)\b/i,
  /\b(?:always|never)\b/i,
  /\b(?:actually|really|should be|isn['’]t|is not).{0,48}\b(?:mogsona|aura leak|code dna)\b/i,
  /\b(?:real|true|actual|new|replacement)\s+(?:mogsona|aura leak|code dna)\b/i,
  /\b(?:mogsona|aura leak|code dna)\s+(?:is|should be|becomes?)\b/i,
  /\b(?:private repo|private work|private code)\b/i,
]);

const SOURCE_EXCERPT_PATTERNS: readonly RegExp[] = Object.freeze([
  /`/,
  /(?:^|\s)(?:const|let|var|def|fn|func|import|export)\s+[A-Za-z_$][\w$]*/,
  /(?:^|\s)(?:function|class|interface|type)\s+[A-Za-z_$][\w$]*(?:\s*[({=<:]|\s+extends\b)/,
  /=>|::|;\s*$|\{[^}]{8,}\}/,
]);

const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const keys = Object.keys(value).sort();
  return (
    keys.length === allowed.length && keys.every((key, index) => key === [...allowed].sort()[index])
  );
};

const strings = (value: unknown, maximum: number): readonly string[] | null => {
  if (!Array.isArray(value) || value.length > maximum) return null;
  if (value.some((entry) => typeof entry !== "string" || entry === "")) return null;
  const result = value as string[];
  return new Set(result).size === result.length ? result : null;
};

const citationSides = (
  claim: Pick<StoryClaim, "evidenceIds" | "sampleIds">,
  index: ClaimEvidenceIndex,
): ReadonlySet<"left" | "right"> => {
  const sides = new Set<"left" | "right">();
  for (const id of claim.evidenceIds) {
    if (index.leftEvidenceIds.has(id)) sides.add("left");
    if (index.rightEvidenceIds.has(id)) sides.add("right");
  }
  for (const id of claim.sampleIds) {
    if (index.leftSampleIds.has(id)) sides.add("left");
    if (index.rightSampleIds.has(id)) sides.add("right");
  }
  return sides;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const assertsProfileIdentity = (text: string, index: ClaimEvidenceIndex): boolean =>
  [index.leftHandle, index.rightHandle].some((handle) =>
    new RegExp(
      `(?:^|\\s)@?${escapeRegExp(handle)}\\s+(?:is|seems|appears|looks)\\s+(?:a|an|the)\\s+[a-z]`,
      "i",
    ).test(text),
  );

function validateClaim(
  value: unknown,
  expectedSlot: StorySlot,
  expectedTarget: StoryTarget | null,
  index: ClaimEvidenceIndex,
  errors: string[],
): StoryClaim | null {
  if (typeof value !== "object" || value === null) {
    errors.push(`${expectedSlot}: claim is not an object`);
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    !exactKeys(record, ["evidenceIds", "primaryEvidenceId", "sampleIds", "slot", "target", "text"])
  ) {
    errors.push(`${expectedSlot}: unknown or missing fields`);
    return null;
  }
  const text = record.text;
  const primaryEvidenceId = record.primaryEvidenceId;
  const target = record.target;
  const slot = record.slot;
  const evidenceIds = strings(record.evidenceIds, 8);
  const sampleIds = strings(record.sampleIds, 6);
  if (
    typeof text !== "string" ||
    typeof primaryEvidenceId !== "string" ||
    typeof target !== "string" ||
    typeof slot !== "string" ||
    evidenceIds === null ||
    sampleIds === null
  ) {
    errors.push(`${expectedSlot}: invalid field types`);
    return null;
  }
  if (slot !== expectedSlot || (expectedTarget !== null && target !== expectedTarget)) {
    errors.push(`${expectedSlot}: slot or target mismatch`);
    return null;
  }
  if (!(target === "left" || target === "right" || target === "matchup")) {
    errors.push(`${expectedSlot}: unknown target`);
    return null;
  }
  if (
    text !== text.trim() ||
    text.includes("\n") ||
    Array.from(text).length > BUDGET_BY_SLOT[expectedSlot] ||
    text.length < 12
  ) {
    errors.push(`${expectedSlot}: character budget or line shape failed`);
  }
  if (evidenceIds.length + sampleIds.length === 0) errors.push(`${expectedSlot}: no support ids`);
  if (primaryEvidenceId === "" || !evidenceIds.includes(primaryEvidenceId)) {
    errors.push(`${expectedSlot}: primary evidence id is missing from evidence ids`);
  }

  const allEvidence = new Set([...index.leftEvidenceIds, ...index.rightEvidenceIds]);
  const allSamples = new Set([...index.leftSampleIds, ...index.rightSampleIds]);
  if (evidenceIds.some((id) => !allEvidence.has(id)))
    errors.push(`${expectedSlot}: unknown evidence id`);
  if (sampleIds.some((id) => !allSamples.has(id)))
    errors.push(`${expectedSlot}: unknown sample id`);

  const sides = citationSides({ evidenceIds, sampleIds }, index);
  if (
    target === "left" &&
    (evidenceIds.some((id) => !index.leftEvidenceIds.has(id)) ||
      sampleIds.some((id) => !index.leftSampleIds.has(id)))
  ) {
    errors.push(`${expectedSlot}: left claim cites non-left support`);
  }
  if (
    target === "right" &&
    (evidenceIds.some((id) => !index.rightEvidenceIds.has(id)) ||
      sampleIds.some((id) => !index.rightSampleIds.has(id)))
  ) {
    errors.push(`${expectedSlot}: right claim cites non-right support`);
  }
  if (target === "matchup" && (!sides.has("left") || !sides.has("right"))) {
    errors.push(`${expectedSlot}: matchup claim needs support from both profiles`);
  }

  if (
    findSafetyViolations(text).length > 0 ||
    findUnsupportedClaims(text).length > 0 ||
    findGenericCopy(text).length > 0 ||
    PROHIBITED_GENERATED_PATTERNS.some((pattern) => pattern.test(text)) ||
    assertsProfileIdentity(text, index)
  ) {
    errors.push(`${expectedSlot}: unsafe or unsupported claim`);
  }
  if (SOURCE_EXCERPT_PATTERNS.some((pattern) => pattern.test(text))) {
    errors.push(`${expectedSlot}: source-like excerpt rejected`);
  }
  const mentionedHandles = [...text.matchAll(/@([A-Za-z\d](?:[A-Za-z\d-]{0,38}[A-Za-z\d])?)/g)].map(
    (match) => (match[1] ?? "").toLowerCase(),
  );
  const allowedHandles = new Set([index.leftHandle.toLowerCase(), index.rightHandle.toLowerCase()]);
  if (mentionedHandles.some((handle) => !allowedHandles.has(handle))) {
    errors.push(`${expectedSlot}: unknown profile handle`);
  }
  if (
    index.roast === "clean" &&
    /[!?]{2,}|\b(?:cooked|wrecked|destroyed|obliterated)\b/i.test(text)
  ) {
    errors.push(`${expectedSlot}: clean roast limit exceeded`);
  }

  return { text, primaryEvidenceId, evidenceIds, sampleIds, target, slot: expectedSlot };
}

const normalizedWords = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9@-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const fourGrams = (text: string): ReadonlySet<string> => {
  const words = normalizedWords(text);
  const result = new Set<string>();
  for (let index = 0; index <= words.length - 4; index += 1) {
    result.add(words.slice(index, index + 4).join(" "));
  }
  return result;
};

export function validateBattleRead(
  value: unknown,
  index: ClaimEvidenceIndex,
): BattleReadValidation {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null)
    return { ok: false, errors: ["result is not an object"] };
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["alternates", "finisher", "leftRead", "matchupThesis", "rightRead"])) {
    return { ok: false, errors: ["result has unknown or missing fields"] };
  }
  if (!Array.isArray(record.alternates) || record.alternates.length > 3) {
    return { ok: false, errors: ["alternates must contain zero to three claims"] };
  }

  const matchupThesis = validateClaim(
    record.matchupThesis,
    "matchup-thesis",
    "matchup",
    index,
    errors,
  );
  const leftRead = validateClaim(record.leftRead, "left-read", "left", index, errors);
  const rightRead = validateClaim(record.rightRead, "right-read", "right", index, errors);
  const finisher = validateClaim(record.finisher, "finisher", "matchup", index, errors);
  const alternates = record.alternates
    .map((claim) => validateClaim(claim, "alternate", null, index, errors))
    .filter((claim): claim is StoryClaim => claim !== null);
  const claims = [matchupThesis, leftRead, rightRead, finisher, ...alternates].filter(
    (claim): claim is StoryClaim => claim !== null,
  );

  const normalized = claims.map((claim) => normalizedWords(claim.text).join(" "));
  if (new Set(normalized).size !== normalized.length) errors.push("duplicate line");
  for (let left = 0; left < claims.length; left += 1) {
    for (let right = left + 1; right < claims.length; right += 1) {
      const leftClaim = claims[left];
      const rightClaim = claims[right];
      if (leftClaim === undefined || rightClaim === undefined) continue;
      const rightGrams = fourGrams(rightClaim.text);
      if ([...fourGrams(leftClaim.text)].some((gram) => rightGrams.has(gram))) {
        errors.push("motif repetition: shared four-word sequence");
      }
    }
  }
  const supportSignatures = new Map<string, number>();
  for (const claim of claims) {
    const signature = [...claim.evidenceIds, ...claim.sampleIds].sort().join("|");
    supportSignatures.set(signature, (supportSignatures.get(signature) ?? 0) + 1);
  }
  if ([...supportSignatures.values()].some((count) => count > 2)) {
    errors.push("motif repetition: one evidence premise used more than twice");
  }

  if (
    errors.length > 0 ||
    matchupThesis === null ||
    leftRead === null ||
    rightRead === null ||
    finisher === null
  ) {
    return { ok: false, errors: [...new Set(errors)] };
  }
  return {
    ok: true,
    value: { matchupThesis, leftRead, rightRead, finisher, alternates },
  };
}
