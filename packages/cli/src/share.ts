import type { SourceAnalysisResult, StoryResult } from "@gitmog/source-analysis";
import type { BattleResult } from "@gitmog/scoring";

import { containsHumanClassifierIdentity } from "./classifier-visibility.js";
import { derivePresentationVerdict, type PresentationVerdict } from "./presentation-verdict.js";
import { resolveClaimSupport } from "./support.js";
import { terminalSafe } from "./terminal-safe.js";

export type SharePreset = "plain" | "x" | "discord" | "linkedin";

export const SHARE_PRESETS: readonly SharePreset[] = Object.freeze([
  "plain",
  "x",
  "discord",
  "linkedin",
]);

export function parseSharePreset(value: string | null | undefined): SharePreset | null {
  const candidate = (value ?? "").trim().toLowerCase();
  return (SHARE_PRESETS as readonly string[]).includes(candidate)
    ? (candidate as SharePreset)
    : null;
}

export const X_CHARACTER_LIMIT = 280;
export const DISCORD_CHARACTER_LIMIT = 2_000;

const winnerOf = (battle: BattleResult): { readonly champion: string; readonly loser: string } => {
  const left = battle.left.username;
  const right = battle.right.username;
  return battle.winner === "right"
    ? { champion: right, loser: left }
    : { champion: left, loser: right };
};

const scoreOf = (battle: BattleResult, handle: string): number =>
  battle.left.username === handle ? battle.left.overallScore : battle.right.overallScore;

const headlineOf = (battle: BattleResult, presentation: PresentationVerdict): string => {
  const { champion, loser } = winnerOf(battle);
  if (presentation.band === "full-strength") {
    return battle.winner === "tie"
      ? `${presentation.label}. ${battle.left.username} ${String(battle.left.overallScore)} — ${battle.right.username} ${String(battle.right.overallScore)} on Git Mog.`
      : `${champion} mogged ${loser} ${String(scoreOf(battle, champion))}–${String(scoreOf(battle, loser))} on Git Mog. ${presentation.label}.`;
  }
  return battle.winner === "tie"
    ? `${presentation.label}. ${battle.left.username} ${String(battle.left.overallScore)} — ${battle.right.username} ${String(battle.right.overallScore)} on Git Mog.`
    : `${presentation.label}. ${champion} leads ${loser} ${String(scoreOf(battle, champion))}–${String(scoreOf(battle, loser))} on public GitHub work.`;
};

const scoreReceipt = (battle: BattleResult, compact = false): string => {
  const left = compact ? battle.left.username.slice(0, 10) : battle.left.username;
  const right = compact ? battle.right.username.slice(0, 10) : battle.right.username;
  return `SCORE ${left} ${String(battle.left.overallScore)} · ${right} ${String(battle.right.overallScore)}`;
};

const basisReceipt = (battle: BattleResult, compact = false): string => {
  const left = compact ? battle.left.username.slice(0, 10) : battle.left.username;
  const right = compact ? battle.right.username.slice(0, 10) : battle.right.username;
  return `COVERAGE ${left} ${String(battle.left.confidence.measuredWeight)}% · ${right} ${String(battle.right.confidence.measuredWeight)}%`;
};

const accessibleHumanCopy = (value: string): boolean => !containsHumanClassifierIdentity(value);

const supportedStory = (
  battle: BattleResult,
  source: SourceAnalysisResult,
  story: StoryResult,
  includeUrl: boolean,
): readonly string[] => {
  const resolved = resolveClaimSupport(story.finisher, battle, source);
  if (resolved === null || !accessibleHumanCopy(resolved.claim.text)) return [];
  const references = [...new Set(resolved.receipts.map((receipt) => receipt.reference))];
  return [
    `${terminalSafe(resolved.claim.text)} [1]`,
    `[1] Source comparison — ${references.join(" vs ")}`,
    ...(includeUrl ? [...new Set(resolved.receipts.map((receipt) => receipt.sourceUrl))] : []),
  ];
};

export function renderShare(
  battle: BattleResult,
  preset: SharePreset,
  source: SourceAnalysisResult,
  story: StoryResult,
): string {
  const presentation = derivePresentationVerdict(battle, source);
  switch (preset) {
    case "x":
      return renderX(battle, source, story, presentation);
    case "discord":
      return renderDiscord(battle, source, story, presentation);
    case "linkedin":
      return renderLinkedin(battle, presentation);
    default:
      return renderPlain(battle, source, story, presentation);
  }
}

function renderPlain(
  battle: BattleResult,
  source: SourceAnalysisResult,
  story: StoryResult,
  presentation: PresentationVerdict,
): string {
  return [
    headlineOf(battle, presentation),
    scoreReceipt(battle),
    basisReceipt(battle),
    ...supportedStory(battle, source, story, true),
    battle.challenge.canonical,
  ].join("\n");
}

function renderX(
  battle: BattleResult,
  source: SourceAnalysisResult,
  story: StoryResult,
  presentation: PresentationVerdict,
): string {
  const headline = headlineOf(battle, presentation);
  const score = scoreReceipt(battle, true);
  const basis = basisReceipt(battle, true);
  const supported = supportedStory(battle, source, story, false);
  const command = battle.challenge.canonical;
  const compactCore = [
    `SCORE ${String(battle.left.overallScore)}:${String(battle.right.overallScore)}`,
    `COVERAGE ${String(battle.left.confidence.measuredWeight)}%:${String(battle.right.confidence.measuredWeight)}%`,
    command,
  ];
  const candidates: readonly (readonly string[])[] = [
    [headline, score, basis, ...supported, command],
    [headline, score, basis, command],
    [score, basis, command],
    compactCore,
  ];
  for (const segments of candidates) {
    const text = segments.join("\n");
    if (text.length <= X_CHARACTER_LIMIT) return text;
  }
  return compactCore.join("\n").slice(0, X_CHARACTER_LIMIT);
}

function renderDiscord(
  battle: BattleResult,
  source: SourceAnalysisResult,
  story: StoryResult,
  presentation: PresentationVerdict,
): string {
  const text = [
    `**${headlineOf(battle, presentation)}**`,
    scoreReceipt(battle),
    basisReceipt(battle),
    ...supportedStory(battle, source, story, true),
    `\`${battle.challenge.canonical}\``,
  ].join("\n");
  if (text.length <= DISCORD_CHARACTER_LIMIT) return text;
  return [
    scoreReceipt(battle, true),
    basisReceipt(battle, true),
    `\`${battle.challenge.canonical}\``,
  ].join("\n");
}

function renderLinkedin(battle: BattleResult, presentation: PresentationVerdict): string {
  return [
    headlineOf(battle, presentation),
    "",
    scoreReceipt(battle),
    basisReceipt(battle),
    "",
    "Run the matchup:",
    battle.challenge.canonical,
  ].join("\n");
}
