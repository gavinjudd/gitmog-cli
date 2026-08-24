import { AURA_LEAK_DEFINITIONS } from "../identity/aura-leak-catalog.js";
import { MOGSONA_DEFINITIONS } from "../identity/mogsona-catalog.js";
import { AURA_LEAK_VERSION, MOGSONA_VERSION } from "../identity/types.js";
import { MemeEngine } from "../meme/engine.js";
import { selectTheme } from "../meme/narrative.js";
import { MEME_TEMPLATES } from "../meme/templates.js";
import { MEME_ENGINE_VERSION } from "../meme/types.js";

import { FAST_SCAN_SCORING_VERSION, SCAN_TYPE } from "./catalog.js";
import { sha256Hex } from "./hash.js";
import type {
  BattleChallenge,
  BattleNarrative,
  BattleResult,
  BattleRound,
  EvidenceDiff,
  EvidenceItem,
  IdentityLines,
  MemeLine,
  ProfileScorecard,
  RoastMode,
  RoundWinner,
  Side,
} from "./types.js";
import { classifyVerdict } from "./verdict.js";

export interface BuildBattleOptions {
  readonly roast: RoastMode;
  /** Absolute origin for the shareable URL. Falls back to the battle path alone. */
  readonly siteUrl?: string | undefined;
}

const CONFIDENCE_DIFF_THRESHOLD = 15;
const SUMMARY_LINES = 3;
const SUMMARY_CANDIDATES = 6;

/**
 * Every deterministic presentation version that can alter canonical output. It joins the
 * battle key, so a tagline change cannot silently reuse a stored selection, and it is
 * separate from `FAST_SCAN_SCORING_VERSION`, which only moves when a number moves.
 */
export interface BattlePresentationVersions {
  readonly mogsona: string;
  readonly auraLeak: string;
  readonly memeEngine: string;
}

export const DEFAULT_PRESENTATION_VERSIONS: BattlePresentationVersions = Object.freeze({
  mogsona: MOGSONA_VERSION,
  auraLeak: AURA_LEAK_VERSION,
  memeEngine: MEME_ENGINE_VERSION,
});

const joinPresentationVersions = (versions: BattlePresentationVersions): string =>
  [versions.mogsona, versions.auraLeak, versions.memeEngine].join("+");

export const PRESENTATION_VERSION = joinPresentationVersions(DEFAULT_PRESENTATION_VERSIONS);

const systemLine = (id: string, text: string, evidenceIds: readonly string[] = []): MemeLine => ({
  text,
  templateId: id,
  atomId: id,
  evidenceIds,
});

export function battlePathFor(left: string, right: string): string {
  return `/battle/${left.toLowerCase()}-vs-${right.toLowerCase()}`;
}

export function battleKeyFor(
  left: ProfileScorecard,
  right: ProfileScorecard,
  roast: RoastMode,
  versions: BattlePresentationVersions = DEFAULT_PRESENTATION_VERSIONS,
): string {
  return sha256Hex([
    left.username.toLowerCase(),
    right.username.toLowerCase(),
    FAST_SCAN_SCORING_VERSION,
    joinPresentationVersions(versions),
    left.snapshotKey,
    right.snapshotKey,
    roast,
  ]);
}

/**
 * Pairwise battle. The winner is the higher canonical score and nothing in the
 * presentation layer can change it; the rounds add the head-to-head detail the two
 * independent scorecards cannot express on their own.
 */
export function buildBattle(
  left: ProfileScorecard,
  right: ProfileScorecard,
  options: BuildBattleOptions,
): BattleResult {
  const margin = Math.abs(left.overallScore - right.overallScore);
  const winner: RoundWinner =
    left.overallScore === right.overallScore
      ? "tie"
      : left.overallScore > right.overallScore
        ? "left"
        : "right";
  const verdict = classifyVerdict(margin);
  const battleKey = battleKeyFor(left, right, options.roast);
  const battlePath = battlePathFor(left.username, right.username);

  // The theme is chosen before any line is selected, so the whole battle can be told
  // through one argument instead of eight independent ones (ADR 0010 D1).
  const theme = selectTheme(left, right, margin, options.roast);
  const engine = new MemeEngine({
    left,
    right,
    battleKey,
    roast: options.roast,
    themeId: theme.themeId,
    reservedMotifs: [
      MOGSONA_MOTIF[left.mogsona.id],
      MOGSONA_MOTIF[right.mogsona.id],
      left.auraLeak === null ? undefined : AURA_LEAK_MOTIF[left.auraLeak.id],
      left.auraLeak === null ? undefined : AURA_LEAK_MOTIF[left.auraLeak.id],
      right.auraLeak === null ? undefined : AURA_LEAK_MOTIF[right.auraLeak.id],
      right.auraLeak === null ? undefined : AURA_LEAK_MOTIF[right.auraLeak.id],
    ].filter((motif): motif is string => motif !== undefined),
  });
  const winningSide: Side = winner === "right" ? "right" : "left";

  // The strongest atom belongs to the finisher. Once used, the global atom budget makes
  // the matchup line find a supporting angle instead of telling the same joke first.
  const finisher = engine.finisher(winningSide, margin);
  const matchup = engine.matchup(winningSide, margin);
  // Reserve supporting evidence for the narrative before rounds consume category atoms.
  // The engine asks for extra candidates because Aura Leak motif dedupe may remove some.
  const lowEvidence = [
    engine.lowEvidence("left", margin)?.line,
    engine.lowEvidence("right", margin)?.line,
  ].filter((line): line is MemeLine => line !== undefined);
  const rawSummary = [...lowEvidence, ...engine.summary(winningSide, margin, SUMMARY_CANDIDATES)];
  const rounds = buildRounds(left, right, engine);
  const strengths = {
    left: strengthFor(engine, left, "left", margin),
    right: strengthFor(engine, right, "right", margin),
  };
  const weaknesses = {
    left: suppressAuraLeakDuplicate(engine.weakness("left", margin)?.line ?? null, left),
    right: suppressAuraLeakDuplicate(engine.weakness("right", margin)?.line ?? null, right),
  };
  const battleSummary = dedupeAuraLeakMotifs(rawSummary, left, right, engine.motifUsage()).slice(
    0,
    SUMMARY_LINES,
  );

  const headline =
    winner === "tie"
      ? `${left.username.toUpperCase()} AND ${right.username.toUpperCase()} ARE LEVEL`
      : `${(winner === "left" ? left : right).username.toUpperCase()} MOGS ${(winner === "left" ? right : left).username.toUpperCase()}`;

  const narrative: BattleNarrative = {
    version: MEME_ENGINE_VERSION,
    themeId: theme.themeId,
    dominantAtomId: theme.dominantAtomId,
    supportingAtomIds: theme.supportingAtomIds,
    matchupLine: matchup.line,
  };

  return {
    battleKey,
    battlePath,
    scoringVersion: FAST_SCAN_SCORING_VERSION,
    presentationVersion: PRESENTATION_VERSION,
    mogsonaVersion: MOGSONA_VERSION,
    auraLeakVersion: AURA_LEAK_VERSION,
    memeEngineVersion: MEME_ENGINE_VERSION,
    scanType: SCAN_TYPE,
    roast: options.roast,
    left,
    right,
    winner,
    margin,
    verdictClass: verdict.id,
    verdictLabel: verdict.label,
    headline,
    rounds,
    narrative,
    identity: {
      left: identityLinesFor(left, options.roast, false, false),
      right: identityLinesFor(
        right,
        options.roast,
        left.mogsona.id === right.mogsona.id,
        left.auraLeak !== null && left.auraLeak.id === right.auraLeak?.id,
      ),
    },
    finishingMove: finisher.line,
    battleSummary,
    strengths,
    weaknesses,
    shareCaption: buildShareCaption({
      left,
      right,
      winner,
      finisher: finisher.line.text,
      roast: options.roast,
      verdictLabel: verdict.label,
      footer: [
        absoluteUrl(battlePath, options.roast, options.siteUrl),
        reproduceCommand(left.username, right.username, options.roast),
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    }),
    cardFinisher: finisher.cardText,
    challenge: buildChallenge(left, right, winner, options.roast),
    evidenceDiff: buildEvidenceDiff(left, right),
    createdFromSnapshotKeys: [left.snapshotKey, right.snapshotKey],
  };
}

/**
 * The identity assignment lives on the scorecard and is roast-mode independent
 * (ADR 0008 D1). This resolves only the copy, and cites the same evidence ids the
 * assignment cited, so the line and the receipt cannot disagree.
 */
function identityLinesFor(
  card: ProfileScorecard,
  roast: RoastMode,
  sameMogsona: boolean,
  sameAuraLeak: boolean,
): IdentityLines {
  const mogsona = card.mogsona;
  const leak = card.auraLeak;
  const mogsonaText = mogsonaCopy(card, roast);
  const leakText = auraLeakCopy(card, roast);
  return {
    mogsonaLine: systemLine(
      `mogsona.${mogsona.id}.${roast}.${card.username.toLowerCase()}`,
      sameMogsona ? `Same Mogsona, separate receipts. ${mogsonaText}` : mogsonaText,
      mogsona.evidenceIds,
    ),
    auraLeakLine:
      leak === null
        ? null
        : systemLine(
            `auraLeak.${leak.id}.${roast}.${card.username.toLowerCase()}`,
            sameAuraLeak ? `Same Aura Leak, separate receipts. ${leakText}` : leakText,
            leak.evidenceIds,
          ),
  };
}

// The catalogs own the copy; these read it back through the id the classifier chose, so
// there is exactly one place a tagline is written.
const MOGSONA_COPY: Readonly<Record<string, Readonly<Record<RoastMode, string>>>> =
  Object.fromEntries(MOGSONA_DEFINITIONS.map((entry) => [entry.id, entry.copy]));

const AURA_LEAK_COPY: Readonly<Record<string, Readonly<Record<RoastMode, string>>>> =
  Object.fromEntries(AURA_LEAK_DEFINITIONS.map((entry) => [entry.id, entry.copy]));

const MOGSONA_MOTIF: Readonly<Record<string, string>> = Object.fromEntries(
  MOGSONA_DEFINITIONS.map((entry) => [entry.id, entry.motif]),
);

const AURA_LEAK_MOTIF: Readonly<Record<string, string>> = Object.fromEntries(
  AURA_LEAK_DEFINITIONS.map((entry) => [entry.id, entry.motif]),
);

const TEMPLATE_MOTIF: ReadonlyMap<string, string> = new Map(
  MEME_TEMPLATES.map((entry) => [entry.id, entry.motif]),
);

/** These facts already have dedicated, more legible sections in the CLI. Keeping them in
 * BATTLE NOTES would repeat the score card, confidence block or scan block verbatim. */
const DEDICATED_SECTION_SUMMARIES = new Set([
  "sum.scoreline",
  "sum.basis",
  "sum.confidence",
  "sum.margin",
]);

/**
 * Aura Leak copy is not selected by the meme engine, so its premise has not consumed the
 * engine's motif budget. Remove a summary line when adding the visible Aura Leak would
 * make that premise appear three times (ADR 0010 D2).
 */
function dedupeAuraLeakMotifs(
  lines: readonly MemeLine[],
  left: ProfileScorecard,
  right: ProfileScorecard,
  engineUsage: ReadonlyMap<string, number>,
): readonly MemeLine[] {
  const leakUses = new Map<string, number>();
  for (const leak of [left.auraLeak, right.auraLeak]) {
    if (leak === null) continue;
    const motif = AURA_LEAK_MOTIF[leak.id];
    if (motif !== undefined) leakUses.set(motif, (leakUses.get(motif) ?? 0) + 1);
  }

  const remainingUsage = new Map(engineUsage);
  return lines.filter((line) => {
    if (DEDICATED_SECTION_SUMMARIES.has(line.templateId)) return false;
    const motif = TEMPLATE_MOTIF.get(line.templateId);
    if (motif === undefined) return true;
    const combined = (remainingUsage.get(motif) ?? 0) + (leakUses.get(motif) ?? 0);
    if (combined <= 2) return true;
    remainingUsage.set(motif, Math.max(0, (remainingUsage.get(motif) ?? 0) - 1));
    return false;
  });
}

/** The Aura Leak is already the headline weakness. Do not print the same premise again
 * under a second label in the same profile block. */
function suppressAuraLeakDuplicate(line: MemeLine | null, card: ProfileScorecard): MemeLine | null {
  if (line === null || card.auraLeak === null) return line;
  const lineMotif = TEMPLATE_MOTIF.get(line.templateId);
  const leakMotif = AURA_LEAK_MOTIF[card.auraLeak.id];
  return lineMotif !== undefined && lineMotif === leakMotif ? null : line;
}

function mogsonaCopy(card: ProfileScorecard, roast: RoastMode): string {
  const definition = MOGSONA_COPY[card.mogsona.id];
  return definition?.[roast] ?? card.mogsona.summary;
}

function auraLeakCopy(card: ProfileScorecard, roast: RoastMode): string {
  const leak = card.auraLeak;
  if (leak === null) return "";
  const definition = AURA_LEAK_COPY[leak.id];
  return definition?.[roast] ?? leak.name;
}

/**
 * A shareable location for the battle, or `null` when the caller has none. The command
 * line has no URL to hand out, so its caption ends with the command that reproduces the
 * result instead — which is the more useful call to action there anyway.
 */
export function absoluteUrl(
  battlePath: string,
  roast: RoastMode,
  siteUrl: string | undefined,
): string | null {
  if (siteUrl === undefined || siteUrl === "") return null;
  const query = roast === "spicy" ? "" : `?roast=${roast}`;
  return `${siteUrl.replace(/\/$/, "")}${battlePath}${query}`;
}

/**
 * The reproduction command. `npx -y gitmog` is the canonical form because it is the only
 * one a recipient can run with no clone, no account and no local server (ADR 0010 D5).
 */
export function reproduceCommand(left: string, right: string, roast: RoastMode): string {
  const flag = roast === "spicy" ? "" : ` --roast ${roast}`;
  return `npx -y gitmog ${left} ${right}${flag}`;
}

function buildChallenge(
  left: ProfileScorecard,
  right: ProfileScorecard,
  winner: RoundWinner,
  roast: RoastMode,
): BattleChallenge {
  const champion = winner === "right" ? right : left;
  const flag = roast === "spicy" ? "" : ` --roast ${roast}`;
  return {
    canonical: reproduceCommand(left.username, right.username, roast),
    runItBack: reproduceCommand(right.username, left.username, roast),
    nextVictim: `npx -y gitmog ${champion.username} <handle>${flag}`,
    shareReceipt: `npx -y gitmog ${left.username} ${right.username}${flag} --share x`,
  };
}

function buildRounds(
  left: ProfileScorecard,
  right: ProfileScorecard,
  engine: MemeEngine,
): readonly BattleRound[] {
  const rounds: BattleRound[] = [];
  for (const category of left.categories) {
    const mirror = right.categories.find((candidate) => candidate.id === category.id);
    if (mirror === undefined) continue;

    const leftScore = category.score;
    const rightScore = mirror.score;
    const comparable = leftScore !== null && rightScore !== null;
    // Category scores carry one decimal. Preserve it here: rounding both 14.6 and 15.4
    // to 15 produced a visible tie beside a declared winner.
    const roundMargin = comparable ? Math.round(Math.abs(leftScore - rightScore) * 10) / 10 : 0;
    const roundWinner: RoundWinner = !comparable
      ? "unscored"
      : leftScore === rightScore
        ? "tie"
        : leftScore > rightScore
          ? "left"
          : "right";

    const subjectSide: Side = roundWinner === "right" ? "right" : "left";
    const line =
      roundWinner === "unscored"
        ? systemLine(
            "system.unscored",
            `Excluded from this numeric score — ${category.subtitle.toLowerCase()}`,
          )
        : (engine.round(category.id, subjectSide, roundMargin)?.line ??
          systemLine(
            "system.round",
            roundWinner === "tie"
              ? `${category.memeLabel} is level on the measured evidence.`
              : `${(subjectSide === "left" ? left : right).username} takes ${category.memeLabel} by ${String(roundMargin)}.`,
          ));

    rounds.push({
      categoryId: category.id,
      memeLabel: category.memeLabel,
      subtitle: category.subtitle,
      leftScore,
      rightScore,
      leftEarned: category.earned,
      rightEarned: mirror.earned,
      winner: roundWinner,
      margin: roundMargin,
      line,
      leftEvidenceId: decisiveEvidence(left, category.id, roundWinner === "left"),
      rightEvidenceId: decisiveEvidence(right, category.id, roundWinner === "right"),
    });
  }
  return rounds;
}

/** One evidence item per side per round: the winner's strongest positive, the loser's
 * clearest negative, and whatever exists when neither is available. */
function decisiveEvidence(card: ProfileScorecard, categoryId: string, won: boolean): string | null {
  const items = card.evidence.filter((item) => item.category === categoryId);
  const preferred = won ? "positive" : "negative";
  const match =
    items.find((item) => item.polarity === preferred) ??
    items.find((item) => item.polarity === "neutral") ??
    items[0];
  return match?.id ?? null;
}

function strengthFor(
  engine: MemeEngine,
  card: ProfileScorecard,
  side: Side,
  margin: number,
): MemeLine {
  const selected = engine.strength(side, margin);
  if (selected !== null) return selected.line;

  // ADR 0005 D5: everybody gets one real, evidence-backed positive.
  const best = [...card.categories]
    .filter((category) => category.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  const positive: EvidenceItem | undefined =
    card.positiveEvidence.find((item) => item.category === best?.id) ?? card.positiveEvidence[0];
  if (best === undefined) {
    return systemLine(
      "system.strength",
      `${card.username} has public repositories on GitHub, which is more public evidence than most accounts carry.`,
    );
  }
  return systemLine(
    "system.strength",
    positive === undefined
      ? `Strongest measured category: ${best.memeLabel} at ${String(Math.round(best.score ?? 0))}.`
      : `${best.memeLabel} at ${String(Math.round(best.score ?? 0))} — ${positive.title}.`,
    positive === undefined ? [] : [positive.id],
  );
}

function buildEvidenceDiff(left: ProfileScorecard, right: ProfileScorecard): EvidenceDiff | null {
  const delta = left.confidence.score - right.confidence.score;
  if (Math.abs(delta) < CONFIDENCE_DIFF_THRESHOLD) return null;
  const stronger: Side = delta > 0 ? "left" : "right";
  const strongerCard = stronger === "left" ? left : right;
  const weakerCard = stronger === "left" ? right : left;
  return {
    stronger,
    delta: Math.abs(delta),
    summary: `${strongerCard.username} is backed by ${String(strongerCard.confidence.analyzedRepositories)} inspected repositories at confidence ${String(strongerCard.confidence.score)}; ${weakerCard.username} by ${String(weakerCard.confidence.analyzedRepositories)} at ${String(weakerCard.confidence.score)}. These two results are not equally well evidenced.`,
  };
}

interface CaptionInput {
  readonly left: ProfileScorecard;
  readonly right: ProfileScorecard;
  readonly winner: RoundWinner;
  readonly finisher: string;
  readonly roast: RoastMode;
  readonly verdictLabel: string;
  /** Either a shareable URL or the command that reproduces the battle. */
  readonly footer: string;
}

/**
 * GitHub handles are labelled as GitHub handles. The product never renders a bare `@`
 * that implies the same person owns the matching account on the network being posted
 * to.
 */
function buildShareCaption(input: CaptionInput): string {
  const { left, right, winner } = input;
  const scoreLine = `SCORE — ${left.username} ${String(left.overallScore)} · ${right.username} ${String(right.overallScore)}`;
  const basisLine = `SCORE COVERAGE — ${left.username} ${String(left.confidence.measuredWeight)}% · ${right.username} ${String(right.confidence.measuredWeight)}%`;
  const identityLine = `${left.mogsona.name} vs ${right.mogsona.name}`;

  if (winner === "tie") {
    const opener =
      input.roast === "clean"
        ? `${left.username} and ${right.username} are level on Git Mog.`
        : `MUTUAL AURA. Nobody got mogged.`;
    return [
      opener,
      "",
      scoreLine,
      basisLine,
      identityLine,
      "",
      input.finisher,
      "",
      input.footer,
    ].join("\n");
  }

  const champion = winner === "left" ? left : right;
  const loser = winner === "left" ? right : left;
  const opener =
    input.roast === "clean"
      ? `${champion.username} edges out ${loser.username} on Git Mog, ${String(champion.overallScore)} to ${String(loser.overallScore)}.`
      : input.roast === "unhinged"
        ? `${input.verdictLabel}. ${champion.username} mogged ${loser.username} ${String(champion.overallScore)}–${String(loser.overallScore)} on GitHub.`
        : `${champion.username} mogged ${loser.username} ${String(champion.overallScore)}–${String(loser.overallScore)} on GitHub.`;

  return [
    opener,
    scoreLine,
    basisLine,
    identityLine,
    "",
    `Finisher: ${input.finisher}`,
    "",
    input.footer,
  ].join("\n");
}
