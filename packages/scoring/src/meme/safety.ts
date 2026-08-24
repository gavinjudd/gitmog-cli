/**
 * Content safety for the meme layer.
 *
 * PLANNING.md §3 and §11: roasts are generated from calculated development signals
 * and must not target identity, appearance, protected characteristics or personal
 * life. UNHINGED raises intensity, never the target (ADR 0005 D4).
 *
 * These patterns are asserted against every template at test time. They are not a
 * runtime filter, because a line that needs filtering should not exist in the source.
 */
export const PROHIBITED_PATTERNS: readonly RegExp[] = Object.freeze([
  // Intelligence and competence as a personal trait.
  /\b(stupid|idiot|idiotic|moron|dumb|braindead|imbecile|incompetent|clueless)\b/i,
  // Employability and career.
  /\b(unemployable|unhirable|fired|jobless|unemployed|recruiter|resume|salary|hire (?:them|him|her))\b/i,
  // Accusations of wrongdoing. No abuse signal is authorised in this version.
  /\b(fraud|fraudulent|scam|scammer|criminal|thief|stole|stealing|plagiaris|plagiariz|cheat(?:er|ing)?)\b/i,
  // Appearance and body.
  /\b(ugly|fat|skinny|bald|hideous|gross)\b/i,
  // Identity and protected characteristics.
  /\b(race|racial|ethnic|religion|religious|gender|sexuality|immigrant|nationality)\b/i,
  // Mental health and self-harm.
  /\b(insane|psycho|schizo|bipolar|depressed|depression|mental(?:ly)? ill|autis|adhd|kys|kill yourself)\b/i,
  // Personal life.
  /\b(girlfriend|boyfriend|wife|husband|divorce|parents|basement|virgin|incel|no life|touch grass)\b/i,
  // Dehumanising insults.
  /\b(loser|worthless|pathetic|trash human|waste of)\b/i,
]);

/**
 * Claims Git Mog has not measured and structurally cannot measure.
 *
 * Aura Class is evidence strength, not population rarity (ADR 0008 D3), and this
 * repository has never measured a population — so it may not describe one. Funding,
 * valuation, compensation and employment are not observable from public GitHub evidence
 * at all.
 */
export const UNSUPPORTED_CLAIM_PATTERNS: readonly RegExp[] = Object.freeze([
  // Fabricated population frequency.
  /\btop \d+(\.\d+)? ?%/i,
  /\bone in a (million|thousand|billion)\b/i,
  /\b\d+(st|nd|rd|th) percentile\b/i,
  /\brar(?:er|est) than\b/i,
  /\b(?:rare|rarest|uncommon|almost nobody)\b/i,
  // Fundraising and valuation.
  /\b(seed round|series [a-d]\b|valuation|raised \$|fundrais|cap table|investor)/i,
  // Employment and compensation.
  /\b(promot(?:ion|ed)|salary|compensation|equity package|job offer|interview loop)\b/i,
  // Private-work quality, which no public scan can see.
  /\bprivate (?:code|repos?|work) is\b/i,
]);

/**
 * Constructions that read as machine-written. None of them is unsafe; all of them are
 * the reason a line stops sounding like a person (ADR 0010 D3). The lane's premise is
 * that Git Mog's copy should not read like it was generated, so these fail the build.
 */
export const GENERIC_COPY_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bdidn['\u2019]t just\b/i,
  /\bdoesn['\u2019]t just\b/i,
  /\bnot only\b/i,
  /\bit['\u2019]s giving\b/i,
  /\blet that sink in\b/i,
  /\bin the world of\b/i,
  /\bat the end of the day\b/i,
  /\bplot twist\b/i,
  /\bgame[- ]chang/i,
  /\bunlock(?:s|ed|ing)?\b/i,
  /\bdelv(?:e|es|ing)\b/i,
  /\bwhen it comes to\b/i,
  /\bthe rest is history\b/i,
  /\bspeaks volumes\b/i,
  /\btestament to\b/i,
]);

export interface SafetyViolation {
  readonly pattern: string;
  readonly text: string;
}

const matches = (patterns: readonly RegExp[], text: string): readonly SafetyViolation[] =>
  patterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) => ({ pattern: pattern.source, text }));

export function findSafetyViolations(text: string): readonly SafetyViolation[] {
  return matches(PROHIBITED_PATTERNS, text);
}

export function findUnsupportedClaims(text: string): readonly SafetyViolation[] {
  return matches(UNSUPPORTED_CLAIM_PATTERNS, text);
}

export function findGenericCopy(text: string): readonly SafetyViolation[] {
  return matches(GENERIC_COPY_PATTERNS, text);
}

export const isSafeMemeText = (text: string): boolean =>
  findSafetyViolations(text).length === 0 &&
  findUnsupportedClaims(text).length === 0 &&
  findGenericCopy(text).length === 0;
