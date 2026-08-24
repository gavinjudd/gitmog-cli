import type { ProfileScorecard } from "../fast-scan/types.js";

import { assignIdentity } from "./classify.js";
import { deriveIdentitySignals } from "./signals.js";
import type { AuraClass, ProfileIdentity } from "./types.js";

export interface CalibrationExpectation {
  readonly fixture: string;
  readonly mogsona: string;
  /** Assignments that would also be defensible for this fixture. */
  readonly alternates: readonly string[];
  readonly auraLeak: string | null;
  readonly auraClass: readonly [AuraClass, AuraClass];
  /** Evidence metric ids that must appear behind the assignment. */
  readonly evidenceMetrics: readonly string[];
  readonly minimumConfidence: number;
}

export interface CalibrationRow {
  readonly fixture: string;
  readonly handle: string;
  readonly identity: ProfileIdentity;
  readonly overallScore: number;
  readonly confidence: number;
  readonly measuredBaseline: number;
}

export function calibrationRow(fixture: string, card: ProfileScorecard): CalibrationRow {
  return {
    fixture,
    handle: card.username,
    identity: assignIdentity(card),
    overallScore: card.overallScore,
    confidence: card.confidence.score,
    measuredBaseline: Math.round(deriveIdentitySignals(card).measuredBaseline * 100),
  };
}

export interface CalibrationFinding {
  readonly fixture: string;
  readonly issue: string;
}

/** Deterministic and offline. Returns findings; the caller decides how to report them. */
export function checkCalibration(
  rows: readonly CalibrationRow[],
  expectations: readonly CalibrationExpectation[],
  cards: ReadonlyMap<string, ProfileScorecard>,
): readonly CalibrationFinding[] {
  const findings: CalibrationFinding[] = [];
  const byFixture = new Map(rows.map((row) => [row.fixture, row]));

  for (const expected of expectations) {
    const row = byFixture.get(expected.fixture);
    if (row === undefined) {
      findings.push({ fixture: expected.fixture, issue: "no calibration row was produced" });
      continue;
    }
    const { mogsona, auraLeak } = row.identity;
    const accepted = [expected.mogsona, ...expected.alternates];
    if (!accepted.includes(mogsona.id)) {
      findings.push({
        fixture: expected.fixture,
        issue: `assigned ${mogsona.id}, expected one of ${accepted.join(", ")}`,
      });
    }
    const [floor, ceiling] = expected.auraClass;
    if (!withinClass(mogsona.auraClass, floor, ceiling)) {
      findings.push({
        fixture: expected.fixture,
        issue: `aura class ${mogsona.auraClass} outside ${floor}..${ceiling}`,
      });
    }
    const leakId = auraLeak?.id ?? null;
    if (leakId !== expected.auraLeak) {
      findings.push({
        fixture: expected.fixture,
        issue: `aura leak ${leakId ?? "none"}, expected ${expected.auraLeak ?? "none"}`,
      });
    }
    if (row.confidence < expected.minimumConfidence) {
      findings.push({
        fixture: expected.fixture,
        issue: `confidence ${String(row.confidence)} below ${String(expected.minimumConfidence)}`,
      });
    }
    const card = cards.get(expected.fixture);
    if (card !== undefined) {
      const seen = new Set(
        mogsona.evidenceIds.map(
          (id) => card.evidence.find((item) => item.id === id)?.metric ?? "unknown",
        ),
      );
      for (const required of expected.evidenceMetrics) {
        if (!seen.has(required)) {
          findings.push({
            fixture: expected.fixture,
            issue: `evidence does not cite ${required}`,
          });
        }
      }
    }
  }
  return findings;
}

const ORDER: readonly AuraClass[] = ["unrated", "standard", "distinctive", "rare", "mythic"];

const withinClass = (value: AuraClass, floor: AuraClass, ceiling: AuraClass): boolean => {
  const index = ORDER.indexOf(value);
  return index >= ORDER.indexOf(floor) && index <= ORDER.indexOf(ceiling);
};

const pad = (value: string, width: number): string =>
  value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);

/** Plain text, no colour, no clock. Written to stdout by `pnpm identity:calibrate`. */
export function renderCalibrationReport(rows: readonly CalibrationRow[]): string {
  const lines: string[] = [
    "GIT MOG — DETERMINISTIC IDENTITY CALIBRATION",
    "",
    "Aura Class is evidence strength, not percentile rarity across GitHub.",
    "",
    `${pad("FIXTURE", 24)}${pad("MOGSONA", 22)}${pad("CLASS", 13)}${pad("SIG", 5)}${pad("CONF", 6)}${pad("BASE", 6)}${pad("EV", 4)}AURA LEAK`,
    "-".repeat(112),
  ];

  for (const row of rows) {
    const { mogsona, auraLeak } = row.identity;
    lines.push(
      pad(row.fixture, 24) +
        pad(mogsona.name, 22) +
        pad(mogsona.auraClass, 13) +
        pad(String(mogsona.signalScore), 5) +
        pad(String(row.confidence), 6) +
        pad(String(row.measuredBaseline), 6) +
        pad(String(mogsona.evidenceIds.length), 4) +
        (auraLeak === null ? "—" : `${auraLeak.name} (${auraLeak.severity})`),
    );
  }

  lines.push("", "PER-FIXTURE DETAIL", "");
  for (const row of rows) {
    const { mogsona, auraLeak, mogsonaCandidates, auraLeakCandidates } = row.identity;
    lines.push(`${row.fixture} — @${row.handle} · score ${String(row.overallScore)}`);
    lines.push(
      `  MOGSONA     ${mogsona.name} · ${mogsona.auraClass} · signal ${String(mogsona.signalScore)}`,
    );
    lines.push(`  SUMMARY     ${mogsona.summary}`);
    for (const signal of mogsona.qualifyingSignals) lines.push(`  SIGNAL      ${signal}`);
    for (const id of mogsona.evidenceIds) lines.push(`  EVIDENCE    ${id}`);
    if (auraLeak === null) {
      lines.push("  AURA LEAK   none qualified");
    } else {
      lines.push(`  AURA LEAK   ${auraLeak.name} · ${auraLeak.severity}`);
      for (const signal of auraLeak.qualifyingSignals) lines.push(`  LEAK SIGNAL ${signal}`);
      for (const id of auraLeak.evidenceIds) lines.push(`  LEAK EV     ${id}`);
    }
    const runnersUp = mogsonaCandidates
      .filter((candidate) => candidate.id !== mogsona.id)
      .slice(0, 5);
    for (const candidate of runnersUp) {
      lines.push(
        `  ALT         ${pad(candidate.id, 22)} ${pad(candidate.signalScore.toFixed(3), 7)} ev ${String(candidate.evidenceCount)} ${candidate.rejection ?? "eligible"}`,
      );
    }
    const leakRunners = auraLeakCandidates
      .filter((candidate) => candidate.id !== auraLeak?.id)
      .slice(0, 3);
    for (const candidate of leakRunners) {
      lines.push(
        `  LEAK ALT    ${pad(candidate.id, 22)} ${pad(candidate.signalScore.toFixed(3), 7)} ev ${String(candidate.evidenceCount)} ${candidate.rejection ?? "eligible"}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
