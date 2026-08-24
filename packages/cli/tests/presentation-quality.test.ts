import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
  type PersonaSpec,
} from "@gitmog/test-fixtures/github-personas";
import { describe, expect, it } from "vitest";

import { run, type CliContext } from "../src/cli.js";
import { stripAnsi } from "../src/color.js";
import { renderBattle, renderCard, renderProfile } from "../src/render.js";
import { renderShare } from "../src/share.js";
import { ACTIVE_HUMAN_CLASSIFIER_LABELS, classifierLabelsIn } from "./classifier-labels.js";

const HUMAN_TAXONOMY_MARKERS = ["AURA LEAK", "MOGSONA:", "CODE DNA"] as const;

const BANNED_DEFAULT_COPY = [
  ...HUMAN_TAXONOMY_MARKERS,
  ...ACTIVE_HUMAN_CLASSIFIER_LABELS,
  "classifier",
  "source opportunity",
  "annualized qualifying commits",
  "CI-backed testing",
  "sustained original project",
  "qualifying commits per year, estimated",
  "Code DNA describes only the files sampled",
  "exact collection limits",
] as const;

const INTERNAL_EVIDENCE_ID = /(?:craft|ship)\.[A-Za-z0-9_.-]+:[A-Za-z0-9_-]+|\bs[0-9a-f]{8,}\b/u;

const contextFor = (...personas: readonly PersonaSpec[]): CliContext => {
  const handlers = personas.map((persona) => ({
    login: persona.login,
    fetchImpl: createFixtureFetch(persona),
  }));
  return {
    invokedAs: "gitmog",
    version: "0.2.1",
    env: { NO_COLOR: "1" },
    fetchImpl: (input, init) => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const found = handlers.find((handler) =>
        href.toLowerCase().includes(handler.login.toLowerCase()),
      );
      return (
        found?.fetchImpl(input, init) ??
        Promise.resolve(new Response('{"message":"Not Found"}', { status: 404 }))
      );
    },
    now: () => FIXTURE_NOW_MS,
    useFilesystem: false,
    skipBudgetPreflight: true,
  };
};

const invoke = (context: CliContext, ...args: readonly string[]) =>
  run(["node", "gitmog", ...args], context);
const battleContext = () => contextFor(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
const markerValues = (value: string): readonly string[] =>
  [...value.matchAll(/\[(\d+)\]/gu)].map((match) => match[1] as string);

describe("human-readable presentation contract", () => {
  it("derives active catalog labels and removes them from every human CLI surface", async () => {
    const context = battleContext();
    const secondLow = { ...PERSONAS.lowPublicEvidence, login: "lowpublictwo" };
    const outputs = await Promise.all([
      invoke(context, "strongmaintainer", "sidequester"),
      invoke(context, "strongmaintainer"),
      invoke(contextFor(PERSONAS.partialTreeFailure), "partialtree"),
      invoke(contextFor(PERSONAS.lowPublicEvidence), "lowpublic"),
      invoke(
        contextFor(PERSONAS.strongMaintainer, PERSONAS.partialTreeFailure),
        "strongmaintainer",
        "partialtree",
      ),
      invoke(contextFor(PERSONAS.lowPublicEvidence, secondLow), "lowpublic", "lowpublictwo"),
      invoke(context, "strongmaintainer", "sidequester", "--details"),
      invoke(context, "strongmaintainer", "sidequester", "--receipts"),
      invoke(context, "strongmaintainer", "sidequester", "--card"),
      invoke(context, "strongmaintainer", "sidequester", "--caption"),
      ...(["plain", "x", "discord", "linkedin"] as const).map((preset) =>
        invoke(context, "strongmaintainer", "sidequester", "--share", preset),
      ),
      invoke(context, "help"),
      invoke(
        { ...context, env: {}, isTty: true, terminalColumns: 80 },
        "strongmaintainer",
        "sidequester",
        "--color",
        "always",
      ),
      invoke(context, "strongmaintainer", "sidequester", "--color", "never"),
      invoke(
        { ...context, env: { NO_COLOR: "1", GITMOG_NO_MOTION: "1" }, isTty: true },
        "strongmaintainer",
        "sidequester",
      ),
      ...([60, 80, 100] as const).map((columns) =>
        invoke({ ...context, terminalColumns: columns }, "strongmaintainer", "sidequester"),
      ),
      invoke(
        contextFor(PERSONAS.rateLimited, PERSONAS.strongMaintainer),
        "ratelimited",
        "strongmaintainer",
      ),
      invoke(
        {
          ...context,
          fetchImpl: () => Promise.reject(new DOMException("synthetic timeout", "TimeoutError")),
        },
        "timeoutleft",
        "timeoutright",
      ),
    ]);
    for (const [index, output] of outputs.entries()) {
      const human = stripAnsi(`${output.stdout}\n${output.stderr}`);
      expect(classifierLabelsIn(human), `human surface ${String(index)}:\n${human}`).toEqual([]);
      for (const marker of HUMAN_TAXONOMY_MARKERS) {
        expect(human.toUpperCase(), marker).not.toContain(marker);
      }
    }

    const json = await invoke(context, "strongmaintainer", "sidequester", "--json");
    const payload = JSON.parse(json.stdout) as {
      battle: {
        left: {
          mogsona: { id: string; name: string };
          auraLeak: { id: string; name: string } | null;
        };
        right: {
          mogsona: { id: string; name: string };
          auraLeak: { id: string; name: string } | null;
        };
      };
      sourceAnalysis: {
        left: { codeDna: { label?: { id: string; name: string } } };
        right: { codeDna: { label?: { id: string; name: string } } };
      };
    };
    expect(payload.battle.right.auraLeak?.id).toBe("commit_chaos");
    expect(payload.battle.left.auraLeak).toBeNull();
    expect(ACTIVE_HUMAN_CLASSIFIER_LABELS).toContain(payload.battle.left.mogsona.name);
    expect(ACTIVE_HUMAN_CLASSIFIER_LABELS).toContain(payload.battle.right.mogsona.name);
    expect(ACTIVE_HUMAN_CLASSIFIER_LABELS).toContain(
      payload.sourceAnalysis.left.codeDna.label?.name,
    );
    expect(ACTIVE_HUMAN_CLASSIFIER_LABELS).toContain(
      payload.sourceAnalysis.right.codeDna.label?.name,
    );
  });

  it("keeps Code DNA taxonomy off compact card, caption, and share surfaces", async () => {
    const outputs = await Promise.all([
      invoke(battleContext(), "strongmaintainer", "sidequester", "--card"),
      invoke(battleContext(), "strongmaintainer", "sidequester", "--caption"),
      ...(["plain", "x", "discord", "linkedin"] as const).map((preset) =>
        invoke(battleContext(), "strongmaintainer", "sidequester", "--share", preset),
      ),
    ]);
    for (const output of outputs) {
      expect(output.stdout.toUpperCase()).not.toContain("CODE DNA");
    }
  });

  it("keeps default nouns plain and internal ids out of profile and battle output", async () => {
    const [battle, profile] = await Promise.all([
      invoke(battleContext(), "strongmaintainer", "sidequester"),
      invoke(contextFor(PERSONAS.strongMaintainer), "strongmaintainer"),
    ]);
    for (const output of [battle.stdout, profile.stdout]) {
      for (const phrase of BANNED_DEFAULT_COPY) {
        expect(output.toLowerCase(), phrase).not.toContain(phrase.toLowerCase());
      }
      expect(output).not.toMatch(INTERNAL_EVIDENCE_ID);
    }
  });

  it("resolves every visible marker to four through six claim-specific receipts", async () => {
    const result = await invoke(battleContext(), "strongmaintainer", "sidequester");
    const [claims = "", receiptsAndFooter = ""] = result.stdout.split("\nRECEIPTS\n", 2);
    const [receipts = ""] = receiptsAndFooter.split("\nMore:", 1);
    const claimMarkers = new Set(markerValues(claims));
    const receiptLines = receipts.split("\n").filter((line) => /^\[\d+\] /u.test(line));
    const receiptMarkers = new Set(receiptLines.flatMap((line) => markerValues(line)));
    expect(receiptMarkers).toEqual(claimMarkers);
    expect(receiptLines.length).toBeGreaterThanOrEqual(4);
    expect(receiptLines.length).toBeLessThanOrEqual(6);
    for (const line of receiptLines) {
      expect(line).toContain("—");
      expect(line).not.toContain("Finisher");
      expect(line).not.toMatch(/github\.com\/[^ ]+\s+(?:↔|vs)\s+github\.com\//u);
      expect(line).not.toMatch(INTERNAL_EVIDENCE_ID);
    }
  });

  it.each([60, 80, 100, 120])("stays within %i columns", async (columns) => {
    const result = await invoke(
      { ...battleContext(), terminalColumns: columns },
      "strongmaintainer",
      "sidequester",
    );
    for (const line of result.stdout.trim().split("\n")) {
      expect(Array.from(stripAnsi(line)).length, line).toBeLessThanOrEqual(columns);
    }
    expect(result.stdout).toContain("THE FIGHT");
    expect(result.stdout).toContain("THE READ");
    expect(result.stdout).toContain("RECEIPTS");
  });

  it("keeps the target hierarchy and 60/80-column density budgets", async () => {
    const [ready, limited, profile, narrow] = await Promise.all([
      invoke({ ...battleContext(), terminalColumns: 80 }, "strongmaintainer", "sidequester"),
      invoke(
        {
          ...contextFor(PERSONAS.strongMaintainer, PERSONAS.partialTreeFailure),
          terminalColumns: 80,
        },
        "strongmaintainer",
        "partialtree",
      ),
      invoke({ ...contextFor(PERSONAS.strongMaintainer), terminalColumns: 80 }, "strongmaintainer"),
      invoke({ ...battleContext(), terminalColumns: 60 }, "strongmaintainer", "sidequester"),
    ]);
    const readyLines = ready.stdout.trim().split("\n");
    expect(readyLines[0]).toBe("GIT MOG");
    expect(readyLines[1]).toContain("◆ @strongmaintainer WINS");
    expect(readyLines[2]).toBe("Coverage: @strongmaintainer 59% · @sidequester 54%");
    expect(readyLines.length).toBeGreaterThanOrEqual(24);
    expect(readyLines.length).toBeLessThanOrEqual(36);
    expect(limited.stdout.trim().split("\n").length).toBeGreaterThanOrEqual(24);
    expect(limited.stdout.trim().split("\n").length).toBeLessThanOrEqual(36);
    expect(profile.stdout.trim().split("\n").length).toBeGreaterThanOrEqual(12);
    expect(profile.stdout.trim().split("\n").length).toBeLessThanOrEqual(24);
    expect(narrow.stdout.trim().split("\n").length).toBeLessThanOrEqual(48);

    const fight = readyLines.slice(
      readyLines.indexOf("THE FIGHT") + 1,
      readyLines.indexOf("THE READ") - 1,
    );
    expect(fight).toHaveLength(3);
    const read = readyLines.slice(
      readyLines.indexOf("THE READ") + 1,
      readyLines.indexOf("CODE QUALITY · PREVIEW") - 1,
    );
    expect(read.length).toBeLessThanOrEqual(4);
  });

  it("uses plain aliases and normal-language fight comparisons", async () => {
    const result = await invoke(battleContext(), "strongmaintainer", "sidequester");
    expect(result.stdout).toContain("TOOLING");
    expect(result.stdout).toContain("TESTS");
    expect(result.stdout).toContain("COMMIT QUALITY");
    expect(result.stdout).toContain("Project automation: 3/3–0/3");
    expect(result.stdout).toContain("Automated tests: 100%–0%");
    expect(result.stdout).not.toContain("SHIP AURA");
    expect(result.stdout).not.toContain("GRINDSET");
    expect(result.stdout).not.toContain("TEST AURA");
  });

  it("renders one compact read per profile and a factual classifier-selected weakness", async () => {
    const result = await invoke(battleContext(), "strongmaintainer", "sidequester");
    const lines = result.stdout.trim().split("\n");
    const read = lines
      .slice(lines.indexOf("THE READ") + 1, lines.indexOf("CODE QUALITY · PREVIEW"))
      .join("\n");
    expect(read.match(/^@strongmaintainer\b/gmu)).toHaveLength(1);
    expect(read.match(/^@sidequester\b/gmu)).toHaveLength(1);
    expect(read).toContain("64% of sampled commit messages are one word or shorter.");
    expect(read).not.toContain("COMMIT CHAOS");
  });

  it("keeps unbounded test-to-source ratios human-readable", async () => {
    const service = await import("@gitmog/battle");
    const result = await service.runProfile({
      handle: "strongmaintainer",
      fetchImpl: contextFor(PERSONAS.strongMaintainer).fetchImpl,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    });
    if (!result.ok) throw new Error(result.error.code);
    const replaceBreadth = <
      T extends { readonly metric: string; readonly value?: number | string },
    >(
      item: T,
    ): T => (item.metric === "craft.testing.breadth" ? { ...item, value: 24.87 } : item);
    const profile = {
      ...result.profile,
      evidence: result.profile.evidence.map(replaceBreadth),
      positiveEvidence: result.profile.positiveEvidence.map(replaceBreadth),
    };
    const output = renderProfile(profile, result.sourceAnalysis, { columns: 80 });
    expect(output).toContain("Tests outnumber source files in inspected trees.");
    expect(output).not.toContain("2487%");
  });

  it("omits every source classifier identity across ready, limited, and insufficient output", async () => {
    const [ready, limited, insufficient, readyProfile] = await Promise.all([
      invoke(battleContext(), "strongmaintainer", "sidequester"),
      invoke(
        contextFor(PERSONAS.strongMaintainer, PERSONAS.partialTreeFailure),
        "strongmaintainer",
        "partialtree",
      ),
      invoke(
        contextFor(PERSONAS.lowPublicEvidence, {
          ...PERSONAS.lowPublicEvidence,
          login: "lowpublictwo",
        }),
        "lowpublic",
        "lowpublictwo",
      ),
      invoke(contextFor(PERSONAS.strongMaintainer), "strongmaintainer"),
    ]);
    for (const output of [ready.stdout, limited.stdout, insufficient.stdout, readyProfile.stdout]) {
      expect(classifierLabelsIn(output)).toEqual([]);
      expect(output).not.toContain("CODE DNA:");
    }
  });

  it("binds a visible language claim to a language-mix receipt", async () => {
    const service = await import("@gitmog/battle");
    const result = await service.runBattle({
      left: "strongmaintainer",
      right: "sidequester",
      fetchImpl: battleContext().fetchImpl,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    });
    if (!result.ok) throw new Error(result.error.code);
    const languageBattle = {
      ...result.battle,
      left: {
        ...result.battle.left,
        diagnostics: {
          ...result.battle.left.diagnostics,
          substantialLanguages: ["C"],
        },
      },
      right: {
        ...result.battle.right,
        diagnostics: {
          ...result.battle.right.diagnostics,
          substantialLanguages: ["Go", "Python", "Rust", "TypeScript"],
        },
      },
      finishingMove: {
        ...result.battle.finishingMove,
        text: "sidequester is polyglot maxxing. strongmaintainer is committed to C.",
        atomId: "polyglot_with_depth",
      },
    };
    const output = renderBattle(languageBattle, result.sourceAnalysis, result.story);
    expect(output).toContain("polyglot maxxing");
    expect(output).toContain(
      "[1] Language mix — C only vs 4 project languages (Go, Python, Rust, TypeScript)",
    );
    expect(output).not.toMatch(/^\[1\] (?:Finisher|Established projects)/mu);
  });

  it("uses semantic forced color without making losing scores red", async () => {
    const result = await invoke(
      { ...battleContext(), env: {}, isTty: true, terminalColumns: 80 },
      "strongmaintainer",
      "sidequester",
      "--color",
      "always",
    );
    for (const code of ["\u001B[32m", "\u001B[31m", "\u001B[36m", "\u001B[97m", "\u001B[2m"]) {
      expect(result.stdout).toContain(code);
    }
    expect(result.stdout).toContain("\u001B[97m0\u001B[0m");
    expect(result.stdout).not.toContain("\u001B[31m0\u001B[0m");
    const plain = stripAnsi(result.stdout);
    expect(plain).toContain("WINS");
    expect(plain).toContain("Coverage:");
    expect(plain).toContain("64% of sampled commit messages");
  });

  it("keeps cards and every share preset free of taxonomy", async () => {
    const service = await import("@gitmog/battle");
    const result = await service.runBattle({
      left: "strongmaintainer",
      right: "sidequester",
      fetchImpl: battleContext().fetchImpl,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    });
    if (!result.ok) throw new Error(result.error.code);
    const surfaces = [
      renderCard(result.battle, result.sourceAnalysis, result.story),
      ...(["plain", "x", "discord", "linkedin"] as const).map((preset) =>
        renderShare(result.battle, preset, result.sourceAnalysis, result.story),
      ),
    ];
    for (const output of surfaces) {
      expect(classifierLabelsIn(output)).toEqual([]);
      for (const marker of HUMAN_TAXONOMY_MARKERS)
        expect(output.toUpperCase(), marker).not.toContain(marker);
      expect(output).not.toMatch(INTERNAL_EVIDENCE_ID);
    }
  });

  it("keeps details technical and full receipts complete", async () => {
    const [json, details, receipts] = await Promise.all([
      invoke(battleContext(), "strongmaintainer", "sidequester", "--json"),
      invoke(battleContext(), "strongmaintainer", "sidequester", "--details"),
      invoke(battleContext(), "strongmaintainer", "sidequester", "--receipts"),
    ]);
    const payload = JSON.parse(json.stdout) as {
      battle: {
        rounds: readonly { leftScore: number | null; rightScore: number | null }[];
        left: { evidence: readonly { id: string }[] };
        right: { evidence: readonly { id: string }[] };
      };
    };
    const scored = payload.battle.rounds.filter(
      (round) => round.leftScore !== null && round.rightScore !== null,
    ).length;
    expect(details.stdout).toContain("ALL SCORED ROUNDS");
    expect(details.stdout.match(/^ {2}\d+\./gmu)).toHaveLength(scored);
    for (const axis of [
      "Direct ↔ Abstract",
      "Vibe ↔ Ritual",
      "Compact ↔ Ceremonial",
      "Application ↔ Systems",
    ]) {
      expect(details.stdout).toContain(axis);
    }
    expect(receipts.stdout).toContain("RAW RECEIPTS");
    expect(receipts.stdout).toContain("SOURCE SAMPLES");
    for (const side of ["left", "right"] as const) {
      for (const item of payload.battle[side].evidence) {
        expect(receipts.stdout).toContain(item.id);
      }
    }
  });
});
