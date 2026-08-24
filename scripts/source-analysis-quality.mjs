#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CODE_AXIS_IDS,
  CODE_DNA_BY_ID,
  CODE_DNA_IDS,
  evaluateCodeDnaSampleSet,
} from "../packages/personality/dist/index.js";
import {
  CODE_DNA_CALIBRATION_FIXTURES,
  calibrationSampleSet,
} from "../packages/personality/dist/calibration.js";
import {
  AURA_LEAK_DEFINITIONS,
  MEME_ENGINE_VERSION,
  MOGSONA_DEFINITIONS,
} from "../packages/scoring/dist/index.js";
import { renderCard } from "../packages/cli/dist/index.js";
import { battleFixture } from "../packages/test-fixtures/src/battle-result.ts";
import {
  NARRATIVE_TEMPLATE_CORPUS,
  SOURCE_ANALYSIS_VERSION,
  STORY_THEME_IDS,
  buildStoryPlanContext,
  deriveFallbackStoryReadPlan,
  renderStoryReadPlan,
  selectDeterministicStoryReadPlan,
  templateVariantIndex,
} from "../packages/source-analysis/dist/index.js";

const roastModes = ["clean", "spicy", "unhinged"];
const ESCAPE = String.fromCodePoint(27);
const banned = [
  /measured blend/i,
  /measured pole/i,
  /source receipt/i,
  /feature family/i,
  /signal hierarchy/i,
  /identity specificity/i,
  /concentrated specialist signature/i,
  /evidence supports/i,
  /coherent under load/i,
  /validated source-style contrast/i,
  /distinct measured feature mix/i,
  /application-oriented source signature/i,
  /source signature/i,
  /sample proves/i,
  /confidence band/i,
  /didn.t just/i,
  /not only/i,
  /it.s giving/i,
  /plot twist/i,
  /let that sink in/i,
  /game-changer/i,
  /\bunlock/i,
  /\bdelve/i,
  /at the end of the day/i,
  /in the world of/i,
];

function fail(message) {
  throw new Error(message);
}

const fixtureReadings = new Map(
  CODE_DNA_CALIBRATION_FIXTURES.map((fixture) => [
    fixture.id,
    evaluateCodeDnaSampleSet(calibrationSampleSet(fixture)),
  ]),
);
const fixtureReading = (id) => {
  const reading = fixtureReadings.get(id);
  if (reading === undefined) fail(`Missing fixture reading ${id}.`);
  return reading;
};
const withLabel = (reading, id) => {
  if (reading.status === "insufficient") fail(`Cannot label insufficient reading ${id}.`);
  const definition = CODE_DNA_BY_ID.get(id);
  const candidate = reading.labelCandidates.find((entry) => entry.id === id && entry.eligible);
  if (definition === undefined || candidate === undefined) {
    fail(`Fixture is not compatible with ${id}.`);
  }
  return {
    ...reading,
    label: {
      id,
      name: definition.name,
      copy: definition.copy,
      confidence: reading.confidence,
      featureIds: candidate.featureIds,
      sampleIds: candidate.sampleIds,
      axisEngineVersion: reading.axisEngineVersion,
    },
  };
};
const readings = [
  withLabel(fixtureReading("direct-compact-application"), "straight-shooter"),
  withLabel(fixtureReading("deep-abstraction"), "layer-cake"),
  withLabel(fixtureReading("vibe-heavy-dynamic"), "vibe-merchant"),
  withLabel(fixtureReading("defensive-typed"), "guardrail-goblin"),
  withLabel(fixtureReading("instruction-shaped-comment"), "minimalist"),
  withLabel(fixtureReading("ceremonial-framework"), "framework-priest"),
  withLabel(fixtureReading("api-integration"), "api-plumber"),
  withLabel(fixtureReading("systems-protocol"), "systems-maxxer"),
  withLabel(fixtureReading("high-confidence-hybrid"), "code-chimera"),
  withLabel(fixtureReading("ceremonial-framework"), "abstraction-astronaut"),
  withLabel(fixtureReading("defensive-typed"), "type-inquisitor"),
  withLabel(fixtureReading("data-pipeline"), "data-shaman"),
  withLabel(fixtureReading("algorithmic-core"), "leetcode-monk"),
];
const asReady = (reading) => {
  if (reading.status === "insufficient" || reading.label === undefined) {
    fail("Mirror fixture needs a measurable identity.");
  }
  const { reason: _reason, ...measured } = reading;
  const original = reading.samples[0];
  if (original === undefined) fail("Mirror fixture needs a source sample.");
  const samples = [0, 1, 2].map((index) => ({
    ...original,
    sampleId: `mirror-sample-${String(index + 1)}`,
    repository: `fixture/mirror-${String(index + 1)}`,
    repositoryUrl: `https://github.com/fixture/mirror-${String(index + 1)}`,
    treeSha: `mirror-tree-${String(index + 1)}`,
    blobSha: `mirror-blob-${String(index + 1)}`,
    sourceUrl: `https://github.com/fixture/mirror-${String(index + 1)}/blob/mirror/src/main.ts`,
  }));
  const sampleIds = samples.map((sample) => sample.sampleId);
  return {
    ...measured,
    status: "ready",
    samples,
    axes: Object.fromEntries(
      CODE_AXIS_IDS.map((axis) => [
        axis,
        {
          ...measured.axes[axis],
          sampleIds,
          contributions: measured.axes[axis].contributions.map((contribution) => ({
            ...contribution,
            sampleIds,
          })),
        },
      ]),
    ),
    featureContributions: measured.featureContributions.map((feature) => ({
      ...feature,
      sampleIds,
    })),
    repositoriesRepresented: 3,
    confidence: 80,
    sourceConfidence: 80,
    label: {
      ...reading.label,
      confidence: 80,
      sampleIds,
    },
  };
};
readings.push(asReady(readings[0]));

const pairs = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [13, 13],
  [8, 9],
  [8, 8],
  [8, 10],
  [11, 12],
  [4, 9],
  [3, 5],
];
const targetThemes = [
  "architecture-clash",
  "defense-clash",
  "density-clash",
  "domain-clash",
  "mirror-match",
  "chimera-clash",
  "hybrid-match",
  "coverage-gap",
  "limited-evidence",
  "density-clash",
  "defense-clash",
];

function profileIdentity(definition, index) {
  return {
    version: "1.0.0-mogsona",
    id: definition.id,
    name: definition.name,
    auraClass: "distinctive",
    signalScore: 70,
    confidence: 70,
    summary: definition.name,
    evidenceIds: ["craft.testing.exists:ratio"],
    qualifyingSignals: [`corpus profile ${String(index + 1)}`],
  };
}

function leak(definition, index) {
  return {
    version: "1.0.0-aura-leak",
    id: definition.id,
    name: definition.name,
    severity: definition.severity,
    evidenceIds: ["craft.hygiene.abandonment:count"],
    qualifyingSignals: [`corpus weakness ${String(index + 1)}`],
  };
}

function corpusBattle(index, roast, reverse) {
  const base = battleFixture();
  const leftHandle =
    index === 10 ? "long-valid-handle-for-card-check-01" : `dev-${String(index + 1)}-left`;
  const rightHandle =
    index === 10 ? "long-valid-handle-for-card-check-02" : `dev-${String(index + 1)}-right`;
  const handles = reverse ? [rightHandle, leftHandle] : [leftHandle, rightHandle];
  const mogLeft = MOGSONA_DEFINITIONS[(index * 2) % MOGSONA_DEFINITIONS.length];
  const mogRight = MOGSONA_DEFINITIONS[(index * 2 + 1) % MOGSONA_DEFINITIONS.length];
  const auraLeft = AURA_LEAK_DEFINITIONS[(index * 2) % AURA_LEAK_DEFINITIONS.length];
  const auraRight = AURA_LEAK_DEFINITIONS[(index * 2 + 1) % AURA_LEAK_DEFINITIONS.length];
  return {
    ...base,
    battleKey: `copy-v2:${String(index)}:${roast}:${reverse ? "reverse" : "forward"}`,
    roast,
    left: {
      ...base.left,
      username: handles[0],
      mogsona: profileIdentity(reverse ? mogRight : mogLeft, index),
      auraLeak: leak(reverse ? auraRight : auraLeft, index),
    },
    right: {
      ...base.right,
      username: handles[1],
      mogsona: profileIdentity(reverse ? mogLeft : mogRight, index),
      auraLeak: leak(reverse ? auraLeft : auraRight, index),
    },
  };
}

function makeCard(index, roast, reverse) {
  const battle = corpusBattle(index, roast, reverse);
  const pair = pairs[index];
  const left = readings[reverse ? pair[1] : pair[0]];
  const right = readings[reverse ? pair[0] : pair[1]];
  const codeDna = { left, right };
  const context = buildStoryPlanContext(battle, codeDna);
  const selection = selectDeterministicStoryReadPlan(battle, codeDna, context);
  if (selection.scoredCandidates.length !== 3) fail("Story selector did not expose three plans.");
  const targetTheme = targetThemes[index];
  const motif = context.motifs.find((entry) => entry.themeId === targetTheme);
  if (motif === undefined)
    fail(`Theme ${targetTheme} is unreachable for corpus pair ${String(index)}.`);
  const plan = { ...deriveFallbackStoryReadPlan(battle, codeDna, context), ...motif };
  const read = renderStoryReadPlan(battle, codeDna, plan, context);
  const status =
    left.status === "ready" && right.status === "ready"
      ? "ready"
      : left.status === "insufficient" && right.status === "insufficient"
        ? "insufficient"
        : "partial";
  const profileAnalysis = (codeDna) => ({
    codeDna,
    samples: codeDna.samples,
    featureContributions: [],
    limitations: codeDna.limitations,
  });
  const rendered = renderCard(
    battle,
    {
      status,
      version: SOURCE_ANALYSIS_VERSION,
      analysisKey: `corpus:${battle.battleKey}`,
      left: profileAnalysis(left),
      right: profileAnalysis(right),
      requestBudget: {
        left: { metadata: 0, source: 0, total: 0, cap: 16 },
        right: { metadata: 0, source: 0, total: 0, cap: 16 },
        total: 0,
        cap: 32,
      },
    },
    read,
  );
  const renderedLines = rendered.trim().split("\n");
  const cardEnd = renderedLines.findIndex((line) => line.startsWith("└"));
  if (cardEnd < 0) fail(`Rendered card has no frame close for ${battle.battleKey}.`);
  const card = renderedLines.slice(0, cardEnd + 1).join("\n");
  if (!card.includes("SCORE")) {
    fail(`Rendered card lost score language for ${battle.battleKey}.`);
  }
  if (!card.includes("COVERAGE")) {
    fail(`Rendered card lost score-coverage language for ${battle.battleKey}.`);
  }
  if (!card.includes("[1]")) {
    fail(`Rendered card lost compact claim support for ${battle.battleKey}.`);
  }
  if (card.toUpperCase().includes("CODE DNA")) {
    fail(`Rendered card exposed a Code DNA status label for ${battle.battleKey}.`);
  }
  const normalizedCard = card.toUpperCase();
  for (const definition of AURA_LEAK_DEFINITIONS) {
    if (normalizedCard.includes(definition.name.toUpperCase())) {
      fail(`Rendered card exposed internal classifier copy for ${battle.battleKey}.`);
    }
  }
  if (/(?:craft|ship)\.[A-Za-z0-9_.-]+:[A-Za-z0-9_-]+|\bs[0-9a-f]{8,}\b/u.test(card)) {
    fail(`Rendered card exposed an internal support ID for ${battle.battleKey}.`);
  }
  return {
    key: battle.battleKey,
    roast,
    reverse,
    theme: plan.themeId,
    motif: `${plan.themeId}:${plan.finisherId}`,
    identities: [left.label?.id ?? "limited", right.label?.id ?? "limited"],
    mogsonas: [battle.left.mogsona.id, battle.right.mogsona.id],
    auraLeaks: [battle.left.auraLeak.id, battle.right.auraLeak.id],
    matchup: read.matchupThesis.text,
    finisher: read.finisher.text,
    card,
  };
}

const cards = pairs.flatMap((_pair, index) =>
  roastModes.flatMap((roast) => [makeCard(index, roast, false), makeCard(index, roast, true)]),
);

if (cards.length < 60) fail("The editorial corpus must contain at least sixty cards.");
if (new Set(cards.map((card) => card.card)).size !== cards.length) fail("Full-card collision.");
if (new Set(cards.map((card) => card.finisher)).size !== cards.length) fail("Finisher collision.");
for (const card of cards) {
  for (const pattern of banned) {
    if (pattern.test(`${card.matchup}\n${card.finisher}`)) {
      fail(`Banned copy in ${card.key}: ${String(pattern)}`);
    }
  }
  if (card.finisher.includes(ESCAPE)) fail(`ANSI leakage in ${card.key}.`);
  if (/\{\s*"(?:battle|sourceAnalysis|story)"|npx -y gitmog|--share\b/i.test(card.card)) {
    fail(`JSON or share-caption leakage in ${card.key}.`);
  }
}

const frameWords = (text) =>
  text
    .toLowerCase()
    .replace(/@[a-z\d](?:[a-z\d-]{0,38}[a-z\d])?/g, "@handle")
    .replace(/^(?:@handle\/@handle|(?:read|clash|verdict)\s+@handle→@handle):\s*/i, "")
    .match(/[a-z\d@-]+/g) ?? [];
const repeatedFrames = (size) => {
  const counts = new Map();
  for (const card of cards) {
    for (const line of [card.matchup, card.finisher]) {
      const words = frameWords(line);
      for (let index = 0; index <= words.length - size; index += 1) {
        const frame = words.slice(index, index + size).join(" ");
        counts.set(frame, (counts.get(frame) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
};
const threeWordFrames = repeatedFrames(3);
const fourWordFrames = repeatedFrames(4);
if ((threeWordFrames[0]?.[1] ?? 0) > 18) {
  fail(`Excessive repeated three-word frame: ${JSON.stringify(threeWordFrames[0])}.`);
}
if ((fourWordFrames[0]?.[1] ?? 0) > 12) {
  fail(`Excessive repeated four-word frame: ${JSON.stringify(fourWordFrames[0])}.`);
}

const templateIds = new Set();
const exactTemplates = new Set();
for (const [theme, family] of Object.entries(NARRATIVE_TEMPLATE_CORPUS)) {
  for (const [slot, modes] of Object.entries(family)) {
    for (const mode of roastModes) {
      const lines = modes[mode];
      if (lines.length === 0) fail(`Missing ${mode} variant for ${theme}:${slot}.`);
      for (const [index, line] of lines.entries()) {
        const id = `${theme}:${slot}:${mode}:${String(index)}`;
        if (templateIds.has(id)) fail(`Duplicate template id ${id}.`);
        templateIds.add(id);
        if (exactTemplates.has(line)) fail(`Duplicate exact authored template: ${line}`);
        exactTemplates.add(line);
        for (const pattern of banned) {
          if (pattern.test(line)) fail(`Banned authored copy in ${id}: ${String(pattern)}`);
        }
        if (
          /\{(?!first|second|left|right|handle|identity|angle|hybrid|specialist|broad|narrow)[a-z]+\}/.test(
            line,
          )
        ) {
          fail(`Unknown interpolation variable in ${id}.`);
        }
      }
      const reachable = new Set(
        Array.from({ length: 4_096 }, (_value, index) =>
          templateVariantIndex(`${theme}:${slot}:${mode}:reach:${String(index)}`, lines.length),
        ),
      );
      if (reachable.size !== lines.length)
        fail(`Unreachable template in ${theme}:${slot}:${mode}.`);
    }
  }
}

const coverage = (field) => new Set(cards.flatMap((card) => card[field]));
const themes = coverage("theme");
const identities = coverage("identities");
const mogsonas = coverage("mogsonas");
const auraLeaks = coverage("auraLeaks");
for (const theme of STORY_THEME_IDS) if (!themes.has(theme)) fail(`Uncovered theme ${theme}.`);
for (const id of CODE_DNA_IDS) if (!identities.has(id)) fail(`Uncovered Code DNA identity ${id}.`);
for (const entry of MOGSONA_DEFINITIONS)
  if (!mogsonas.has(entry.id)) fail(`Uncovered Mogsona ${entry.id}.`);
for (const entry of AURA_LEAK_DEFINITIONS)
  if (!auraLeaks.has(entry.id)) fail(`Uncovered Aura Leak ${entry.id}.`);

const motifCounts = Object.fromEntries(
  [...new Set(cards.map((card) => card.motif))]
    .sort()
    .map((motif) => [motif, cards.filter((card) => card.motif === motif).length]),
);
const finishers = [...new Set(cards.map((card) => card.finisher))];
const strongestFragments = [
  "The shortest path belongs",
  "The payload waved",
  "as a municipal project",
  "disassembles the bus",
  "The mirror survived",
  "The chimera packed three instincts",
  "toolchain custody battle",
  "submitted the box set",
  "The flashlight found a signal",
  "folded the module into a pocketknife",
];
const strongest = strongestFragments.map((fragment) => {
  const line = finishers.find((candidate) => candidate.includes(fragment));
  if (line === undefined) fail(`Missing editorial selection: ${fragment}.`);
  return line;
});
const weakest = finishers.find((line) => line.includes("One file each. Real signal, short leash."));
if (weakest === undefined) fail("Missing limited-evidence editorial floor line.");
const rejectedReplacements = [
  {
    rejected: "MOG SCORE 78 : 64 measurable",
    replacement: "SCORE 78 · SCORE COVERAGE 52% (per side)",
    reason:
      "The normalized result is no longer mislabeled as the amount of scorecard evidence measured.",
  },
  {
    rejected: "Receiptless matchup, identity, and finisher lines on the compact card",
    replacement: "One supported finisher with [1] and a compact repository reference",
    reason:
      "The compact card now renders fewer authored claims so every visible claim keeps primary support.",
  },
  {
    rejected: "Every line here has a receipt attached. Scroll down and check.",
    replacement: "{subject} brought tests. {opponent} brought main-branch faith.",
    reason: "A trust notice is not a finisher; the replacement uses the eligible testing gap.",
  },
  {
    rejected:
      "@{left} and @{right} both earn hybrid readings, but their measured blends use different proportions.",
    replacement: "Both style maps have multiple centers; the mixtures stay distinguishable.",
    reason: "Removed calibration-report phrasing from the first screen.",
  },
  {
    rejected: "The hybrid label matches; the signal hierarchy does not.",
    replacement: "Same range, different lead instrument for @{left} and @{right}.",
    reason: "Replaced internal taxonomy language with an immediate contrast.",
  },
  {
    rejected:
      "@{broad} arrives with a stack of source receipts; @{narrow} brings a smaller, still admissible sample.",
    replacement: "@{broad} has the binder; @{narrow} has the highlighted page.",
    reason: "Turned evidence administration into a concrete coverage-gap joke.",
  },
  {
    rejected: "The sample window is small; every line in the read still has a source receipt.",
    replacement: "One file each. Real signal, short leash.",
    reason: "Low evidence now gets a bounded joke instead of a system assurance.",
  },
  {
    rejected: "The bounded evidence supports only the visible style.",
    replacement: "One bounded sample walked in and every unsupported adjective left the room.",
    reason: "Kept the limitation while adding a concrete reversal.",
  },
  {
    rejected: "supports the same measured pole through a separate source receipt",
    replacement: "Same tools, different wear marks for @{left} and @{right}.",
    reason: "Removed axis-report language and made the mirror direction legible.",
  },
];

const report = [
  "# Viral copy v2 calibration",
  "",
  `- Cards reviewed: ${String(cards.length)}`,
  `- Unique complete cards: ${String(new Set(cards.map((card) => card.card)).size)}`,
  `- Unique finishers: ${String(new Set(cards.map((card) => card.finisher)).size)}`,
  `- Reverse-order collisions: 0`,
  `- Exact template collisions: 0`,
  `- Hottest repeated three-word frame: ${threeWordFrames[0]?.[0] ?? "none"} (${String(threeWordFrames[0]?.[1] ?? 0)})`,
  `- Hottest repeated four-word frame: ${fourWordFrames[0]?.[0] ?? "none"} (${String(fourWordFrames[0]?.[1] ?? 0)})`,
  `- Unreachable authored templates: 0`,
  `- Themes covered: ${String(themes.size)}/${String(STORY_THEME_IDS.length)}`,
  `- Code DNA identities covered: ${String(identities.size)}/${String(CODE_DNA_IDS.length)}`,
  `- Mogsonas covered: ${String(mogsonas.size)}/${String(MOGSONA_DEFINITIONS.length)}`,
  `- Aura Leaks covered: ${String(auraLeaks.size)}/${String(AURA_LEAK_DEFINITIONS.length)}`,
  `- Source-analysis version: ${SOURCE_ANALYSIS_VERSION}`,
  `- Meme-engine version: ${MEME_ENGINE_VERSION}`,
  "",
  "The corpus is synthetic and deterministic. A pass means structural and safety gates passed; it is not a perfect editorial score. Each card was read as a two-second screenshot: matchup, concrete developer concept, direction, receipt ownership, and roast energy.",
  "",
  "## Strongest ten finishers",
  "",
  ...strongest.map((line, index) => `${String(index + 1)}. ${line}`),
  "",
  "## Weakest remaining finisher",
  "",
  weakest,
  "",
  "It is retained because it remains specific, direction-aware, receipt-backed, and safely within the low-evidence family; its punch is intentionally lower than the high-confidence families.",
  "",
  "## Motif frequencies",
  "",
  "```json",
  JSON.stringify(motifCounts, null, 2),
  "```",
  "",
  "## Failed and replaced lines",
  "",
  "| Rejected line | Replacement line | Disposition |",
  "| --- | --- | --- |",
  ...rejectedReplacements.map(
    ({ rejected, replacement, reason }) => `| \`${rejected}\` | \`${replacement}\` | ${reason} |`,
  ),
  "",
  "Directional finishers also carry the rendered `@left→@right` prefix. This preserves the same evidence premise while eliminating reverse-order card collisions.",
  "",
  "## Exact first-screen cards",
  "",
  ...cards.flatMap((card, index) => [
    `### ${String(index + 1).padStart(2, "0")} · ${card.roast} · ${card.theme}${card.reverse ? " · reversed" : ""}`,
    "",
    "```text",
    card.card,
    "```",
    "",
  ]),
  "## Remaining coverage need",
  "",
  "Low-evidence and mirror families intentionally have quieter punchlines. Future authored coverage should add variety there without inventing stronger source claims.",
  "",
].join("\n");

const arguments_ = process.argv.slice(2);
const write = arguments_.includes("--write");
if (arguments_.some((argument) => argument !== "--write")) {
  fail("Usage: node scripts/source-analysis-quality.mjs [--write]");
}
if (write) writeFileSync(resolve("docs/calibration/viral-copy-v2.md"), report, "utf8");
process.stdout.write(
  `${JSON.stringify({ cards: cards.length, uniqueCards: cards.length, uniqueFinishers: cards.length, themes: themes.size, identities: identities.size, mogsonas: mogsonas.size, auraLeaks: auraLeaks.size, written: write }, null, 2)}\n`,
);
