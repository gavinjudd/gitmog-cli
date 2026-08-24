import { presentBattleError, type BattleError } from "@gitmog/battle";
import {
  CODE_AXIS_IDS,
  CODE_AXIS_POLES,
  type CodeAxisId,
  type CodeDnaOutcome,
} from "@gitmog/personality";
import type { SourceAnalysisResult, StoryResult } from "@gitmog/source-analysis";
import type {
  QualityFinding,
  QualityJudgePair,
  QualityJudgeResult,
  QualityReading,
} from "@gitmog/quality-judge";
import type {
  BattleResult,
  BattleRound,
  EvidenceItem,
  MemeLine,
  ProfileScorecard,
  Side,
} from "@gitmog/scoring";

import { containsHumanClassifierIdentity } from "./classifier-visibility.js";
import { PLAIN_PALETTE, stripAnsi, type Palette, type PaletteKey } from "./color.js";
import { derivePresentationVerdict, type PresentationVerdict } from "./presentation-verdict.js";
import {
  evidenceReceipt,
  resolveClaimSupport,
  resolveEvidenceSupport,
  type ClaimSupportReceipt,
} from "./support.js";
import { terminalSafe } from "./terminal-safe.js";

const DEFAULT_COLUMNS = 80;
const MIN_COLUMNS = 40;
const MAX_COLUMNS = 120;
const DEFAULT_REASON_COUNT = 3;

const DEFAULT_ROUND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "ship.frequency": "ACTIVITY",
  "ship.substance": "SHIPPING",
  "ship.discipline": "COMMIT QUALITY",
  "ship.breadth": "COLLABORATION",
  "craft.testing": "TESTS",
  "craft.maintainability": "MAINTAINABILITY",
  "craft.tooling": "TOOLING",
  "craft.hygiene": "UPKEEP",
});

const defaultRoundLabel = (round: BattleRound): string =>
  DEFAULT_ROUND_LABELS[round.categoryId] ?? terminalSafe(round.subtitle).toUpperCase();

export const INTRO_STAGES = ["Fetching profiles", "Reading code samples"];
export const visibleWidth = (value: string): number => Array.from(stripAnsi(value)).length;

const clampColumns = (value: number | undefined): number =>
  Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.floor(value ?? DEFAULT_COLUMNS)));
const plainLength = (value: string): number => Array.from(value).length;
const padPlain = (value: string, width: number): string =>
  plainLength(value) >= width ? value : `${value}${" ".repeat(width - plainLength(value))}`;
const splitToken = (value: string, width: number): readonly string[] => {
  const characters = Array.from(value);
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += Math.max(1, width)) {
    chunks.push(characters.slice(index, index + Math.max(1, width)).join(""));
  }
  return chunks;
};
const wrapPlain = (
  value: string,
  width: number,
  firstPrefix = "",
  continuationPrefix = " ".repeat(plainLength(firstPrefix)),
): readonly string[] => {
  const safe = terminalSafe(value).trim();
  if (safe === "") return firstPrefix === "" ? [] : [firstPrefix.trimEnd()];
  const lines: string[] = [];
  let prefix = firstPrefix;
  let current = prefix;
  const words = safe.split(/\s+/u).flatMap((word) => {
    const available = Math.max(1, width - plainLength(continuationPrefix));
    return plainLength(word) <= available ? [word] : splitToken(word, available);
  });
  for (const word of words) {
    const candidate = current === prefix ? `${prefix}${word}` : `${current} ${word}`;
    if (plainLength(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current !== prefix) lines.push(current);
    prefix = continuationPrefix;
    current = `${prefix}${word}`;
  }
  if (current !== prefix) lines.push(current);
  return lines;
};
const wrapStyledPrefix = (
  prefix: string,
  value: string,
  width: number,
  palette: Palette,
  style: PaletteKey,
): readonly string[] => {
  const plain = wrapPlain(value, width, prefix);
  return plain.map((line, index) =>
    index === 0 && line.startsWith(prefix)
      ? `${palette.wrap(style, prefix)}${line.slice(prefix.length)}`
      : line,
  );
};
const section = (label: string, palette: Palette): string => palette.wrap("cyan", label);
const markerText = (marker: number, palette: Palette): string =>
  palette.wrap("dim", `[${String(marker)}]`);

export interface RenderOptions {
  readonly palette?: Palette | undefined;
  readonly receipts?: boolean | undefined;
  readonly details?: boolean | undefined;
  readonly columns?: number | undefined;
  readonly qualityPreview?: QualityJudgeResult | QualityJudgePair | undefined;
}

const isQualityPair = (value: QualityJudgeResult | QualityJudgePair): value is QualityJudgePair =>
  "left" in value && "right" in value;

const qualityScoreText = (reading: QualityReading): string =>
  reading.previewScore === null
    ? "— not enough supported source"
    : `${String(reading.previewScore)} (${String(reading.coverage)}%)`;

const compactQualityMetric = (metric: string, observed: number): string => {
  const value = String(observed);
  switch (metric) {
    case "high-complexity-function":
      return `${value} high-complexity funcs`;
    case "assertions":
      return `${value} test assertions`;
    case "failure-path-assertions":
      return `${value} failure-path tests`;
    case "import-cycles":
      return `${value} sampled import cycles`;
    case "dynamic-evaluation":
      return `${value} dynamic-eval patterns`;
    case "shell-template-construction":
      return `${value} unsafe shell patterns`;
    case "empty-catch":
      return `${value} empty catch blocks`;
    case "parsed-files":
      return `${value} parser-supported files`;
    default:
      return `${terminalSafe(metric)} ${value}`;
  }
};

const qualityProfileSummary = (
  handle: string,
  result: QualityJudgeResult,
  width: number,
  palette: Palette,
  receiptPrefix: string,
): readonly string[] => {
  const strength = result.maintainedCodebase.strengths[0];
  const weakness = result.maintainedCodebase.weaknesses[0];
  const finding: QualityFinding | undefined = weakness ?? strength;
  const receipt =
    finding === undefined
      ? undefined
      : result.receipts.find((candidate) => finding.receiptIds.includes(candidate.id));
  if (finding === undefined || receipt === undefined) {
    return wrapPlain(`@${terminalSafe(handle)} — limited parser-supported evidence.`, width).map(
      (line) => palette.wrap("yellow", line),
    );
  }
  const safeHandle = terminalSafe(handle);
  const metric = compactQualityMetric(receipt.metric, receipt.observed);
  const repository = terminalSafe(receipt.repository.split("/").at(-1) ?? receipt.repository);
  const file = terminalSafe(receipt.path.split("/").at(-1) ?? receipt.path);
  const marker = `[${receiptPrefix}${terminalSafe(receipt.id)}]`;
  const candidates = [
    `@${safeHandle} — ${metric} · ${repository}/${file}:${String(receipt.lineStart)} ${marker}`,
    `@${safeHandle} — ${metric} · ${repository}:${String(receipt.lineStart)} ${marker}`,
    `@${safeHandle} — ${metric} ${marker}`,
  ] as const;
  const plain = candidates.find((candidate) => plainLength(candidate) <= width) ?? candidates[2];
  return wrapPlain(plain, width).map((line) => {
    return line
      .replace(`@${safeHandle}`, palette.wrap("cyan", `@${safeHandle}`))
      .replace(metric, palette.wrap(finding.kind === "strength" ? "green" : "red", metric))
      .replace(marker, palette.wrap("dim", marker));
  });
};

const renderQualityPair = (
  battle: BattleResult,
  quality: QualityJudgePair,
  width: number,
  palette: Palette,
  detailed: boolean,
): string[] => {
  const maintained = `Maintained codebase  @${terminalSafe(battle.left.username)} ${qualityScoreText(quality.left.maintainedCodebase)} · @${terminalSafe(battle.right.username)} ${qualityScoreText(quality.right.maintainedCodebase)}`;
  const attributed = `Attributed code      @${terminalSafe(battle.left.username)} ${qualityScoreText(quality.left.attributedCode)} · @${terminalSafe(battle.right.username)} ${qualityScoreText(quality.right.attributedCode)}`;
  const lines = [section("CODE QUALITY · PREVIEW", palette)];
  for (const value of [maintained, attributed]) {
    lines.push(
      ...wrapPlain(value, width).map((line) =>
        line
          .replace(/@[-\w]+/gu, (handle) => palette.wrap("cyan", handle))
          .replace(/\((\d+)%\)/gu, (coverage) => palette.wrap("dim", coverage))
          .replace(/— not enough[^·]*/gu, (limited) => palette.wrap("yellow", limited)),
      ),
    );
  }
  if (!detailed) {
    lines.push(...qualityProfileSummary(battle.left.username, quality.left, width, palette, "L"));
    lines.push(...qualityProfileSummary(battle.right.username, quality.right, width, palette, "R"));
  } else {
    const labels: Readonly<Record<string, string>> = {
      correctnessDiscipline: "Correctness discipline",
      testQuality: "Test quality",
      maintainability: "Maintainability",
      contractQuality: "Contract quality",
      architecture: "Architecture",
      securityHygiene: "Security hygiene",
      duplicationAndDeadPatterns: "Duplication / dead patterns",
    };
    for (const id of Object.keys(labels)) {
      const left =
        quality.left.maintainedCodebase.dimensions[id as keyof QualityReading["dimensions"]];
      const right =
        quality.right.maintainedCodebase.dimensions[id as keyof QualityReading["dimensions"]];
      lines.push(
        ...wrapPlain(
          `${labels[id]} · @${terminalSafe(battle.left.username)} ${left.previewScore === null ? "unavailable" : String(left.previewScore)} · @${terminalSafe(battle.right.username)} ${right.previewScore === null ? "unavailable" : String(right.previewScore)}`,
          width,
          "  ",
        ),
      );
    }
    for (const side of ["left", "right"] as const) {
      for (const limitation of quality[side].limitations.slice(0, 4)) {
        lines.push(
          ...wrapStyledPrefix(
            "! ",
            `@${terminalSafe(battle[side].username)} ${terminalSafe(limitation.detail)}`,
            width,
            palette,
            "yellow",
          ),
        );
      }
    }
  }
  lines.push(palette.wrap("dim", "Not used in the winner pending human calibration."));
  return lines;
};

const renderQualityProfile = (
  handle: string,
  quality: QualityJudgeResult,
  width: number,
  palette: Palette,
  detailed: boolean,
): string[] => {
  const lines = [
    section("CODE QUALITY · PREVIEW", palette),
    ...wrapPlain(`Maintained codebase  ${qualityScoreText(quality.maintainedCodebase)}`, width),
    ...wrapPlain(`Attributed code      ${qualityScoreText(quality.attributedCode)}`, width),
    ...qualityProfileSummary(handle, quality, width, palette, "P"),
  ];
  if (detailed) {
    for (const [id, value] of Object.entries(quality.maintainedCodebase.dimensions)) {
      lines.push(
        ...wrapPlain(
          `${id} · ${value.previewScore === null ? "unavailable" : String(value.previewScore)}`,
          width,
          "  ",
        ),
      );
    }
    for (const limitation of quality.limitations.slice(0, 6)) {
      lines.push(...wrapStyledPrefix("! ", limitation.detail, width, palette, "yellow"));
    }
  }
  lines.push(palette.wrap("dim", "Not used in the score pending human calibration."));
  return lines;
};

const renderQualityReceipts = (
  entries: readonly { readonly prefix: string; readonly result: QualityJudgeResult }[],
  width: number,
  palette: Palette,
  complete: boolean,
): string[] => {
  const receipts = entries.flatMap(({ prefix, result }) =>
    result.receipts.map((receipt) => ({ prefix, receipt })),
  );
  if (receipts.length === 0) return [];
  const visible = complete ? receipts : receipts.slice(0, 4);
  const lines = [section(complete ? "QUALITY RECEIPTS" : "RECEIPTS", palette)];
  for (const { prefix, receipt } of visible) {
    lines.push(
      ...wrapStyledPrefix(
        `[${prefix}${receipt.id}] `,
        `${terminalSafe(receipt.metric)} — ${String(receipt.observed)} · ${terminalSafe(receipt.repository)}:${terminalSafe(receipt.path)}:${String(receipt.lineStart)}`,
        width,
        palette,
        "dim",
      ),
    );
    if (complete) {
      lines.push(
        ...wrapStyledPrefix("    ", terminalSafe(receipt.sourceUrl), width, palette, "dim"),
      );
    }
  }
  return lines;
};

interface MarkerEntry {
  readonly marker: number;
  readonly receipts: readonly ClaimSupportReceipt[];
  readonly summary: string;
}

interface MarkerRegistry {
  readonly entries: readonly MarkerEntry[];
  readonly add: (receipts: readonly ClaimSupportReceipt[] | null, summary: string) => number | null;
}

const createMarkerRegistry = (): MarkerRegistry => {
  const entries: MarkerEntry[] = [];
  const markerByKey = new Map<string, number>();
  return {
    entries,
    add: (receipts, summary) => {
      if (receipts === null || receipts.length === 0) return null;
      const unique = [...new Map(receipts.map((receipt) => [receipt.key, receipt])).values()];
      const key = `${summary}\u0000${unique
        .map((receipt) => receipt.key)
        .toSorted()
        .join("|")}`;
      const existing = markerByKey.get(key);
      if (existing !== undefined) return existing;
      const marker = entries.length + 1;
      markerByKey.set(key, marker);
      entries.push({ marker, receipts: unique, summary: terminalSafe(summary) });
      return marker;
    },
  };
};

const measurable = (
  reading: CodeDnaOutcome,
): reading is Extract<CodeDnaOutcome, { status: "ready" | "partial" }> =>
  reading.status === "ready" || reading.status === "partial";

const codeDnaStatusLabel = (status: CodeDnaOutcome["status"]): string =>
  status === "ready" ? "READY" : status === "partial" ? "LIMITED SAMPLE" : "INSUFFICIENT";
const overallCodeDnaStatusLabel = (status: SourceAnalysisResult["status"]): string =>
  status === "ready" ? "READY" : status === "partial" ? "LIMITED SAMPLE" : "INSUFFICIENT";
const codeDnaStatusStyle = (status: CodeDnaOutcome["status"]): PaletteKey =>
  status === "ready" ? "green" : "yellow";

const sourceStats = (
  reading: CodeDnaOutcome,
): { readonly files: number; readonly repos: number } => {
  if (!measurable(reading)) {
    return {
      files: reading.samples.length,
      repos: new Set(reading.samples.map((sample) => sample.repository)).size,
    };
  }
  const coverage = reading.axes.directAbstract.coverage;
  return { files: coverage.sampleCount, repos: coverage.repositoryCount };
};
const countLabel = (value: number, singular: string, plural = `${singular}s`): string =>
  `${String(value)} ${value === 1 ? singular : plural}`;
const sourceStatsText = (reading: CodeDnaOutcome): string => {
  const stats = sourceStats(reading);
  return `${countLabel(stats.files, "file")} across ${countLabel(stats.repos, "repository", "repositories")}`;
};
const sourceStatsCompact = (reading: CodeDnaOutcome): string => {
  const stats = sourceStats(reading);
  return `${countLabel(stats.files, "file")} / ${countLabel(stats.repos, "repo")}`;
};

const axisLabel: Readonly<Record<CodeAxisId, string>> = Object.freeze({
  directAbstract: "Direct ↔ Abstract",
  vibeRitual: "Vibe ↔ Ritual",
  compactCeremonial: "Compact ↔ Ceremonial",
  applicationSystems: "Application ↔ Systems",
});
const axisReading = (reading: CodeDnaOutcome, axis: CodeAxisId): string => {
  if (!measurable(reading)) return "insufficient";
  const value = reading.axes[axis];
  const pole =
    value.direction === "neutral"
      ? "NEUTRAL"
      : CODE_AXIS_POLES[axis][value.direction === "first-pole" ? 0 : 1];
  return `${String(value.score)} ${pole} · ${String(value.confidence)}% confidence`;
};

const scoredRounds = (battle: BattleResult): readonly BattleRound[] =>
  battle.rounds
    .filter(
      (round): round is BattleRound & { readonly leftScore: number; readonly rightScore: number } =>
        round.leftScore !== null && round.rightScore !== null,
    )
    .toSorted((left, right) => {
      const margin =
        Math.abs(right.leftScore - right.rightScore) - Math.abs(left.leftScore - left.rightScore);
      return margin === 0 ? left.categoryId.localeCompare(right.categoryId) : margin;
    });

const roundValue = (value: number, detailed: boolean): string =>
  detailed && !Number.isInteger(value) ? value.toFixed(1) : String(Math.round(value));
const winnerHandle = (battle: BattleResult): string | null =>
  battle.winner === "left" || battle.winner === "right" ? battle[battle.winner].username : null;

const supportForLine = (
  line: MemeLine,
  battle: BattleResult,
  sides: readonly Side[] = ["left", "right"],
): readonly ClaimSupportReceipt[] | null => {
  if (line.evidenceIds.length === 0) return null;
  const support = resolveEvidenceSupport(line.evidenceIds, battle, sides);
  return support !== null && support.length > 0 ? support : null;
};

interface RoundSupport {
  readonly text: string;
  readonly evidenceSummary: string;
  readonly receipts: readonly ClaimSupportReceipt[];
  readonly paired: boolean;
}

const ROUND_SIGNAL_PREFERENCES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "ship.frequency": [
    "ship.frequency.activeWeeks",
    "ship.frequency.commits",
    "ship.frequency.recency",
  ],
  "ship.substance": ["ship.substance.sustainedWork", "ship.substance.substantialProjects"],
  "ship.discipline": [
    "ship.discipline.mergeHygiene",
    "ship.discipline.messages",
    "ship.discipline.repairLoops",
  ],
  "ship.breadth": ["ship.breadth.continuity", "ship.breadth.external", "ship.breadth.released"],
  "craft.testing": ["craft.testing.workflow", "craft.testing.exists", "craft.testing.breadth"],
  "craft.maintainability": ["craft.maintainability.fileSize"],
  "craft.tooling": [
    "craft.tooling.automation",
    "craft.tooling.ci",
    "craft.tooling.build",
    "craft.tooling.lint",
    "craft.tooling.typing",
  ],
  "craft.hygiene": [
    "craft.hygiene.organization",
    "craft.hygiene.documentation",
    "craft.hygiene.dependencies",
    "craft.hygiene.releases",
    "craft.hygiene.abandonment",
  ],
});

const PAIRED_SIGNAL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "ship.frequency.activeWeeks": "Active weeks",
  "ship.frequency.commits": "Estimated yearly commits",
  "ship.frequency.recency": "Last public update",
  "ship.substance.sustainedWork": "Long-running projects",
  "ship.substance.substantialProjects": "Established projects",
  "ship.discipline.mergeHygiene": "Revert rate",
  "ship.discipline.messages": "Short commit messages",
  "ship.discipline.repairLoops": "Repair commits",
  "ship.breadth.continuity": "Project upkeep",
  "ship.breadth.external": "External contributions",
  "ship.breadth.released": "Versioned releases",
  "craft.testing.workflow": "Automated tests",
  "craft.testing.exists": "Automated tests",
  "craft.testing.breadth": "Test files",
  "craft.maintainability.fileSize": "Largest source file",
  "craft.tooling.automation": "Project automation",
  "craft.tooling.ci": "Automated checks",
  "craft.tooling.build": "Build setup",
  "craft.tooling.lint": "Linting",
  "craft.tooling.typing": "Type checks",
  "craft.hygiene.organization": "Project structure",
  "craft.hygiene.documentation": "Documentation",
  "craft.hygiene.dependencies": "Dependency upkeep",
  "craft.hygiene.releases": "Release upkeep",
  "craft.hygiene.abandonment": "Project upkeep",
});

const ratioPercent = (value: number | string): string | null => {
  if (typeof value !== "string") return null;
  const match = /^(\d+)\/(\d+)$/u.exec(value);
  if (match === null) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0)
    return null;
  return `${String(Math.round((numerator / denominator) * 100))}%`;
};

const testBreadthValue = (value: number): string =>
  value <= 1 ? `${String(Math.round(value * 100))} per 100 source files` : "outnumber source files";

const comparableSignalValue = (
  metric: string,
  value: number | string,
  profile: ProfileScorecard,
): number | null => {
  if (metric === "ship.frequency.activeWeeks" && typeof value === "number") {
    return value / Math.max(1, profile.diagnostics.activeWeeksWindow);
  }
  if (typeof value === "number") return value;
  const ratio = /^(\d+)\/(\d+)$/u.exec(value);
  if (ratio !== null) {
    const denominator = Number(ratio[2]);
    return denominator === 0 ? null : Number(ratio[1]) / denominator;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const pairedSignalValue = (
  metric: string,
  value: number | string,
  profile: ProfileScorecard,
): string => {
  if (metric === "ship.frequency.activeWeeks") {
    return `${String(value)}/${String(profile.diagnostics.activeWeeksWindow)}`;
  }
  if (metric === "ship.frequency.recency") return `${String(value)}d ago`;
  if (
    metric === "ship.discipline.mergeHygiene" ||
    metric === "ship.discipline.messages" ||
    metric === "ship.discipline.repairLoops" ||
    metric === "craft.hygiene.organization"
  ) {
    return `${String(value)}%`;
  }
  if (metric === "craft.maintainability.fileSize") return `${String(value)} KB`;
  if (metric === "craft.testing.workflow" || metric === "craft.tooling.ci") {
    return ratioPercent(value) ?? String(value);
  }
  if (metric === "craft.testing.breadth" && typeof value === "number") {
    return testBreadthValue(value);
  }
  return String(value);
};

const compactReceiptLabel = (label: string): string => {
  const annualized = /^(\d+) qualifying commits per year, estimated$/u.exec(label);
  return annualized === null
    ? terminalSafe(label)
    : `${annualized[1] as string} annualized qualifying commits`;
};
const compactEvidenceTitle = (item: EvidenceItem): string => compactReceiptLabel(item.title);

const evidenceForMetric = (
  profile: ProfileScorecard,
  metric: string,
): (EvidenceItem & { readonly value: number | string }) | null =>
  (profile.evidence.find((item) => item.metric === metric && item.value !== undefined) as
    (EvidenceItem & { readonly value: number | string }) | undefined) ?? null;

const evidenceById = (profile: ProfileScorecard, id: string | null): EvidenceItem | null =>
  id === null ? null : (profile.evidence.find((item) => item.id === id) ?? null);

const roundSupport = (round: BattleRound, battle: BattleResult): RoundSupport | null => {
  const preferences = ROUND_SIGNAL_PREFERENCES[round.categoryId] ?? [];
  const sharedMetrics = [
    ...preferences,
    ...battle.left.evidence
      .filter((item) => item.category === round.categoryId)
      .map((item) => item.metric)
      .filter((metric) => !preferences.includes(metric))
      .toSorted(),
  ];
  let equalPair: RoundSupport | null = null;
  for (const metric of sharedMetrics) {
    const left = evidenceForMetric(battle.left, metric);
    const right = evidenceForMetric(battle.right, metric);
    if (left === null || right === null) continue;
    const label =
      PAIRED_SIGNAL_LABELS[metric] ??
      battle.left.metrics.find((candidate) => candidate.id === metric)?.label ??
      round.memeLabel;
    const leftValue = pairedSignalValue(metric, left.value, battle.left);
    const rightValue = pairedSignalValue(metric, right.value, battle.right);
    const leftComparable = comparableSignalValue(metric, left.value, battle.left);
    const rightComparable = comparableSignalValue(metric, right.value, battle.right);
    const text = `${label}: ${leftValue}–${rightValue}`;
    const paired = {
      text,
      evidenceSummary: `${label} — ${leftValue} vs ${rightValue}`,
      receipts: [evidenceReceipt("left", left), evidenceReceipt("right", right)],
      paired: true,
    };
    if (leftComparable === null || rightComparable === null || leftComparable !== rightComparable)
      return paired;
    equalPair ??= paired;
  }

  if (equalPair !== null) return equalPair;

  const left =
    evidenceById(battle.left, round.leftEvidenceId) ??
    battle.left.evidence.find((item) => item.category === round.categoryId) ??
    null;
  const right =
    evidenceById(battle.right, round.rightEvidenceId) ??
    battle.right.evidence.find((item) => item.category === round.categoryId) ??
    null;
  const parts = [
    ...(left === null
      ? []
      : [`@${terminalSafe(battle.left.username)}: ${compactEvidenceTitle(left)}`]),
    ...(right === null
      ? []
      : [`@${terminalSafe(battle.right.username)}: ${compactEvidenceTitle(right)}`]),
  ];
  if (parts.length === 0) return null;
  const text = parts.join(" · ");
  return {
    text,
    evidenceSummary: text,
    receipts: [
      ...(left === null ? [] : [evidenceReceipt("left", left)]),
      ...(right === null ? [] : [evidenceReceipt("right", right)]),
    ],
    paired: false,
  };
};

const claimLines = (
  prefix: string,
  text: string,
  marker: number | null,
  width: number,
  palette: Palette,
  prefixStyle: PaletteKey = "cyan",
): readonly string[] => {
  const suffix = marker === null ? "" : ` [${String(marker)}]`;
  const wrapped = wrapPlain(`${text}${suffix}`, width, prefix);
  return wrapped.map((line, index) => {
    let styled = line;
    if (index === 0 && line.startsWith(prefix)) {
      styled = `${palette.wrap(prefixStyle, prefix)}${line.slice(prefix.length)}`;
    }
    if (marker !== null) {
      styled = styled.replace(`[${String(marker)}]`, markerText(marker, palette));
    }
    return styled;
  });
};

const renderHeader = (
  battle: BattleResult,
  presentation: PresentationVerdict,
  width: number,
  palette: Palette,
  detailed: boolean,
): string[] => {
  const winningSide = battle.winner === "left" || battle.winner === "right" ? battle.winner : null;
  const losingSide = winningSide === "left" ? "right" : "left";
  const winner = winningSide === null ? null : battle[winningSide];
  const loser = winningSide === null ? null : battle[losingSide];
  const resultPrefix = winner === null ? "◆ TIE" : `◆ @${terminalSafe(winner.username)} WINS`;
  const score =
    winner === null
      ? `${String(battle.left.overallScore)}–${String(battle.right.overallScore)}`
      : `${String(winner.overallScore)}–${String(loser?.overallScore ?? 0)}`;
  const resultText = `${resultPrefix} ${score} · ${terminalSafe(presentation.label)}`;
  const resultLines = wrapPlain(resultText, width).map((line) => {
    let styled = line.replace(resultPrefix, palette.wrap("green", resultPrefix));
    if (winner !== null) {
      const winningScore = String(winner.overallScore);
      styled = styled.replace(`${winningScore}–`, `${palette.wrap("green", winningScore)}–`);
    }
    return styled;
  });
  const coverageText = `Coverage: @${terminalSafe(battle.left.username)} ${String(battle.left.confidence.measuredWeight)}% · @${terminalSafe(battle.right.username)} ${String(battle.right.confidence.measuredWeight)}%`;
  const coverageLines = wrapPlain(coverageText, width).map((line) => {
    let cursor = 0;
    let styled = "";
    const handles = (["left", "right"] as const)
      .map((side) => `@${terminalSafe(battle[side].username)}`)
      .map((handle) => ({ handle, index: line.indexOf(handle) }))
      .filter(({ index }) => index >= 0)
      .toSorted((left, right) => left.index - right.index);
    for (const { handle, index } of handles) {
      styled += palette.wrap("dim", line.slice(cursor, index));
      styled += palette.wrap("cyan", handle);
      cursor = index + handle.length;
    }
    return `${styled}${palette.wrap("dim", line.slice(cursor))}`;
  });
  const canonicalLines =
    detailed && presentation.label !== battle.verdictLabel
      ? wrapPlain(`Canonical verdict: ${terminalSafe(battle.verdictLabel)}`, width).map((line) =>
          palette.wrap("dim", line),
        )
      : [];
  return [section("GIT MOG", palette), ...resultLines, ...coverageLines, ...canonicalLines];
};

const renderRounds = (
  battle: BattleResult,
  registry: MarkerRegistry,
  width: number,
  palette: Palette,
  detailed: boolean,
): string[] => {
  const rounds = detailed
    ? scoredRounds(battle)
    : scoredRounds(battle).slice(0, DEFAULT_REASON_COUNT);
  if (rounds.length === 0) return [];
  const lines = [section(detailed ? "ALL SCORED ROUNDS" : "THE FIGHT", palette)];
  const labelWidth = Math.max(...rounds.map((round) => plainLength(defaultRoundLabel(round))));
  for (const [index, round] of rounds.entries()) {
    const leftScore = roundValue(round.leftScore as number, detailed);
    const rightScore = roundValue(round.rightScore as number, detailed);
    const direction =
      round.winner === "left" || round.winner === "right"
        ? `@${terminalSafe(battle[round.winner].username)}${detailed ? " leads" : ""}`
        : "tie";

    if (!detailed) {
      const compactSupport = roundSupport(round, battle);
      const marker =
        compactSupport === null
          ? null
          : registry.add(compactSupport.receipts, compactSupport.evidenceSummary);
      const reason =
        compactSupport?.text ??
        `Score gap: ${String(Math.round(Math.abs((round.leftScore as number) - (round.rightScore as number))))}`;
      const label = defaultRoundLabel(round);
      const markerSuffix = marker === null ? "" : ` [${String(marker)}]`;
      const scorePair = `${leftScore}–${rightScore}`;
      const row = `${padPlain(label, labelWidth)}  ${scorePair}  ${direction} · ${reason}${markerSuffix}`;
      const styledScores = (): string =>
        `${palette.wrap(round.winner === "left" ? "green" : "white", leftScore)}–${palette.wrap(
          round.winner === "right" ? "green" : "white",
          rightScore,
        )}`;
      if (plainLength(row) <= width) {
        lines.push(
          `${palette.wrap("cyan", padPlain(label, labelWidth))}  ${styledScores()}  ${palette.wrap(
            round.winner === "tie" ? "white" : "green",
            direction,
          )} · ${reason}${marker === null ? "" : ` ${markerText(marker, palette)}`}`,
        );
      } else {
        lines.push(
          ...wrapPlain(`${label}  ${scorePair}  ${direction}`, width).map((line) =>
            line
              .replace(label, palette.wrap("cyan", label))
              .replace(scorePair, styledScores())
              .replace(
                direction,
                palette.wrap(round.winner === "tie" ? "white" : "green", direction),
              ),
          ),
          ...claimLines("  ", reason, marker, width, palette),
        );
      }
      continue;
    }

    const leftValue = `@${terminalSafe(battle.left.username)} ${leftScore}`;
    const rightValue = `@${terminalSafe(battle.right.username)} ${rightScore}`;
    lines.push(...wrapPlain(`${String(index + 1)}. ${terminalSafe(round.memeLabel)}`, width, "  "));
    const comparison = `${leftValue} ↔ ${rightValue} · ${direction}`;
    const contentPrefix = "     ";
    lines.push(
      ...wrapPlain(comparison, width, contentPrefix).map((line) => {
        const leftStyle: PaletteKey = round.winner === "left" ? "green" : "white";
        const rightStyle: PaletteKey = round.winner === "right" ? "green" : "white";
        const leftPlaceholder = "\u{E000}";
        const rightPlaceholder = "\u{E001}";
        const directionPlaceholder = "\u{E002}";
        return line
          .replace(leftValue, leftPlaceholder)
          .replace(rightValue, rightPlaceholder)
          .replace(direction, directionPlaceholder)
          .replace(leftPlaceholder, palette.wrap(leftStyle, leftValue))
          .replace(rightPlaceholder, palette.wrap(rightStyle, rightValue))
          .replace(
            directionPlaceholder,
            palette.wrap(round.winner === "tie" ? "white" : "green", direction),
          );
      }),
    );
    const support = supportForLine(round.line, battle);
    if (support !== null) {
      lines.push(
        ...claimLines(
          contentPrefix,
          terminalSafe(round.line.text),
          registry.add(support, `${round.memeLabel} — ${round.line.text}`),
          width,
          palette,
        ),
      );
    } else {
      lines.push(
        ...wrapPlain(
          `Score difference: ${String(Math.round(Math.abs((round.leftScore as number) - (round.rightScore as number))))} points.`,
          width,
          contentPrefix,
        ),
      );
    }
  }
  return lines;
};

const supportedAura = (battle: BattleResult, side: Side): readonly ClaimSupportReceipt[] | null => {
  const aura = battle[side].auraLeak;
  if (aura === null) return null;
  const support = resolveEvidenceSupport(aura.evidenceIds, battle, [side]);
  return support === null || support.length === 0 ? null : support;
};

const accessibleHumanCopy = (value: string): boolean => !containsHumanClassifierIdentity(value);

interface HumanWeakness {
  readonly text: string;
  readonly receiptText: string;
}

const metricRatioPercent = (profile: ProfileScorecard, metric: string): number =>
  Math.round((profile.metrics.find((item) => item.id === metric)?.ratio ?? 0) * 100);

const plainAuraWeakness = (profile: ProfileScorecard): HumanWeakness | null => {
  const aura = profile.auraLeak;
  if (aura === null) return null;
  const diagnostics = profile.diagnostics;
  switch (aura.id) {
    case "readme_ceo": {
      const documentation = metricRatioPercent(profile, "craft.hygiene.documentation");
      return {
        text: `Documentation covers ${String(documentation)}% of inspected projects, but there are zero versioned releases.`,
        receiptText: `Documentation vs releases — ${String(documentation)}% documented, 0 releases`,
      };
    }
    case "sidequest_collector":
      return {
        text: `Only ${String(diagnostics.substantialRepositories)} of ${String(diagnostics.eligibleRepositories)} public repositories show established project work.`,
        receiptText: `Repository mix — ${String(diagnostics.substantialRepositories)} of ${String(diagnostics.eligibleRepositories)} show established work`,
      };
    case "framework_tourist":
      return {
        text: `${String(diagnostics.languagesObserved.length)} languages appear publicly, but only ${String(diagnostics.substantialLanguages.length)} show up in established projects.`,
        receiptText: `Language depth — ${String(diagnostics.languagesObserved.length)} observed, ${String(diagnostics.substantialLanguages.length)} in established projects`,
      };
    case "release_avoider":
      return {
        text: `${String(diagnostics.substantialRepositories)} established projects, zero version tags.`,
        receiptText: `Versioned releases — ${String(diagnostics.substantialRepositories)} established projects, 0 tags`,
      };
    case "forklift_operator":
      return {
        text: `${String(diagnostics.forkedRepositories)} of ${String(diagnostics.publicRepositories)} public repositories are forks.`,
        receiptText: `Repository mix — ${String(diagnostics.forkedRepositories)} of ${String(diagnostics.publicRepositories)} are forks`,
      };
    case "fix_loop_enjoyer": {
      const repairRate = Math.round(diagnostics.repairCommitRate * 100);
      return {
        text: `${String(repairRate)}% of sampled commits repair an earlier change.`,
        receiptText: `Repair commits — ${String(repairRate)}% of the public sample`,
      };
    }
    case "commit_chaos": {
      const shortRate = Math.round(diagnostics.lowEffortCommitMessageRate * 100);
      return {
        text: `${String(shortRate)}% of sampled commit messages are one word or shorter.`,
        receiptText: `Commit messages — ${String(shortRate)}% are one word or shorter`,
      };
    }
    case "localhost_millionaire":
      return {
        text: "The public toolchain is built out, but there are zero versioned releases.",
        receiptText: "Delivery gap — configured toolchain, 0 releases",
      };
    case "code_hermit":
      return {
        text: "No public contributions appear outside owned repositories.",
        receiptText: "External contributions — none outside owned repositories",
      };
    case "yaml_engineer": {
      const withTests = diagnostics.repositoriesInspected - diagnostics.repositoriesWithoutTests;
      return {
        text: `${String(diagnostics.repositoriesInspected - diagnostics.repositoriesWithoutCi)} of ${String(diagnostics.repositoriesInspected)} inspected projects use automated checks, but only ${String(withTests)} show automated tests.`,
        receiptText: `Automated tests — ${String(withTests)} of ${String(diagnostics.repositoriesInspected)} inspected projects`,
      };
    }
    case "repo_graveyard":
      return {
        text: `${String(diagnostics.abandonedSubstantialRepositories)} larger projects have gone quiet for a year.`,
        receiptText: `Project upkeep — ${String(diagnostics.abandonedSubstantialRepositories)} larger projects quiet for a year`,
      };
    case "single_point_of_aura": {
      const share = Math.round(diagnostics.dominantRepositoryShare * 100);
      return {
        text: `One repository carries ${String(share)}% of the public code signal.`,
        receiptText: `Project concentration — one repository carries ${String(share)}% of the public code signal`,
      };
    }
  }
  return null;
};

const receiptFact = (receipt: ClaimSupportReceipt, profile: ProfileScorecard): string => {
  const label =
    receipt.metric === undefined
      ? compactReceiptLabel(receipt.label)
      : (PAIRED_SIGNAL_LABELS[receipt.metric] ?? compactReceiptLabel(receipt.label));
  if (receipt.metric === undefined || receipt.value === undefined) return label;
  return `${label} ${pairedSignalValue(receipt.metric, receipt.value, profile)}`;
};

const sentence = (value: string): string => (/[.!?]$/u.test(value) ? value : `${value}.`);

const plainEvidenceText = (item: EvidenceItem, profile: ProfileScorecard): string => {
  if (item.metric === "craft.testing.breadth" && typeof item.value === "number") {
    return item.value <= 1
      ? `Tests: ${testBreadthValue(item.value)} in inspected trees.`
      : "Tests outnumber source files in inspected trees.";
  }
  if (item.metric === "craft.testing.exists" && item.value !== undefined) {
    return `Automated tests appear in ${String(item.value).replace("/", " of ")} inspected projects.`;
  }
  if (item.metric === "ship.breadth.released") {
    return `${String(profile.diagnostics.releaseCount)} versioned releases.`;
  }
  if (item.metric === "ship.frequency.activeWeeks") {
    return `Active in ${String(profile.diagnostics.activeWeeksObserved)} of ${String(profile.diagnostics.activeWeeksWindow)} recent weeks.`;
  }
  if (item.metric === "ship.frequency.recency") {
    const days = profile.diagnostics.daysSinceLastPublicPush;
    return days === null
      ? "Recent public activity is unavailable."
      : days === 0
        ? "Updated publicly today."
        : `${String(days)} days since the last public update.`;
  }
  if (item.metric === "craft.tooling.automation" && item.value !== undefined) {
    return `Project automation appears in ${String(item.value).replace("/", " of ")} inspected projects.`;
  }
  return sentence(compactEvidenceTitle(item));
};

const renderReadEntry = (
  handle: string,
  strength: string,
  weakness: string | null,
  marker: number,
  width: number,
  palette: Palette,
): readonly string[] => {
  const prefix = `@${terminalSafe(handle)} —`;
  const markerSuffix = ` [${String(marker)}]`;
  const plain = `${prefix} ${strength}${weakness === null ? "" : ` ${weakness}`}${markerSuffix}`;
  if (plainLength(plain) <= width) {
    return [
      `${palette.wrap("cyan", prefix)} ${palette.wrap("green", strength)}${
        weakness === null ? "" : ` ${palette.wrap("red", weakness)}`
      } ${markerText(marker, palette)}`,
    ];
  }
  const strengthLines = wrapPlain(strength, width, `${prefix} `).map((line, index) => {
    const linePrefix = index === 0 ? `${prefix} ` : " ".repeat(plainLength(prefix) + 1);
    const text = line.slice(linePrefix.length);
    return `${index === 0 ? `${palette.wrap("cyan", prefix)} ` : linePrefix}${palette.wrap("green", text)}`;
  });
  if (weakness === null) {
    const last = strengthLines.length - 1;
    strengthLines[last] = `${strengthLines[last] as string} ${markerText(marker, palette)}`;
    return strengthLines;
  }
  const weaknessLines = wrapPlain(`${weakness}${markerSuffix}`, width, "  ").map((line) => {
    const markerToken = `[${String(marker)}]`;
    const hasMarker = line.includes(markerToken);
    const text = line.slice(2).replace(markerToken, "").trim();
    return `  ${text === "" ? "" : palette.wrap("red", text)}${hasMarker ? `${text === "" ? "" : " "}${markerText(marker, palette)}` : ""}`;
  });
  return [...strengthLines, ...weaknessLines];
};

const renderPlayers = (
  battle: BattleResult,
  source: SourceAnalysisResult,
  story: StoryResult,
  registry: MarkerRegistry,
  width: number,
  palette: Palette,
  detailed: boolean,
): string[] => {
  const lines: string[] = [];
  for (const side of ["left", "right"] as const) {
    const profile = battle[side];
    const originalStrength = battle.strengths[side];
    const originalStrengthSupport = supportForLine(originalStrength, battle, [side]);
    const fallbackStrength = profile.positiveEvidence[0];
    const strength = detailed
      ? originalStrengthSupport !== null && accessibleHumanCopy(originalStrength.text)
        ? { text: originalStrength.text, support: originalStrengthSupport }
        : fallbackStrength === undefined
          ? null
          : {
              text: plainEvidenceText(fallbackStrength, profile),
              support: [evidenceReceipt(side, fallbackStrength)],
            }
      : fallbackStrength === undefined
        ? null
        : {
            text: plainEvidenceText(fallbackStrength, profile),
            support: [evidenceReceipt(side, fallbackStrength)],
          };
    const auraSupport = supportedAura(battle, side);
    const auraWeakness = auraSupport === null ? null : plainAuraWeakness(profile);
    const originalWeakness = battle.weaknesses[side];
    const originalWeaknessSupport =
      originalWeakness === null ? null : supportForLine(originalWeakness, battle, [side]);
    const weakness =
      auraWeakness !== null && auraSupport !== null
        ? { ...auraWeakness, support: auraSupport }
        : originalWeakness !== null &&
            originalWeaknessSupport !== null &&
            accessibleHumanCopy(originalWeakness.text)
          ? {
              text: originalWeakness.text,
              receiptText: receiptFact(originalWeaknessSupport[0] as ClaimSupportReceipt, profile),
              support: originalWeaknessSupport,
            }
          : null;
    if (strength === null) continue;
    const playerSupport = [...strength.support, ...(weakness?.support ?? [])];
    const summaryParts = [
      receiptFact(strength.support[0] as ClaimSupportReceipt, profile),
      ...(weakness === null ? [] : [weakness.receiptText]),
    ];
    const marker = registry.add(
      playerSupport,
      `@${terminalSafe(profile.username)} — ${summaryParts.join("; ")}`,
    );
    if (marker === null) continue;

    if (!detailed) {
      lines.push(
        ...renderReadEntry(
          profile.username,
          terminalSafe(strength.text),
          weakness?.text ?? null,
          marker,
          width,
          palette,
        ),
      );
      continue;
    }

    lines.push(
      ...claimLines(
        `@${terminalSafe(profile.username)} — `,
        "PUBLIC EVIDENCE",
        marker,
        width,
        palette,
      ),
      ...claimLines("+ ", strength.text, null, width, palette, "green"),
      ...(weakness === null ? [] : claimLines("− ", weakness.text, null, width, palette, "red")),
    );

    const sourceRead = side === "left" ? story.leftRead : story.rightRead;
    if (sourceRead !== null && accessibleHumanCopy(sourceRead.text)) {
      const resolved = resolveClaimSupport(sourceRead, battle, source);
      if (resolved !== null) {
        lines.push(
          ...claimLines(
            "  Read: ",
            sourceRead.text,
            registry.add(
              resolved.receipts,
              `@${profile.username} authored source read — ${compactEvidenceSummary(resolved.receipts)}`,
            ),
            width,
            palette,
          ),
        );
      }
    }
  }
  return lines.length === 0 ? [] : [section("THE READ", palette), ...lines];
};

const renderCodeDna = (
  battle: BattleResult,
  source: SourceAnalysisResult,
  width: number,
  palette: Palette,
  detailed: boolean,
): string[] => {
  const status =
    source.status === "partial" && !detailed ? "LIMITED" : overallCodeDnaStatusLabel(source.status);
  const statusStyle: PaletteKey = source.status === "ready" ? "green" : "yellow";
  const lines = [
    `${section("SOURCE ANALYSIS", palette)} · ${palette.wrap(statusStyle, status)}`,
    ...wrapPlain(
      detailed
        ? `@${terminalSafe(battle.left.username)} ${sourceStatsText(source.left.codeDna)} · @${terminalSafe(battle.right.username)} ${sourceStatsText(source.right.codeDna)}`
        : `${sourceStatsCompact(source.left.codeDna)} ↔ ${sourceStatsCompact(source.right.codeDna)} · axes: --details`,
      width,
      "  ",
    ),
  ];
  if (!detailed) return lines;
  if (source.status !== "ready") {
    const limitation =
      source.status === "partial"
        ? "Source-style findings describe only the files sampled; exact collection limits follow."
        : "The available code sample did not support a source-style finding.";
    lines.push(...wrapStyledPrefix("! ", limitation, width, palette, "yellow"));
  }

  lines.push("");
  for (const axis of CODE_AXIS_IDS) {
    lines.push(
      ...wrapPlain(
        `${axisLabel[axis]} · @${terminalSafe(battle.left.username)} ${axisReading(source.left.codeDna, axis)} · @${terminalSafe(battle.right.username)} ${axisReading(source.right.codeDna, axis)}`,
        width,
        "  ",
      ),
    );
  }
  for (const side of ["left", "right"] as const) {
    const reading = source[side].codeDna;
    for (const limitation of reading.limitations.slice(0, 3)) {
      lines.push(
        ...wrapPlain(
          `@${terminalSafe(battle[side].username)} limit: ${terminalSafe(limitation)}`,
          width,
          "  ",
        ),
      );
    }
    if ("sourceFailureReasons" in reading && reading.sourceFailureReasons.length > 0) {
      lines.push(
        ...wrapPlain(
          `@${terminalSafe(battle[side].username)} sample diagnostics: ${reading.sourceFailureReasons.join(", ")}`,
          width,
          "  ",
        ),
      );
    }
  }
  lines.push(
    ...wrapPlain(
      `Requests: ${String(source.requestBudget.total)}/${String(source.requestBudget.cap)}`,
      width,
      "  ",
    ),
  );
  return lines;
};

const compressReferences = (values: readonly string[]): string => {
  const unique = [...new Set(values)];
  const groups = new Map<string, { profile: boolean; repositories: string[] }>();
  for (const value of unique) {
    const [owner, repository] = value.split("/", 2);
    if (owner === undefined || owner === "") continue;
    const group = groups.get(owner) ?? { profile: false, repositories: [] };
    if (repository === undefined || repository === "") group.profile = true;
    else group.repositories.push(repository);
    groups.set(owner, group);
  }
  return [...groups.entries()]
    .map(([owner, group]) => {
      const repositoryText =
        group.repositories.length === 0
          ? ""
          : group.repositories.length === 1
            ? `${owner}/${group.repositories[0]}`
            : `${owner}/{${group.repositories.join(",")}}`;
      return group.profile && group.repositories.length > 0
        ? `${owner} (profile + ${group.repositories.join(", ")})`
        : group.profile
          ? `github.com/${owner}`
          : repositoryText;
    })
    .filter((value) => value !== "")
    .join(", ");
};

const compactEvidenceSummary = (receipts: readonly ClaimSupportReceipt[]): string => {
  const left = compressReferences(
    receipts.filter((receipt) => receipt.side === "left").map((receipt) => receipt.reference),
  );
  const right = compressReferences(
    receipts.filter((receipt) => receipt.side === "right").map((receipt) => receipt.reference),
  );
  if (left !== "" && right === "") return `Source: ${left}`;
  if (right !== "" && left === "") return `Source: ${right}`;
  return `${left} ↔ ${right}`;
};

const languageMix = (profile: ProfileScorecard): string => {
  const languages = profile.diagnostics.substantialLanguages;
  if (languages.length === 0) return "no established project language";
  if (languages.length === 1) return `${terminalSafe(languages[0] as string)} only`;
  return `${String(languages.length)} project languages (${languages.map(terminalSafe).join(", ")})`;
};

const claimEvidenceSummary = (
  line: MemeLine,
  receipts: readonly ClaimSupportReceipt[],
  battle: BattleResult,
): string => {
  if (line.atomId === "polyglot_with_depth") {
    return `Language mix — ${languageMix(battle.left)} vs ${languageMix(battle.right)}`;
  }
  const sharedMetric = receipts.find(
    (receipt) =>
      receipt.side === "left" &&
      receipt.metric !== undefined &&
      receipt.value !== undefined &&
      receipts.some(
        (candidate) =>
          candidate.side === "right" &&
          candidate.metric === receipt.metric &&
          candidate.value !== undefined,
      ),
  )?.metric;
  if (sharedMetric !== undefined) {
    const left = receipts.find(
      (receipt) => receipt.side === "left" && receipt.metric === sharedMetric,
    );
    const right = receipts.find(
      (receipt) => receipt.side === "right" && receipt.metric === sharedMetric,
    );
    if (left?.value !== undefined && right?.value !== undefined) {
      const label = PAIRED_SIGNAL_LABELS[sharedMetric] ?? compactReceiptLabel(left.label);
      return `${label} — ${pairedSignalValue(sharedMetric, left.value, battle.left)} vs ${pairedSignalValue(sharedMetric, right.value, battle.right)}`;
    }
  }

  const facts = (["left", "right"] as const).flatMap((side) => {
    const receipt = receipts.find((candidate) => candidate.side === side);
    if (receipt === undefined) return [];
    const fact =
      receipt.metric !== undefined && receipt.value !== undefined
        ? `${PAIRED_SIGNAL_LABELS[receipt.metric] ?? compactReceiptLabel(receipt.label)} ${pairedSignalValue(receipt.metric, receipt.value, battle[side])}`
        : compactReceiptLabel(receipt.label);
    return [`@${terminalSafe(battle[side].username)}: ${fact}`];
  });
  return facts.join(" · ");
};

const renderNumberedEvidence = (
  registry: MarkerRegistry,
  width: number,
  palette: Palette,
): string[] => {
  if (registry.entries.length === 0) return [];
  const lines = [section("RECEIPTS", palette)];
  for (const entry of registry.entries) {
    lines.push(
      ...wrapStyledPrefix(`[${String(entry.marker)}] `, entry.summary, width, palette, "dim"),
    );
  }
  return lines;
};

const renderBattleRawReceipts = (
  battle: BattleResult,
  source: SourceAnalysisResult,
  story: StoryResult,
  width: number,
  palette: Palette,
): string[] => {
  const lines: string[] = [];
  const evidence = (["left", "right"] as const).flatMap((side) =>
    battle[side].evidence.map((item) => ({ side, item })),
  );
  if (evidence.length > 0) {
    lines.push(section("RAW RECEIPTS", palette));
    for (const { side, item } of evidence) {
      lines.push(
        ...wrapPlain(
          `@${terminalSafe(battle[side].username)} [${terminalSafe(item.id)}] ${terminalSafe(item.detail)}`,
          width,
          "  ",
        ),
        ...wrapStyledPrefix("    ", terminalSafe(item.sourceUrl), width, palette, "dim"),
      );
    }
  }
  const samples = (["left", "right"] as const).flatMap((side) =>
    source[side].samples.map((sample) => ({ side, sample })),
  );
  if (samples.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(section("SOURCE SAMPLES", palette));
    for (const { side, sample } of samples) {
      lines.push(
        ...wrapPlain(
          `@${terminalSafe(battle[side].username)} [${terminalSafe(sample.sampleId)}] ${terminalSafe(sample.repository)}:${terminalSafe(sample.path)}`,
          width,
          "  ",
        ),
        ...wrapStyledPrefix("    ", terminalSafe(sample.sourceUrl), width, palette, "dim"),
      );
    }
  }
  if (lines.length > 0) lines.push("");
  lines.push(
    section("VERSIONS", palette),
    `  Score: ${terminalSafe(battle.scoringVersion)}`,
    `  Presentation: ${terminalSafe(battle.presentationVersion)}`,
    `  Source analysis: ${terminalSafe(source.version)}`,
    `  Story: ${terminalSafe(story.version)}`,
    ...wrapPlain(`Analysis key: ${terminalSafe(source.analysisKey)}`, width, "  "),
  );
  return lines;
};

const renderActions = (
  battle: BattleResult,
  width: number,
  detailed: boolean,
  receipts: boolean,
  palette: Palette,
): string[] => {
  const utilities = [
    ...(detailed ? [] : ["--details"]),
    ...(receipts ? [] : ["--receipts"]),
    "--share x",
  ].join(" · ");
  const champion = winnerHandle(battle) ?? battle.left.username;
  const loser = champion === battle.left.username ? battle.right.username : battle.left.username;
  const roastFlag = battle.roast === "spicy" ? "" : ` --roast ${battle.roast}`;
  return [
    ...wrapPlain(`More: ${utilities}`, width),
    ...wrapPlain(
      `Rematch: gitmog ${terminalSafe(champion)} ${terminalSafe(loser)}${roastFlag}`,
      width,
    ),
    ...wrapPlain(`Next: gitmog ${terminalSafe(champion)} <handle>${roastFlag}`, width),
  ].map((line) => palette.wrap("dim", line));
};

const joinBlocks = (blocks: readonly (readonly string[])[]): string => {
  const populated = blocks.filter((block) => block.length > 0);
  return `${populated.flatMap((block, index) => (index === 0 ? block : ["", ...block])).join("\n")}\n`;
};

export function renderBattle(
  battle: BattleResult,
  source: SourceAnalysisResult,
  story: StoryResult,
  options: RenderOptions = {},
): string {
  const palette = options.palette ?? PLAIN_PALETTE;
  const width = clampColumns(options.columns);
  const detailed = options.details === true || options.receipts === true;
  const presentation = derivePresentationVerdict(battle, source);
  const registry = createMarkerRegistry();
  const primaryCandidates = [battle.finishingMove, battle.narrative.matchupLine]
    .map((line) => ({ line, support: supportForLine(line, battle) }))
    .filter((candidate) => candidate.support !== null && accessibleHumanCopy(candidate.line.text));
  const primaryClaim =
    primaryCandidates.find((candidate) => plainLength(`» ${candidate.line.text} [1]`) <= width) ??
    primaryCandidates[0];
  const primary =
    primaryClaim?.support === null || primaryClaim === undefined
      ? []
      : claimLines(
          "» ",
          primaryClaim.line.text,
          registry.add(
            primaryClaim.support,
            claimEvidenceSummary(primaryClaim.line, primaryClaim.support, battle),
          ),
          width,
          palette,
        );
  const rounds = renderRounds(battle, registry, width, palette, detailed);
  const players = renderPlayers(battle, source, story, registry, width, palette, detailed);
  const codeDna = detailed ? renderCodeDna(battle, source, width, palette, true) : [];
  const evidence = renderNumberedEvidence(registry, width, palette);
  const actions = renderActions(battle, width, detailed, options.receipts === true, palette);
  const quality =
    options.qualityPreview !== undefined && isQualityPair(options.qualityPreview)
      ? options.qualityPreview
      : null;
  const qualityBlock =
    quality === null ? [] : renderQualityPair(battle, quality, width, palette, detailed);
  const qualityReceipts =
    quality === null || !detailed
      ? []
      : renderQualityReceipts(
          [
            { prefix: "L", result: quality.left },
            { prefix: "R", result: quality.right },
          ],
          width,
          palette,
          options.receipts === true,
        );
  return joinBlocks([
    renderHeader(battle, presentation, width, palette, detailed),
    primary,
    rounds,
    players,
    qualityBlock,
    codeDna,
    ...(detailed ? [evidence] : []),
    qualityReceipts,
    ...(options.receipts === true
      ? [renderBattleRawReceipts(battle, source, story, width, palette)]
      : []),
    detailed ? actions : [...evidence, ...actions],
  ]);
}

const profileEvidenceSupport = (
  profile: ProfileScorecard,
  ids: readonly string[],
): readonly ClaimSupportReceipt[] | null => {
  if (ids.length === 0) return null;
  const items = ids.map((id) => profile.evidence.find((item) => item.id === id));
  if (items.some((item) => item === undefined)) return null;
  return items.map((item) => evidenceReceipt("left", item as EvidenceItem));
};

const renderProfileCodeDna = (
  source: CodeDnaOutcome,
  width: number,
  palette: Palette,
  detailed: boolean,
): string[] => {
  const status =
    source.status === "partial" && !detailed ? "LIMITED" : codeDnaStatusLabel(source.status);
  const lines = [
    `${section("SOURCE ANALYSIS", palette)} · ${palette.wrap(codeDnaStatusStyle(source.status), status)}`,
    ...wrapPlain(
      detailed ? sourceStatsText(source) : `${sourceStatsCompact(source)} · axes: --details`,
      width,
      "  ",
    ),
  ];
  if (!detailed) return lines;
  if (source.status !== "ready") {
    const limitation =
      source.status === "partial"
        ? "Source-style findings describe only the files sampled; exact collection limits follow."
        : "The available code sample did not support a source-style finding.";
    lines.push(...wrapStyledPrefix("! ", limitation, width, palette, "yellow"));
  }
  lines.push("");
  for (const axis of CODE_AXIS_IDS) {
    lines.push(...wrapPlain(`${axisLabel[axis]} · ${axisReading(source, axis)}`, width, "  "));
  }
  for (const limitation of source.limitations.slice(0, 3)) {
    lines.push(...wrapPlain(`Limit: ${terminalSafe(limitation)}`, width, "  "));
  }
  if ("sourceFailureReasons" in source && source.sourceFailureReasons.length > 0) {
    lines.push(
      ...wrapPlain(`Sample diagnostics: ${source.sourceFailureReasons.join(", ")}`, width, "  "),
    );
  }
  return lines;
};

const renderProfileRawReceipts = (
  profile: ProfileScorecard,
  source: CodeDnaOutcome,
  width: number,
  palette: Palette,
): string[] => {
  const lines: string[] = [];
  if (profile.evidence.length > 0) {
    lines.push(section("RAW RECEIPTS", palette));
    for (const item of profile.evidence) {
      lines.push(
        ...wrapPlain(`[${terminalSafe(item.id)}] ${terminalSafe(item.detail)}`, width, "  "),
        ...wrapStyledPrefix("    ", terminalSafe(item.sourceUrl), width, palette, "dim"),
      );
    }
  }
  if (source.samples.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(section("SOURCE SAMPLES", palette));
    for (const sample of source.samples) {
      lines.push(
        ...wrapPlain(
          `[${terminalSafe(sample.sampleId)}] ${terminalSafe(sample.repository)}:${terminalSafe(sample.path)}`,
          width,
          "  ",
        ),
        ...wrapStyledPrefix("    ", terminalSafe(sample.sourceUrl), width, palette, "dim"),
      );
    }
  }
  return lines;
};

export function renderProfile(
  profile: ProfileScorecard,
  source: CodeDnaOutcome,
  options: RenderOptions = {},
): string {
  const palette = options.palette ?? PLAIN_PALETTE;
  const width = clampColumns(options.columns);
  const detailed = options.details === true || options.receipts === true;
  const registry = createMarkerRegistry();
  const auraSupport =
    profile.auraLeak === null
      ? null
      : profileEvidenceSupport(profile, profile.auraLeak.evidenceIds);
  const auraWeakness = auraSupport === null ? null : plainAuraWeakness(profile);
  const defaultStrength = profile.positiveEvidence[0];
  const defaultNegative = profile.negativeEvidence[0];
  const defaultWeakness =
    auraWeakness !== null && auraSupport !== null
      ? { text: auraWeakness.text, receiptText: auraWeakness.receiptText, support: auraSupport }
      : defaultNegative === undefined
        ? null
        : {
            text: sentence(compactEvidenceTitle(defaultNegative)),
            receiptText: receiptFact(evidenceReceipt("left", defaultNegative), profile),
            support: [evidenceReceipt("left", defaultNegative)],
          };
  const profileRead = (() => {
    if (!detailed) {
      if (defaultStrength === undefined) return [];
      const strengthSupport = evidenceReceipt("left", defaultStrength);
      const blockSupport = [strengthSupport, ...(defaultWeakness?.support ?? [])];
      const marker = registry.add(
        blockSupport,
        `@${terminalSafe(profile.username)} — ${[
          receiptFact(strengthSupport, profile),
          ...(defaultWeakness === null ? [] : [defaultWeakness.receiptText]),
        ].join("; ")}`,
      );
      return marker === null
        ? []
        : renderReadEntry(
            profile.username,
            plainEvidenceText(defaultStrength, profile),
            defaultWeakness?.text ?? null,
            marker,
            width,
            palette,
          );
    }

    return [
      ...profile.positiveEvidence.flatMap((item) =>
        claimLines(
          "+ ",
          item.detail,
          registry.add(
            [evidenceReceipt("left", item)],
            `${compactEvidenceTitle(item)} — ${evidenceReceipt("left", item).reference}`,
          ),
          width,
          palette,
          "green",
        ),
      ),
      ...profile.negativeEvidence.flatMap((item) =>
        claimLines(
          "− ",
          item.detail,
          registry.add(
            [evidenceReceipt("left", item)],
            `${compactEvidenceTitle(item)} — ${evidenceReceipt("left", item).reference}`,
          ),
          width,
          palette,
          "red",
        ),
      ),
      ...(auraWeakness === null || auraSupport === null
        ? []
        : claimLines(
            "− ",
            auraWeakness.text,
            registry.add(auraSupport, auraWeakness.receiptText),
            width,
            palette,
            "red",
          )),
    ];
  })();
  const header = [
    section("GIT MOG", palette),
    palette.wrap("cyan", `@${terminalSafe(profile.username)}`),
    `Score: ${palette.wrap("white", String(profile.overallScore))}`,
    palette.wrap("dim", `Coverage: ${String(profile.confidence.measuredWeight)}%`),
  ];
  const actionOptions = [
    ...(detailed ? [] : ["--details"]),
    ...(options.receipts === true ? [] : ["--receipts"]),
  ].join(" · ");
  const actions = [
    ...(actionOptions === "" ? [] : wrapPlain(`More: ${actionOptions}`, width)),
    ...wrapPlain(`Next: gitmog ${terminalSafe(profile.username)} <handle>`, width),
  ].map((line) => palette.wrap("dim", line));
  const evidence = renderNumberedEvidence(registry, width, palette);
  const quality =
    options.qualityPreview !== undefined && !isQualityPair(options.qualityPreview)
      ? options.qualityPreview
      : null;
  return joinBlocks([
    header,
    profileRead.length === 0 ? [] : [section("THE READ", palette), ...profileRead],
    ...(quality === null
      ? []
      : [renderQualityProfile(profile.username, quality, width, palette, detailed)]),
    ...(detailed ? [renderProfileCodeDna(source, width, palette, true)] : []),
    ...(detailed ? [evidence] : []),
    ...(quality === null || !detailed
      ? []
      : [
          renderQualityReceipts(
            [{ prefix: "P", result: quality }],
            width,
            palette,
            options.receipts === true,
          ),
        ]),
    ...(options.receipts === true
      ? [renderProfileRawReceipts(profile, source, width, palette)]
      : []),
    detailed ? actions : [...evidence, ...actions],
  ]);
}

const cardRows = (value: string, width: number): readonly string[] => {
  const inner = width - 4;
  return wrapPlain(value, inner).map((line) => `│ ${padPlain(line, inner)} │`);
};

export function renderCard(
  battle: BattleResult,
  source: SourceAnalysisResult,
  story: StoryResult,
  options: RenderOptions = {},
): string {
  const width = Math.min(74, Math.max(56, clampColumns(options.columns)));
  const presentation = derivePresentationVerdict(battle, source);
  const winner = winnerHandle(battle);
  const result =
    winner === null
      ? `◆ TIE · ${terminalSafe(presentation.label)}`
      : `◆ @${terminalSafe(winner)} WINS · ${terminalSafe(presentation.label)}`;
  const storySupport = resolveClaimSupport(story.finisher, battle, source);
  const memeClaim = [battle.finishingMove, battle.narrative.matchupLine]
    .map((line) => ({ line, support: supportForLine(line, battle) }))
    .find((candidate) => candidate.support !== null && accessibleHumanCopy(candidate.line.text));
  const supportedStoryClaim =
    storySupport !== null && accessibleHumanCopy(storySupport.claim.text) ? storySupport : null;
  const support = supportedStoryClaim?.receipts ?? memeClaim?.support ?? null;
  const claimText = supportedStoryClaim?.claim.text ?? memeClaim?.line.text ?? "";
  const registry = createMarkerRegistry();
  const marker = registry.add(
    support,
    supportedStoryClaim !== null
      ? `Source comparison — ${compactEvidenceSummary(supportedStoryClaim.receipts)}`
      : memeClaim?.support === null || memeClaim === undefined
        ? ""
        : claimEvidenceSummary(memeClaim.line, memeClaim.support, battle),
  );
  const claim =
    support === null || marker === null || !accessibleHumanCopy(claimText)
      ? []
      : cardRows(`» ${terminalSafe(claimText)} [${String(marker)}]`, width);
  const evidence = registry.entries.flatMap((entry) =>
    cardRows(`[${String(entry.marker)}] ${entry.summary}`, width),
  );
  const border = `┌${"─".repeat(width - 2)}┐`;
  const close = `└${"─".repeat(width - 2)}┘`;
  const divider = `├${"─".repeat(width - 2)}┤`;
  const quality =
    options.qualityPreview !== undefined && isQualityPair(options.qualityPreview)
      ? options.qualityPreview
      : null;
  const qualityLine =
    quality !== null &&
    quality.left.maintainedCodebase.previewScore !== null &&
    quality.right.maintainedCodebase.previewScore !== null
      ? `PREVIEW · code quality ${String(quality.left.maintainedCodebase.previewScore)}–${String(quality.right.maintainedCodebase.previewScore)} · not used in winner`
      : null;
  return [
    "",
    border,
    ...cardRows("GIT MOG", width),
    ...cardRows(result, width),
    ...cardRows(
      `@${terminalSafe(battle.left.username)} SCORE ${String(battle.left.overallScore)} · COVERAGE ${String(battle.left.confidence.measuredWeight)}% · @${terminalSafe(battle.right.username)} SCORE ${String(battle.right.overallScore)} · COVERAGE ${String(battle.right.confidence.measuredWeight)}%`,
      width,
    ),
    ...(qualityLine === null ? [] : cardRows(qualityLine, width)),
    ...(claim.length === 0 ? [] : [divider, ...claim, ...evidence]),
    close,
    "",
    `  ${terminalSafe(battle.challenge.canonical)}`,
    "",
  ].join("\n");
}

export interface RenderErrorOptions {
  readonly handles?: readonly string[] | undefined;
  readonly columns?: number | undefined;
  readonly invokedAs?: string | undefined;
  readonly timeZone?: string | undefined;
}

const errorSubject = (error: BattleError, handles: readonly string[]): string => {
  if (handles.length >= 2) {
    return `@${terminalSafe(handles[0] as string)} vs @${terminalSafe(handles[1] as string)}`;
  }
  const handle = handles[0] ?? error.handle;
  return handle === undefined ? "this command" : `@${terminalSafe(handle)}`;
};

const resetTime = (value: string | undefined, timeZone?: string): string | null => {
  if (value === undefined) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "long",
    ...(timeZone === undefined ? {} : { timeZone }),
  });
};

export function renderError(error: BattleError, options: RenderErrorOptions = {}): string {
  const { headline, body } = presentBattleError(error);
  const handles = options.handles ?? [];
  const subject = errorSubject(error, handles);
  const width = clampColumns(options.columns);
  let explanation = body;
  let action: string | null = null;

  if (error.code === "invalid_handle" || error.code === "same_handle") {
    explanation = error.message;
    action = `Run: ${options.invokedAs ?? "gitmog"} --help`;
  } else if (error.code === "not_found") {
    explanation =
      handles.length >= 2 && error.handle !== undefined
        ? `Could not find @${terminalSafe(error.handle)} while collecting ${subject}.`
        : `Could not find ${subject} on GitHub.`;
    action = "Check the handle and retry.";
  } else if (error.code === "suspended") {
    explanation = `Could not collect public data for ${subject} because GitHub marks the profile unavailable.`;
    action = "Check the handle and retry.";
  } else if (error.code === "rate_limited") {
    explanation =
      error.rateLimitClass === "secondary"
        ? `GitHub temporarily slowed the request for ${subject}.`
        : `GitHub's current limit could not finish ${subject}.`;
    const reset = resetTime(error.resetAt, options.timeZone);
    const command = `${options.invokedAs ?? "gitmog"} ${handles.join(" ") || "<username>"}`;
    const retry =
      error.rateLimitClass === "secondary" && error.retryAfterSeconds !== undefined
        ? `Retry in ${String(error.retryAfterSeconds)} seconds: ${command}`
        : reset !== null
          ? `Retry after ${reset}: ${command}`
          : `Retry later: ${command}`;
    action = `${retry}. Or sign in once: ${options.invokedAs ?? "gitmog"} --sign-in ${
      handles.join(" ") || "<username>"
    }`;
  } else if (error.code === "timeout") {
    explanation = `Could not finish ${subject}.`;
    action = handles.length >= 2 ? "Retry the battle." : "Retry the profile.";
  } else if (
    error.code === "network_error" ||
    error.code === "malformed_response" ||
    error.code === "upstream_error"
  ) {
    explanation = `Could not collect public GitHub data for ${subject}.`;
    action = handles.length >= 2 ? "Retry the battle." : "Retry the profile.";
  } else if (error.code === "insufficient_evidence") {
    explanation = `Could not collect enough public data for ${subject}.`;
    action = "Try another public handle.";
  } else if (error.code === "internal_error") {
    explanation = `Git Mog could not complete ${subject}.`;
    action = "Retry the command.";
  }

  return [
    terminalSafe(headline),
    "",
    ...wrapPlain(explanation, width),
    ...(action === null ? [] : wrapPlain(action, width)),
    "",
  ].join("\n");
}

export const cardFor = (battle: BattleResult, side: Side): ProfileScorecard => battle[side];
