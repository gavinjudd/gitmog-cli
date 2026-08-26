import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, parse, posix, relative, sep, win32 } from "node:path";

import type { SourceAnalysisResult, StoryResult } from "@gitmog/source-analysis";
import { mixedPrivateArtifactIsSafe, type PrivateContextResult } from "@gitmog/private-context";
import type { QualityJudgePair, QualityReading } from "@gitmog/quality-judge";
import type { BattleResult, BattleRound, EvidenceItem, Side } from "@gitmog/scoring";

import { derivePresentationVerdict, type PresentationVerdict } from "./presentation-verdict.js";
import { privateQualitySampleText, privateRelationshipText } from "./private-presentation.js";
import { terminalSafe } from "./terminal-safe.js";

export const EXPORT_SCHEMA_VERSION = "1.0.0-self-contained";
export const MAX_EXPORT_BYTES = 96 * 1024;

export type BattleExportFormat = "html" | "svg";

export interface ExportDestination {
  readonly path: string;
  readonly format: BattleExportFormat;
}

export interface BattleExportMetadata extends ExportDestination {
  readonly schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  readonly bytes: number;
  readonly sha256: string;
}

export type ExportResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

interface ExportDocument {
  readonly title: string;
  readonly leftHandle: string;
  readonly rightHandle: string;
  readonly winner: string;
  readonly leftScore: number;
  readonly rightScore: number;
  readonly leftCoverage: number;
  readonly rightCoverage: number;
  readonly presentation: PresentationVerdict;
  readonly comparisons: readonly string[];
  readonly leftRead: string;
  readonly rightRead: string;
  readonly receipts: readonly string[];
  readonly version: string;
  readonly rematch: string;
  readonly limitation: string;
  readonly quality: {
    readonly leftMaintained: string;
    readonly rightMaintained: string;
    readonly leftAttributed: string;
    readonly rightAttributed: string;
    readonly sharedLimitation: string | null;
  } | null;
  readonly privateContext: {
    readonly subject: string;
    readonly analyzedRepositories: number;
    readonly maintainedRepositories: number;
    readonly attributableRepositories: number;
    readonly relationship: string;
    readonly summary: readonly string[];
  } | null;
}

export interface RenderBattleExportInput {
  readonly battle: BattleResult;
  readonly source: SourceAnalysisResult;
  readonly story: StoryResult;
  readonly version: string;
  readonly format: BattleExportFormat;
  readonly qualityPreview?: QualityJudgePair | undefined;
  readonly privateContext?: PrivateContextResult | undefined;
}

export interface WriteBattleExportInput extends RenderBattleExportInput {
  readonly destination: string;
  readonly cwd?: string | undefined;
  /** Test boundary for a filesystem that refuses atomic-file reservation. */
  readonly reserve?: ((temporaryPath: string) => number) | undefined;
  /** Test boundary for an interrupted final atomic commit. */
  readonly commit?: ((temporaryPath: string, destinationPath: string) => void) | undefined;
}

let temporarySequence = 0;

const escapeMarkup = (value: string): string =>
  terminalSafe(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const roundLabel = (round: BattleRound): string =>
  terminalSafe(round.subtitle === "" ? round.memeLabel : round.subtitle).toUpperCase();

const roundComparison = (round: BattleRound, battle: BattleResult): string => {
  const left = round.leftScore === null ? "not measured" : String(round.leftScore);
  const right = round.rightScore === null ? "not measured" : String(round.rightScore);
  const outcome =
    round.winner === "tie" || round.winner === "unscored"
      ? round.winner === "tie"
        ? "tie"
        : "not scored"
      : `@${terminalSafe(battle[round.winner].username)} leads`;
  return `${roundLabel(round)} · ${left}–${right} · ${outcome}`;
};

const decisiveRounds = (battle: BattleResult): readonly BattleRound[] =>
  battle.rounds
    .filter((round) => round.leftScore !== null || round.rightScore !== null)
    .map((round, index) => ({ round, index }))
    .toSorted((left, right) => right.round.margin - left.round.margin || left.index - right.index)
    .slice(0, 3)
    .map(({ round }) => round);

const evidenceFor = (battle: BattleResult, side: Side, id: string | null): EvidenceItem | null =>
  id === null ? null : (battle[side].evidence.find((entry) => entry.id === id) ?? null);

const exportReceipts = (
  battle: BattleResult,
  rounds: readonly BattleRound[],
): readonly string[] => {
  const selected = new Map<string, string>();
  const factKeys = new Set<string>();
  const visibleTexts = new Set<string>();
  const add = (side: Side, evidence: EvidenceItem | null): void => {
    if (evidence === null) return;
    const text = `@${terminalSafe(battle[side].username)} · ${terminalSafe(evidence.title)} — ${terminalSafe(evidence.detail)}`;
    const factKey = JSON.stringify({
      side,
      category: evidence.category,
      metric: evidence.metric,
      value: evidence.value ?? null,
      repository: evidence.repository ?? null,
      sourceUrl: evidence.sourceUrl,
      detail: evidence.detail,
    });
    if (factKeys.has(factKey) || visibleTexts.has(text)) return;
    factKeys.add(factKey);
    visibleTexts.add(text);
    selected.set(`${side}:${evidence.id}`, text);
  };
  for (const round of rounds) {
    add("left", evidenceFor(battle, "left", round.leftEvidenceId));
    add("right", evidenceFor(battle, "right", round.rightEvidenceId));
  }
  for (const side of ["left", "right"] as const) {
    for (const evidence of battle[side].evidence) add(side, evidence);
  }
  const receipts = [...selected.values()].slice(0, 6);
  for (const side of ["left", "right"] as const) {
    if (receipts.length >= 4) break;
    const profile = battle[side];
    receipts.push(
      `@${terminalSafe(profile.username)} · Public scorecard coverage ${String(profile.confidence.measuredWeight)}% across ${String(profile.confidence.analyzedRepositories)} inspected repositories.`,
    );
  }
  const fallbackReceipts = [
    `Matchup score · ${String(battle.left.overallScore)}–${String(battle.right.overallScore)} from the versioned public scorecard.`,
    `Matchup result · ${battle.winner === "left" || battle.winner === "right" ? `@${terminalSafe(battle[battle.winner].username)} leads` : "Tie"} by ${String(battle.margin)} points.`,
  ];
  for (const fallback of fallbackReceipts) {
    if (receipts.length >= 4) break;
    receipts.push(fallback);
  }
  return receipts.slice(0, 6);
};

const readFor = (battle: BattleResult, story: StoryResult, side: Side): string => {
  const storyRead = side === "left" ? story.leftRead : story.rightRead;
  return terminalSafe(storyRead?.text ?? battle.strengths[side].text);
};

const exportQualityReading = (reading: QualityReading): string =>
  reading.previewScore === null
    ? "not enough readable source"
    : `${String(reading.previewScore)} · sample coverage ${String(reading.coverage)}%`;

const sharedQualityLimitation = (quality: QualityJudgePair): string | null => {
  if (
    quality.left.maintainedCodebase.previewScore !== null ||
    quality.right.maintainedCodebase.previewScore !== null ||
    quality.left.limitationReason !== quality.right.limitationReason
  )
    return null;
  const explanation: Readonly<Record<QualityJudgePair["left"]["limitationReason"], string>> = {
    "request-budget-limited":
      "GitHub request capacity limited Code Quality Preview for both profiles.",
    "supported-language-limited": "Not enough TypeScript/JavaScript for a useful sample.",
    "eligible-source-limited": "Not enough TypeScript/JavaScript for a useful sample.",
    "attribution-limited": "Not enough user-linked source for either attributed-code reading.",
    mixed: "Request capacity and supported-source limits affected both profiles.",
    unknown: "Not enough supported source for either profile.",
  };
  return explanation[quality.left.limitationReason];
};

const exportDocument = (input: RenderBattleExportInput): ExportDocument => {
  const { battle, source, story } = input;
  const presentation = derivePresentationVerdict(battle, source);
  const rounds = decisiveRounds(battle);
  const winner =
    battle.winner === "tie" || battle.winner === "unscored"
      ? "Tie"
      : `@${terminalSafe(battle[battle.winner].username)} wins`;
  return {
    title: "Git Mog Battle",
    leftHandle: `@${terminalSafe(battle.left.username)}`,
    rightHandle: `@${terminalSafe(battle.right.username)}`,
    winner,
    leftScore: battle.left.overallScore,
    rightScore: battle.right.overallScore,
    leftCoverage: battle.left.confidence.measuredWeight,
    rightCoverage: battle.right.confidence.measuredWeight,
    presentation,
    comparisons: rounds.map((round) => roundComparison(round, battle)),
    leftRead: readFor(battle, story, "left"),
    rightRead: readFor(battle, story, "right"),
    receipts: exportReceipts(battle, rounds),
    version: input.version,
    rematch: battle.challenge.canonical,
    limitation:
      "Coverage is the share of the public scorecard measured, not an estimate of total engineering ability.",
    quality:
      input.qualityPreview === undefined
        ? null
        : {
            leftMaintained: exportQualityReading(input.qualityPreview.left.maintainedCodebase),
            rightMaintained: exportQualityReading(input.qualityPreview.right.maintainedCodebase),
            leftAttributed: exportQualityReading(input.qualityPreview.left.attributedCode),
            rightAttributed: exportQualityReading(input.qualityPreview.right.attributedCode),
            sharedLimitation: sharedQualityLimitation(input.qualityPreview),
          },
    privateContext:
      input.privateContext === undefined
        ? null
        : {
            subject: `@${terminalSafe(input.privateContext.subject)}`,
            analyzedRepositories: input.privateContext.repositorySelection.analyzedRepositories,
            maintainedRepositories: input.privateContext.repositorySelection.maintainedRepositories,
            attributableRepositories:
              input.privateContext.repositorySelection.attributableRepositories,
            relationship: privateRelationshipText(input.privateContext),
            summary:
              input.privateContext.status === "insufficient"
                ? [
                    "Selected private repos were available, but not enough supported source qualified.",
                  ]
                : [
                    ...input.privateContext.receipts
                      .filter((receipt) =>
                        ["ci-repositories", "sustained-repositories"].includes(receipt.metric),
                      )
                      .map((receipt) => receipt.claim),
                    `${privateQualitySampleText(input.privateContext)}.`,
                  ],
          },
  };
};

const renderHtml = (document: ExportDocument): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
  <title>${escapeMarkup(document.title)} · ${escapeMarkup(document.leftHandle)} vs ${escapeMarkup(document.rightHandle)}</title>
  <style>
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #0d1117; color: #f0f6fc; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px 18px; background: #0d1117; }
    main { width: min(920px, 100%); margin: 0 auto; border: 1px solid #30363d; background: #161b22; }
    header, section, footer { padding: 24px 28px; border-bottom: 1px solid #30363d; }
    footer { border-bottom: 0; color: #8b949e; }
    h1, h2, p, ol { margin-top: 0; }
    h1 { font-size: clamp(24px, 5vw, 42px); margin-bottom: 10px; }
    h2 { color: #58a6ff; font-size: 14px; letter-spacing: .08em; text-transform: uppercase; }
    .verdict { color: #3fb950; font-size: clamp(18px, 4vw, 30px); font-weight: 800; }
    .scoreboard, .reads { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .player { border: 1px solid #30363d; padding: 18px; }
    .score { font-size: 34px; font-weight: 800; }
    .muted { color: #8b949e; }
    .mixed { color: #58a6ff; font-weight: 700; }
    li { margin: 9px 0; overflow-wrap: anywhere; }
    code { color: #f0f6fc; overflow-wrap: anywhere; }
    @media (max-width: 620px) { .scoreboard, .reads { grid-template-columns: 1fr; } header, section, footer { padding: 20px; } }
    @media print { :root, body { background: #fff; color: #111; } main, .player { border-color: #777; background: #fff; } .verdict { color: #111; } .muted, footer { color: #333; } }
  </style>
</head>
<body>
<main>
  <header>
    <p class="muted">GIT MOG</p>
    <h1>${escapeMarkup(document.leftHandle)} vs ${escapeMarkup(document.rightHandle)}</h1>
    <p class="verdict">${escapeMarkup(document.winner)} · ${escapeMarkup(document.presentation.label)}</p>
    ${document.privateContext === null ? "" : `<p class="mixed">MIXED CONTEXT · ${escapeMarkup(document.privateContext.subject)} +${String(document.privateContext.analyzedRepositories)} PRIVATE · PUBLIC WINNER</p>`}
  </header>
  <section aria-labelledby="score-heading">
    <h2 id="score-heading">Score and coverage</h2>
    <div class="scoreboard">
      <div class="player"><strong>${escapeMarkup(document.leftHandle)}</strong><div class="score">${String(document.leftScore)}</div><div class="muted">Coverage ${String(document.leftCoverage)}%</div></div>
      <div class="player"><strong>${escapeMarkup(document.rightHandle)}</strong><div class="score">${String(document.rightScore)}</div><div class="muted">Coverage ${String(document.rightCoverage)}%</div></div>
    </div>
  </section>
  <section aria-labelledby="fight-heading"><h2 id="fight-heading">Three decisive comparisons</h2><ol>${document.comparisons.map((entry) => `<li>${escapeMarkup(entry)}</li>`).join("")}</ol></section>
  <section aria-labelledby="read-heading"><h2 id="read-heading">The read</h2><div class="reads"><p><strong>${escapeMarkup(document.leftHandle)}</strong><br>${escapeMarkup(document.leftRead)}</p><p><strong>${escapeMarkup(document.rightHandle)}</strong><br>${escapeMarkup(document.rightRead)}</p></div></section>
  ${document.quality === null ? "" : document.quality.sharedLimitation === null ? `<section aria-labelledby="quality-heading"><h2 id="quality-heading">Code Quality · Preview</h2><div class="reads"><p><strong>${escapeMarkup(document.leftHandle)}</strong><br>Codebase sample: ${escapeMarkup(document.quality.leftMaintained)}<br>Authored sample: ${escapeMarkup(document.quality.leftAttributed)}</p><p><strong>${escapeMarkup(document.rightHandle)}</strong><br>Codebase sample: ${escapeMarkup(document.quality.rightMaintained)}<br>Authored sample: ${escapeMarkup(document.quality.rightAttributed)}</p></div><p class="muted">Not used in the battle score.</p></section>` : `<section aria-labelledby="quality-heading"><h2 id="quality-heading">Code Quality · Preview</h2><p>${escapeMarkup(document.quality.sharedLimitation)}</p><p class="muted">Not used in the battle score.</p></section>`}
  ${document.privateContext === null ? "" : `<section aria-labelledby="private-heading"><h2 id="private-heading">Private Context · ${escapeMarkup(document.privateContext.subject)}</h2><p>${String(document.privateContext.analyzedRepositories)} selected · ${escapeMarkup(document.privateContext.relationship)}</p><ol>${document.privateContext.summary.map((entry) => `<li>${escapeMarkup(entry)}</li>`).join("")}</ol><p class="muted">Private repos did not change the winner.</p></section>`}
  <section aria-labelledby="receipt-heading"><h2 id="receipt-heading">Public receipts</h2><ol>${document.receipts.map((entry) => `<li>${escapeMarkup(entry)}</li>`).join("")}</ol></section>
  <footer><p>${escapeMarkup(document.limitation)}</p><p>Git Mog ${escapeMarkup(document.version)} · Rematch: <code>${escapeMarkup(document.rematch)}</code></p></footer>
</main>
</body>
</html>
`;

const wrapText = (value: string, maximum: number): readonly string[] => {
  const words = terminalSafe(value).split(/\s+/u);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (Array.from(candidate).length <= maximum) {
      line = candidate;
      continue;
    }
    if (line !== "") lines.push(line);
    line = word;
  }
  if (line !== "") lines.push(line);
  return lines;
};

const svgText = (
  lines: readonly string[],
  x: number,
  y: number,
  className: string,
  lineHeight = 24,
): string =>
  `<text x="${String(x)}" y="${String(y)}" class="${className}">${lines
    .map(
      (line, index) =>
        `<tspan x="${String(x)}" dy="${index === 0 ? "0" : String(lineHeight)}">${escapeMarkup(line)}</tspan>`,
    )
    .join("")}</text>`;

const renderSvg = (document: ExportDocument): string => {
  const comparisons = document.comparisons.flatMap((entry, index) =>
    wrapText(`${String(index + 1)}. ${entry}`, 76),
  );
  const reads = [
    ...wrapText(`${document.leftHandle}: ${document.leftRead}`, 76),
    ...wrapText(`${document.rightHandle}: ${document.rightRead}`, 76),
  ];
  const receipts = document.receipts.flatMap((entry, index) =>
    wrapText(`${String(index + 1)}. ${entry}`, 82),
  );
  const qualityLines =
    document.quality === null
      ? []
      : document.quality.sharedLimitation === null
        ? [
            `${document.leftHandle} maintained: ${document.quality.leftMaintained}; attributed: ${document.quality.leftAttributed}`,
            `${document.rightHandle} maintained: ${document.quality.rightMaintained}; attributed: ${document.quality.rightAttributed}`,
            "Not used in the battle score.",
          ]
        : [document.quality.sharedLimitation, "Not used in the battle score."];
  const privateLines =
    document.privateContext === null
      ? []
      : [
          `MIXED CONTEXT · ${document.privateContext.subject} +${String(document.privateContext.analyzedRepositories)} PRIVATE · PUBLIC WINNER`,
          `${String(document.privateContext.analyzedRepositories)} selected · ${document.privateContext.relationship}`,
          ...document.privateContext.summary,
          "Private repos did not change the winner.",
        ];
  const height =
    620 +
    (comparisons.length +
      reads.length +
      qualityLines.length +
      privateLines.length +
      receipts.length) *
      24 +
    (qualityLines.length > 0 ? 70 : 0) +
    (privateLines.length > 0 ? 70 : 0);
  const comparisonY = 330;
  const readY = comparisonY + comparisons.length * 24 + 70;
  const qualityY = readY + reads.length * 24 + 70;
  const receiptY = qualityY + qualityLines.length * 24 + (qualityLines.length > 0 ? 70 : 0);
  const privateY = receiptY;
  const publicReceiptY = privateY + privateLines.length * 24 + (privateLines.length > 0 ? 70 : 0);
  const footerY = publicReceiptY + receipts.length * 24 + 70;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${String(height)}" viewBox="0 0 1200 ${String(height)}" role="img" aria-labelledby="title description">
  <title id="title">${escapeMarkup(document.title)}: ${escapeMarkup(document.leftHandle)} versus ${escapeMarkup(document.rightHandle)}</title>
  <desc id="description">Scores, public scorecard coverage, presentation verdict, decisive comparisons, profile reads, public receipts, and rematch command.</desc>
  <style>text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:#f0f6fc}.label{fill:#58a6ff;font-size:18px;font-weight:700;letter-spacing:1px}.title{font-size:42px;font-weight:800}.verdict{fill:#3fb950;font-size:28px;font-weight:800}.score{font-size:34px;font-weight:800}.body{font-size:18px}.muted{fill:#8b949e;font-size:16px}.panel{fill:#161b22;stroke:#30363d;stroke-width:2}</style>
  <rect width="1200" height="${String(height)}" fill="#0d1117"/>
  <rect x="40" y="40" width="1120" height="${String(height - 80)}" rx="8" class="panel"/>
  ${svgText(["GIT MOG"], 80, 88, "label")}
  ${svgText([`${document.leftHandle} vs ${document.rightHandle}`], 80, 140, "title")}
  ${svgText([`${document.winner} · ${document.presentation.label}`], 80, 190, "verdict")}
  ${svgText([`${document.leftHandle}  ${String(document.leftScore)}  · coverage ${String(document.leftCoverage)}%`], 80, 252, "score")}
  ${svgText([`${document.rightHandle}  ${String(document.rightScore)}  · coverage ${String(document.rightCoverage)}%`], 640, 252, "score")}
  ${svgText(["THREE DECISIVE COMPARISONS"], 80, comparisonY - 34, "label")}
  ${svgText(comparisons, 80, comparisonY, "body")}
  ${svgText(["THE READ"], 80, readY - 34, "label")}
  ${svgText(reads, 80, readY, "body")}
  ${qualityLines.length === 0 ? "" : `${svgText(["CODE QUALITY · PREVIEW"], 80, qualityY - 34, "label")} ${svgText(qualityLines, 80, qualityY, "body")}`}
  ${privateLines.length === 0 ? "" : `${svgText(["PRIVATE CONTEXT"], 80, privateY - 34, "label")} ${svgText(privateLines, 80, privateY, "body")}`}
  ${svgText(["PUBLIC RECEIPTS"], 80, publicReceiptY - 34, "label")}
  ${svgText(receipts, 80, publicReceiptY, "body")}
  ${svgText(wrapText(document.limitation, 96), 80, footerY, "muted")}
  ${svgText(wrapText(`Git Mog ${document.version} · Rematch: ${document.rematch}`, 96), 80, footerY + 52, "muted")}
</svg>
`;
};

export function renderBattleExport(input: RenderBattleExportInput): Buffer {
  const document = exportDocument(input);
  const rendered = input.format === "html" ? renderHtml(document) : renderSvg(document);
  if (
    input.privateContext !== undefined &&
    !mixedPrivateArtifactIsSafe(rendered, input.privateContext)
  ) {
    throw new Error("Mixed-context export failed its privacy boundary.");
  }
  const bytes = Buffer.from(rendered, "utf8");
  if (bytes.byteLength > MAX_EXPORT_BYTES) {
    throw new Error(`Export exceeds the ${String(MAX_EXPORT_BYTES)}-byte limit.`);
  }
  return bytes;
}

export function resolveExportDestination(
  value: string,
  options: { readonly cwd: string; readonly platform?: NodeJS.Platform | undefined },
): ExportResult<ExportDestination> {
  const hasControls = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (value === "" || value !== value.trim() || hasControls) {
    return {
      ok: false,
      error: "Export path must be non-empty and contain no padding or controls.",
    };
  }
  const pathApi = options.platform === "win32" ? win32 : posix;
  const destination = pathApi.resolve(options.cwd, value);
  if (destination === pathApi.parse(destination).root) {
    return { ok: false, error: "Export destination must be a file, not a filesystem root." };
  }
  const extension = pathApi.extname(destination).toLowerCase();
  if (extension !== ".html" && extension !== ".svg") {
    return { ok: false, error: "Export path must end in .html or .svg." };
  }
  return {
    ok: true,
    value: { path: destination, format: extension.slice(1) as BattleExportFormat },
  };
}

const canonicalDestination = (
  destination: string,
  platform: NodeJS.Platform,
): ExportResult<ExportDestination> => {
  const parsed = resolveExportDestination(destination, { cwd: process.cwd(), platform });
  if (!parsed.ok) return parsed;
  if (existsSync(parsed.value.path)) {
    const status = lstatSync(parsed.value.path);
    return {
      ok: false,
      error: status.isSymbolicLink()
        ? "Export destination is a symbolic link. Choose a new file."
        : "Export destination already exists. Choose a new file.",
    };
  }
  const requestedParent = dirname(parsed.value.path);
  const missing: string[] = [];
  let ancestor = requestedParent;
  while (!existsSync(ancestor)) {
    missing.unshift(ancestor.slice(ancestor.lastIndexOf(sep) + 1));
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      return { ok: false, error: "Export destination has no existing safe ancestor." };
    }
    ancestor = parent;
  }
  const resolvedAncestor = realpathSync(ancestor);
  const resolvedParent = join(resolvedAncestor, ...missing);
  const canonicalPath = join(resolvedParent, parse(parsed.value.path).base);
  const tail = relative(resolvedAncestor, canonicalPath);
  if (tail === "" || tail.startsWith(`..${sep}`) || tail === "..") {
    return { ok: false, error: "Export destination escapes its resolved parent." };
  }
  return { ok: true, value: { ...parsed.value, path: canonicalPath } };
};

/** Read-only native-filesystem validation. No directory or file is created. */
export function prepareExportDestination(
  value: string,
  cwd = process.cwd(),
): ExportResult<ExportDestination> {
  const lexical = resolveExportDestination(value, { cwd, platform: process.platform });
  return lexical.ok ? canonicalDestination(lexical.value.path, process.platform) : lexical;
}

const defaultCommit = (temporaryPath: string, destinationPath: string): void => {
  linkSync(temporaryPath, destinationPath);
};

const defaultReserve = (temporaryPath: string): number => openSync(temporaryPath, "wx", 0o644);

export function writeBattleExport(
  input: WriteBattleExportInput,
): ExportResult<BattleExportMetadata> {
  const prepared = prepareExportDestination(input.destination, input.cwd ?? process.cwd());
  if (!prepared.ok) return prepared;
  const bytes = renderBattleExport({ ...input, format: prepared.value.format });
  const parent = dirname(prepared.value.path);
  try {
    mkdirSync(parent, { recursive: true });
    if (realpathSync(parent) !== parent) {
      return { ok: false, error: "Export parent did not resolve to the validated destination." };
    }
  } catch {
    return { ok: false, error: "Export parent could not be created safely." };
  }

  let temporaryPath = "";
  let descriptor: number | null = null;
  try {
    for (let attempts = 0; attempts < 16; attempts += 1) {
      temporarySequence += 1;
      temporaryPath = join(
        parent,
        `.${parse(prepared.value.path).base}.gitmog-${String(process.pid)}-${String(temporarySequence)}.tmp`,
      );
      try {
        descriptor = (input.reserve ?? defaultReserve)(temporaryPath);
        break;
      } catch {
        temporaryPath = "";
      }
    }
    if (descriptor === null || temporaryPath === "") {
      return { ok: false, error: "Export could not reserve an atomic temporary file." };
    }
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    (input.commit ?? defaultCommit)(temporaryPath, prepared.value.path);
    unlinkSync(temporaryPath);
    temporaryPath = "";
    return {
      ok: true,
      value: {
        ...prepared.value,
        schemaVersion: EXPORT_SCHEMA_VERSION,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    };
  } catch {
    return { ok: false, error: "Export could not be written atomically." };
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (temporaryPath !== "" && existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}
