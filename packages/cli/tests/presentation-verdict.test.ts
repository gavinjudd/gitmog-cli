import { runBattle } from "@gitmog/battle";
import type { SourceAnalysisResult, StoryResult } from "@gitmog/source-analysis";
import type { BattleResult, VerdictClass } from "@gitmog/scoring";
import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
} from "@gitmog/test-fixtures/github-personas";
import { beforeAll, describe, expect, it } from "vitest";

import {
  PRESENTATION_VERDICT_VERSION,
  derivePresentationVerdict,
} from "../src/presentation-verdict.js";
import { renderBattle, renderCard } from "../src/render.js";
import { renderShare } from "../src/share.js";

let baseBattle: BattleResult;
let baseSource: SourceAnalysisResult;
let baseStory: StoryResult;

beforeAll(async () => {
  const leftFetch = createFixtureFetch(PERSONAS.strongMaintainer);
  const rightFetch = createFixtureFetch(PERSONAS.manyTinyRepos);
  const result = await runBattle({
    left: PERSONAS.strongMaintainer.login,
    right: PERSONAS.manyTinyRepos.login,
    cache: null,
    now: () => FIXTURE_NOW_MS,
    fetchImpl: (input, init) => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return href.toLowerCase().includes(PERSONAS.strongMaintainer.login)
        ? leftFetch(input, init)
        : rightFetch(input, init);
    },
  });
  if (!result.ok) throw new Error(result.error.code);
  baseBattle = result.battle;
  baseSource = result.sourceAnalysis;
  baseStory = result.story;
});

const withCoverage = (
  left: number,
  right: number,
  options: {
    readonly verdictClass?: VerdictClass;
    readonly verdictLabel?: string;
    readonly winner?: BattleResult["winner"];
  } = {},
): BattleResult => ({
  ...baseBattle,
  ...(options.verdictClass === undefined ? {} : { verdictClass: options.verdictClass }),
  ...(options.verdictLabel === undefined ? {} : { verdictLabel: options.verdictLabel }),
  ...(options.winner === undefined ? {} : { winner: options.winner }),
  left: {
    ...baseBattle.left,
    confidence: { ...baseBattle.left.confidence, measuredWeight: left },
  },
  right: {
    ...baseBattle.right,
    confidence: { ...baseBattle.right.confidence, measuredWeight: right },
  },
});

describe("coverage-aware presentation verdict", () => {
  it.each([
    [49, 50, "limited", "PUBLIC EDGE · LIMITED READ"],
    [50, 50, "qualified", "PUBLIC REPO GAP"],
    [69, 69, "qualified", "PUBLIC REPO GAP"],
    [70, 70, "full-strength", "NUCLEAR REPO GAP"],
    [49, 90, "limited", "PUBLIC EDGE · LIMITED READ"],
    [50, 81, "limited", "PUBLIC EDGE · LIMITED READ"],
    [70, 91, "qualified", "PUBLIC REPO GAP"],
  ] as const)("classifies %i/%i coverage as %s", (leftCoverage, rightCoverage, band, label) => {
    const presentation = derivePresentationVerdict(
      withCoverage(leftCoverage, rightCoverage, {
        verdictClass: "nuclear-repo-gap",
        verdictLabel: "NUCLEAR REPO GAP",
      }),
      baseSource,
    );
    expect(presentation).toMatchObject({
      version: PRESENTATION_VERDICT_VERSION,
      band,
      label,
      minimumCoverage: Math.min(leftCoverage, rightCoverage),
      coverageDifference: Math.abs(leftCoverage - rightCoverage),
    });
  });

  it.each([
    ["mutual-aura", "MUTUAL AURA"],
    ["photo-finish", "PHOTO FINISH"],
    ["aura-edge", "AURA EDGE"],
    ["clean-mog", "CLEAN MOG"],
    ["extreme-diff", "EXTREME DIFF"],
    ["nuclear-repo-gap", "NUCLEAR REPO GAP"],
  ] as const)("preserves the fully covered %s vocabulary", (verdictClass, verdictLabel) => {
    expect(
      derivePresentationVerdict(withCoverage(90, 90, { verdictClass, verdictLabel }), baseSource),
    ).toMatchObject({ band: "full-strength", label: verdictLabel });
  });

  it("keeps winner direction independent from coverage qualification", () => {
    const reversed = withCoverage(60, 60, { winner: "right" });
    const presentation = derivePresentationVerdict(reversed, baseSource);
    const output = renderBattle(reversed, baseSource, baseStory);
    expect(presentation.label).toBe("PUBLIC REPO GAP");
    expect(output).toContain(`@${reversed.right.username} WINS`);
    expect(output).toContain(presentation.label);
  });

  it.each(["ready", "partial", "insufficient"] as const)(
    "does not weaken full coverage solely because source status is %s",
    (status) => {
      const source = { ...baseSource, status };
      expect(derivePresentationVerdict(withCoverage(90, 90), source)).toMatchObject({
        band: "full-strength",
        label: baseBattle.verdictLabel,
      });
    },
  );

  it("limits an extreme label when collection has a material transient failure", () => {
    const source = {
      ...baseSource,
      left: {
        ...baseSource.left,
        codeDna: {
          ...baseSource.left.codeDna,
          sourceFailureReasons: ["rate-limited"],
        },
      },
    } as SourceAnalysisResult;
    expect(derivePresentationVerdict(withCoverage(90, 90), source)).toMatchObject({
      band: "limited",
      label: "PUBLIC EDGE · LIMITED READ",
      reasonCodes: ["material-collector-degradation"],
    });
  });

  it("uses bounded tie labels at qualified and limited coverage", () => {
    expect(
      derivePresentationVerdict(withCoverage(60, 60, { winner: "tie" }), baseSource).label,
    ).toBe("PUBLIC TAPE EVEN");
    expect(
      derivePresentationVerdict(withCoverage(49, 49, { winner: "tie" }), baseSource).label,
    ).toBe("INCOMPLETE TAPE");
  });

  it("keeps low-coverage extreme vocabulary off terminal, card, and shares", () => {
    const battle = withCoverage(49, 90, {
      verdictClass: "nuclear-repo-gap",
      verdictLabel: "NUCLEAR REPO GAP",
    });
    const outputs = [
      renderBattle(battle, baseSource, baseStory),
      renderCard(battle, baseSource, baseStory),
      ...(["plain", "x", "discord", "linkedin"] as const).map((preset) =>
        renderShare(battle, preset, baseSource, baseStory),
      ),
    ];
    for (const output of outputs) {
      expect(output).toContain("LIMITED READ");
      expect(output).not.toContain("NUCLEAR");
      expect(output).not.toContain("CATASTROPHIC");
    }
  });

  it("shows canonical and presentation verdicts distinctly only in detailed human output", () => {
    const battle = withCoverage(59, 54);
    const normal = renderBattle(battle, baseSource, baseStory);
    const details = renderBattle(battle, baseSource, baseStory, { details: true });
    expect(normal).toContain("PUBLIC REPO GAP");
    expect(normal).not.toContain("Canonical verdict:");
    expect(details).toContain("PUBLIC REPO GAP");
    expect(details).toContain(`Canonical verdict: ${battle.verdictLabel}`);
  });
});
