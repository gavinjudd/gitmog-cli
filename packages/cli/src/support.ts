import type { SourceAnalysisResult, StoryClaim } from "@gitmog/source-analysis";
import type { BattleResult, EvidenceItem, Side } from "@gitmog/scoring";

import { terminalSafe } from "./terminal-safe.js";

export interface ClaimSupportReceipt {
  readonly key: string;
  readonly id: string;
  readonly side: Side;
  readonly kind: "evidence" | "sample";
  readonly metric?: string | undefined;
  readonly value?: number | string | undefined;
  /** Short human label for compact numbered evidence. Never an internal schema id. */
  readonly label: string;
  /** Compact GitHub repository/path reference for default human output. */
  readonly reference: string;
  readonly compactText: string;
  readonly sourceUrl: string;
}

export interface ResolvedClaimSupport {
  readonly claim: StoryClaim;
  readonly primary: ClaimSupportReceipt;
  readonly receipts: readonly ClaimSupportReceipt[];
}

const githubReference = (value: string, fallback: string): string => {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "github.com") return fallback;
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.slice(0, 2).join("/") || fallback;
  } catch {
    return fallback;
  }
};

export const evidenceReceipt = (side: Side, item: EvidenceItem): ClaimSupportReceipt => ({
  key: `${side}:evidence:${item.id}`,
  id: item.id,
  side,
  kind: "evidence",
  metric: item.metric,
  ...(item.value === undefined ? {} : { value: item.value }),
  label: terminalSafe(item.title),
  reference: githubReference(item.sourceUrl, terminalSafe(item.repository ?? `@${side}`)),
  compactText: terminalSafe(item.detail),
  sourceUrl: terminalSafe(item.sourceUrl),
});

const sampleReceipts = (
  source: SourceAnalysisResult,
  side: Side,
  id: string,
): readonly ClaimSupportReceipt[] =>
  source[side].samples
    .filter((sample) => sample.sampleId === id)
    .map((sample) => ({
      key: `${side}:sample:${sample.sampleId}`,
      id: sample.sampleId,
      side,
      kind: "sample" as const,
      label: "Code sample",
      reference: terminalSafe(sample.repository),
      compactText: `${terminalSafe(sample.repository)}:${terminalSafe(sample.path)}`,
      sourceUrl: terminalSafe(sample.sourceUrl),
    }));

export function resolveSampleSupport(
  sampleIds: readonly string[],
  source: SourceAnalysisResult,
  sides: readonly Side[] = ["left", "right"],
): readonly ClaimSupportReceipt[] | null {
  const receipts: ClaimSupportReceipt[] = [];
  for (const id of sampleIds) {
    const matches = sides.flatMap((side) => sampleReceipts(source, side, id));
    if (matches.length === 0) return null;
    receipts.push(...matches);
  }
  return [...new Map(receipts.map((receipt) => [receipt.key, receipt])).values()];
}

const sidesFor = (claim: StoryClaim): readonly Side[] =>
  claim.target === "left" ? ["left"] : claim.target === "right" ? ["right"] : ["left", "right"];

/**
 * The one support-resolution path shared by terminal, card, and share rendering.
 * Unknown support makes the complete claim unrenderable; no renderer gets a partial
 * or best-effort object that could detach prose from its receipt.
 */
export function resolveClaimSupport(
  claim: StoryClaim,
  battle: BattleResult,
  source: SourceAnalysisResult,
): ResolvedClaimSupport | null {
  const sides = sidesFor(claim);
  const receipts: ClaimSupportReceipt[] = [];

  for (const id of claim.evidenceIds) {
    const matches = sides.flatMap((side) =>
      battle[side].evidence
        .filter((item) => item.id === id)
        .map((item) => evidenceReceipt(side, item)),
    );
    if (matches.length === 0) return null;
    receipts.push(...matches);
  }
  const samples = resolveSampleSupport(claim.sampleIds, source, sides);
  if (samples === null) return null;
  receipts.push(...samples);

  const primary = receipts.find(
    (receipt) => receipt.kind === "evidence" && receipt.id === claim.primaryEvidenceId,
  );
  if (primary === undefined) return null;

  const unique = [...new Map(receipts.map((receipt) => [receipt.key, receipt])).values()];
  return { claim, primary, receipts: unique };
}

export function resolveClaimsSupport(
  claims: readonly StoryClaim[],
  battle: BattleResult,
  source: SourceAnalysisResult,
): readonly ResolvedClaimSupport[] | null {
  const resolved = claims.map((claim) => resolveClaimSupport(claim, battle, source));
  return resolved.every((entry): entry is ResolvedClaimSupport => entry !== null) ? resolved : null;
}

export const dedupeSupportReceipts = (
  resolved: readonly ResolvedClaimSupport[],
): readonly ClaimSupportReceipt[] => [
  ...new Map(
    resolved.flatMap((entry) => entry.receipts).map((receipt) => [receipt.key, receipt]),
  ).values(),
];

export function resolveEvidenceSupport(
  evidenceIds: readonly string[],
  battle: BattleResult,
  sides: readonly Side[] = ["left", "right"],
): readonly ClaimSupportReceipt[] | null {
  const receipts: ClaimSupportReceipt[] = [];
  for (const id of evidenceIds) {
    const matches = sides.flatMap((side) =>
      battle[side].evidence
        .filter((item) => item.id === id)
        .map((item) => evidenceReceipt(side, item)),
    );
    if (matches.length === 0) return null;
    receipts.push(...matches);
  }
  return [...new Map(receipts.map((receipt) => [receipt.key, receipt])).values()];
}

export const compactSupportLine = (receipt: ClaimSupportReceipt, maximum = 140): string => {
  const prefix = `[${receipt.id}] `;
  const available = Math.max(1, maximum - prefix.length);
  const text =
    Array.from(receipt.compactText).length <= available
      ? receipt.compactText
      : `${Array.from(receipt.compactText)
          .slice(0, Math.max(1, available - 1))
          .join("")}…`;
  return `${prefix}${text}`;
};

/** Default human output uses numbered display markers and compact public references;
 * canonical ids remain available in JSON and `--receipts`. */
export const displaySupportLine = (receipt: ClaimSupportReceipt): string =>
  `${receipt.side === "left" ? "L" : "R"} · ${receipt.label} · ${receipt.reference}`;
