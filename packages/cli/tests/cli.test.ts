import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
  type PersonaSpec,
} from "@gitmog/test-fixtures/github-personas";
import { describe, expect, it } from "vitest";

import { advancedUsage, run, usage, type CliContext } from "../src/cli.js";
import { createPalette, stripAnsi } from "../src/color.js";
import {
  renderBattle,
  renderCard,
  renderError,
  renderProfile,
  visibleWidth,
} from "../src/render.js";
import { DISCORD_CHARACTER_LIMIT, renderShare, X_CHARACTER_LIMIT } from "../src/share.js";
import { classifierLabelsIn } from "./classifier-labels.js";

const contextFor = (...personas: readonly PersonaSpec[]): CliContext => {
  const handlers = personas.map((persona) => ({
    login: persona.login,
    fetchImpl: createFixtureFetch(persona),
  }));
  const fetchImpl: typeof fetch = (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const found = handlers.find((handler) =>
      href.toLowerCase().includes(handler.login.toLowerCase()),
    );
    return (
      found?.fetchImpl(input, init) ??
      Promise.resolve(new Response('{"message":"Not Found"}', { status: 404 }))
    );
  };
  return {
    invokedAs: "gitmog",
    version: "0.1.0",
    env: { NO_COLOR: "1" },
    fetchImpl,
    now: () => FIXTURE_NOW_MS,
    useFilesystem: false,
    skipBudgetPreflight: true,
  };
};
const battleContext = () => contextFor(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
const invoke = (context: CliContext, ...args: readonly string[]) =>
  run(["node", "gitmog", ...args], context);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const assertAnsiIsLineBounded = (output: string): void => {
  const completeSgr = new RegExp(`${String.fromCodePoint(27)}\\[([0-9;]*)m`, "g");
  const opens = [...output.matchAll(completeSgr)].filter((match) => match[1] !== "0").length;
  const resets = [...output.matchAll(completeSgr)].filter((match) => match[1] === "0").length;
  expect(resets).toBe(opens);
  expect(output.replace(completeSgr, "")).not.toContain("\u001b");
  for (const line of output.split("\n")) {
    let styled = false;
    for (const match of line.matchAll(completeSgr)) styled = match[1] !== "0";
    expect(styled, line).toBe(false);
    if (/^[╔╠╚║]/.test(line)) expect(visibleWidth(line), line).toBe(74);
    if (line.startsWith("║")) {
      const border = line.lastIndexOf("║");
      let styledAtBorder = false;
      for (const match of line.matchAll(completeSgr)) {
        if ((match.index ?? 0) >= border) break;
        styledAtBorder = match[1] !== "0";
      }
      expect(styledAtBorder, line).toBe(false);
    }
  }
};

describe("public grammar", () => {
  it("makes every common help form friend-first and local", async () => {
    let calls = 0;
    const context = {
      ...battleContext(),
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(new Response("{}"));
      },
    };
    const [bare, help, long, short] = await Promise.all([
      invoke(context),
      invoke(context, "help"),
      invoke(context, "--help"),
      invoke(context, "-h"),
    ]);
    expect([bare, help, long, short].every((result) => result.exitCode === 0)).toBe(true);
    expect(new Set([bare.stdout, help.stdout, long.stdout, short.stdout])).toHaveLength(1);
    expect(calls).toBe(0);
    expect(help.stdout).toContain("npx -y gitmog <left> <right>");
    expect(help.stdout).toContain("npx -y gitmog <username>");
    expect(help.stdout).toContain("Try a famous matchup:");
    expect(help.stdout).toContain("npx -y gitmog torvalds gvanrossum");
    expect(help.stdout).toContain("npx -y gitmog karpathy geohot");
    expect(help.stdout.indexOf("npx -y gitmog <left> <right>")).toBeLessThan(
      help.stdout.indexOf("Try a famous matchup:"),
    );
    expect(help.stdout).toContain("Coverage is the share of the public scorecard");
    expect(help.stdout).toContain("one-time sign-in");
    expect(help.stdout).toContain("not a hiring score");
    expect(help.stdout).toContain("--details");
    expect(help.stdout).toContain("--receipts");
    expect(help.stdout).toContain("--card");
    expect(help.stdout).toContain("--share");
    expect(help.stdout).toContain("--export");
    expect(help.stdout).not.toContain("--json");
    expect(help.stdout).not.toContain("bounded deterministic analysis");
    expect(help.stdout).not.toContain("provider-free");
    expect(help.stdout).not.toContain("battle <left>");
    expect(usage("git mog")).toContain("git mog <left> <right>");
    expect(
      help.stdout.split("\n").findIndex((line) => line.includes("npx -y gitmog")),
    ).toBeLessThan(8);
    expect(help.stdout.split("\n").every((line) => line.length <= 80)).toBe(true);
  });

  it("keeps advanced options behind --help-all with zero GitHub calls", async () => {
    let calls = 0;
    const result = await invoke(
      {
        ...battleContext(),
        fetchImpl: () => {
          calls += 1;
          return Promise.resolve(new Response("{}"));
        },
      },
      "--help-all",
    );
    expect(result).toEqual({ exitCode: 0, stdout: advancedUsage("gitmog"), stderr: "" });
    expect(calls).toBe(0);
    for (const option of [
      "--json",
      "--refresh",
      "--no-cache",
      "--color",
      "--no-motion",
      "--roast",
      "--caption",
      "--sign-in",
      "--anonymous",
      "--no-prompt",
      "--cache-info",
      "--clear-cache",
      "--export",
      "--version",
    ]) {
      expect(result.stdout).toContain(option);
    }
  });

  it("routes no arguments to friendly help with zero GitHub calls", async () => {
    let calls = 0;
    const result = await invoke({
      ...battleContext(),
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(new Response("{}"));
      },
    });
    expect(result.exitCode).toBe(0);
    expect(calls).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(usage("gitmog"));
  });

  it.each([
    ["torvalds", "gvanrossum"],
    ["karpathy", "geohot"],
  ] as const)(
    "parses famous fixture matchup %s versus %s through ordinary battle analysis",
    async (left, right) => {
      const leftPersona = { ...PERSONAS.strongMaintainer, login: left };
      const rightPersona = { ...PERSONAS.manyTinyRepos, login: right };
      const result = await invoke(contextFor(leftPersona, rightPersona), left, right, "--json");
      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        battle: {
          left: { username: string };
          right: { username: string };
          scoringVersion: string;
        };
        sourceAnalysis: { status: string };
      };
      expect(payload.battle).toMatchObject({
        left: { username: left },
        right: { username: right },
        scoringVersion: "0.1.0-fast-scan",
      });
      expect(["ready", "partial", "insufficient"]).toContain(payload.sourceAnalysis.status);
    },
  );

  it("normalizes raw, @handle, and profile URL forms before analysis", async () => {
    const context = battleContext();
    const canonical = await invoke(context, "strongmaintainer", "sidequester", "--json");
    for (const [left, right] of [
      ["@strongmaintainer", "@sidequester"],
      ["https://github.com/strongmaintainer", "https://github.com/sidequester"],
      ["https://github.com/strongmaintainer/", "https://github.com/sidequester/"],
    ] as const) {
      const result = await invoke(context, left, right, "--json");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(canonical.stdout);
    }
  });

  it.each([
    "https://github.com/octocat/hello-world",
    "https://github.com/octocat/issues/1",
    "https://gist.github.com/octocat/deadbeef",
    "https://example.com/octocat",
    "https://github.com.example/octocat",
    "https://user:password@github.com/octocat",
    "https://github.com/octocat/extra",
    "https://github.com/%6fctocat",
    " octocat",
    "octocat ",
    "octo\u0000cat",
    "octo--cat",
    "@",
  ] as const)("rejects unsafe identity %s locally", async (value) => {
    let calls = 0;
    const result = await invoke(
      {
        ...battleContext(),
        fetchImpl: () => {
          calls += 1;
          return Promise.resolve(new Response("{}"));
        },
      },
      value,
      "--json",
    );
    expect(result.exitCode).toBe(2);
    expect(calls).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ error: { code: "usage" } });
  });

  it("rejects the same account after normalization without collection", async () => {
    let calls = 0;
    const result = await invoke(
      {
        ...battleContext(),
        fetchImpl: () => {
          calls += 1;
          return Promise.resolve(new Response("{}"));
        },
      },
      "@Alice",
      "https://github.com/alice/",
      "--json",
    );
    expect(result.exitCode).toBe(2);
    expect(calls).toBe(0);
  });

  it("routes direct and installed forms to byte-identical JSON", async () => {
    const direct = await invoke(battleContext(), "strongmaintainer", "sidequester", "--json");
    const installed = await invoke(
      { ...battleContext(), invokedAs: "git mog" },
      "strongmaintainer",
      "sidequester",
      "--json",
    );
    expect(direct.exitCode).toBe(0);
    expect(installed.stdout).toBe(direct.stdout);
  });

  it("rejects a third positional and every removed option with exit 2", async () => {
    const removedMode = ["ultra", "think"].join("");
    expect((await invoke(battleContext(), "alice", "bob", removedMode)).exitCode).toBe(2);
    for (const flag of [
      `--${["ora", "cle"].join("")}`,
      `--${removedMode}-${["re", "mix"].join("")}`,
      `--${removedMode}-${["mo", "del"].join("")}`,
      "--yes",
      "--no-pull",
    ]) {
      const result = await invoke(battleContext(), "alice", "bob", flag);
      expect(result.exitCode, flag).toBe(2);
    }
  });

  it.each(["help", "auth", "setup", "doctor", "cache", "login"] as const)(
    "accepts %s as a valid opponent handle",
    async (opponent) => {
      const left = { ...PERSONAS.strongMaintainer, login: "alice" };
      const right = { ...PERSONAS.manyTinyRepos, login: opponent };
      const baseContext = contextFor(left, right);
      let calls = 0;
      const result = await invoke(
        {
          ...baseContext,
          fetchImpl: (input, init) => {
            calls += 1;
            return baseContext.fetchImpl!(input, init);
          },
        },
        left.login,
        right.login,
        "--json",
      );
      expect(result.exitCode).toBe(0);
      expect(calls).toBeGreaterThan(0);
      expect(JSON.parse(result.stdout)).toHaveProperty("battle");
    },
  );

  it("does not steal battle when it is a valid opponent handle", async () => {
    const left = { ...PERSONAS.strongMaintainer, login: "battle" };
    const right = { ...PERSONAS.manyTinyRepos, login: "alice" };
    const result = await invoke(contextFor(left, right), "battle", "alice", "--json");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      battle: { left: { username: "battle" }, right: { username: "alice" } },
    });
  });

  it.each([
    ["caption-invalid-share", ["alice", "bob", "--caption", "--share", "bogus"], false],
    ["caption-duplicate-share", ["alice", "bob", "--caption", "--share", "plain"], false],
    ["card-share", ["alice", "bob", "--card", "--share", "x"], false],
    ["card-caption", ["alice", "bob", "--card", "--caption"], false],
    ["card-json", ["alice", "bob", "--card", "--json"], true],
    ["share-json", ["alice", "bob", "--share", "x", "--json"], true],
    ["card-receipts", ["alice", "bob", "--card", "--receipts"], false],
    ["share-receipts", ["alice", "bob", "--share", "plain", "--receipts"], false],
    ["json-receipts", ["alice", "bob", "--json", "--receipts"], true],
    ["card-details", ["alice", "bob", "--card", "--details"], false],
    ["share-details", ["alice", "bob", "--share", "plain", "--details"], false],
    ["json-details", ["alice", "bob", "--json", "--details"], true],
    ["card-export", ["alice", "bob", "--card", "--export", "battle.html"], false],
    ["share-export", ["alice", "bob", "--share", "x", "--export", "battle.svg"], false],
    ["export-receipts", ["alice", "bob", "--export", "battle.html", "--receipts"], false],
    ["export-details", ["alice", "bob", "--export", "battle.svg", "--details"], false],
  ] as const)("rejects %s before collection", async (_name, args, json) => {
    let calls = 0;
    const result = await invoke(
      {
        ...battleContext(),
        fetchImpl: () => {
          calls += 1;
          return Promise.resolve(new Response("{}", { status: 500 }));
        },
      },
      ...args,
    );
    expect(result.exitCode).toBe(2);
    expect(calls).toBe(0);
    if (json) {
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "usage", retryable: false },
      });
    } else {
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("INVALID USAGE");
      expect(result.stderr).toContain("Run: gitmog --help");
    }
  });

  it.each(["battle.txt", " battle.html", "battle.svg ", "bad\npath.html"])(
    "rejects export destination %j before collection",
    async (destination) => {
      let calls = 0;
      const result = await invoke(
        {
          ...battleContext(),
          fetchImpl: () => {
            calls += 1;
            return Promise.resolve(new Response("{}"));
          },
        },
        "alice",
        "bob",
        "--export",
        destination,
        "--json",
      );
      expect(result.exitCode).toBe(2);
      expect(calls).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ error: { code: "usage" } });
    },
  );

  it("writes HTML and SVG exports, supports JSON metadata, and refuses overwrite locally", async () => {
    const directory = mkdtempSync(join(tmpdir(), "gitmog-cli-export-"));
    try {
      const html = await invoke(
        { ...battleContext(), cwd: directory },
        "strongmaintainer",
        "sidequester",
        "--export",
        "results with spaces/battle.html",
      );
      expect(html).toMatchObject({ exitCode: 0, stderr: "" });
      const htmlPath = html.stdout.replace(/^Exported HTML: /u, "").trim();
      expect(readFileSync(htmlPath, "utf8")).toContain("PUBLIC REPO GAP");

      const svg = await invoke(
        { ...battleContext(), cwd: directory },
        "strongmaintainer",
        "sidequester",
        "--export",
        "battle.svg",
        "--json",
      );
      expect(svg).toMatchObject({ exitCode: 0, stderr: "" });
      const payload = JSON.parse(svg.stdout) as {
        export: { format: string; path: string; bytes: number; sha256: string };
      };
      expect(payload.export).toMatchObject({
        format: "svg",
        path: join(realpathSync(directory), "battle.svg"),
      });
      expect(payload.export.bytes).toBeGreaterThan(0);
      expect(payload.export.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(readFileSync(payload.export.path, "utf8")).toContain('role="img"');

      let calls = 0;
      const existing = await invoke(
        {
          ...battleContext(),
          cwd: directory,
          fetchImpl: () => {
            calls += 1;
            return Promise.resolve(new Response("{}"));
          },
        },
        "strongmaintainer",
        "sidequester",
        "--export",
        "battle.svg",
        "--json",
      );
      expect(existing.exitCode).toBe(2);
      expect(calls).toBe(0);
      expect(JSON.parse(existing.stdout)).toMatchObject({ error: { code: "usage" } });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["direct", ["alice", "Alice"]],
    ["installed", ["alice", "Alice"]],
  ] as const)("routes same-handle %s syntax through usage with zero calls", async (form, args) => {
    let calls = 0;
    const baseContext = {
      ...battleContext(),
      ...(form === "installed" ? { invokedAs: "git mog" } : {}),
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(new Response("{}"));
      },
    };
    const human = await invoke(baseContext, ...args);
    const json = await invoke(baseContext, ...args, "--json");
    expect(human.exitCode).toBe(2);
    expect(human.stderr).toContain("Both handles are the same account.");
    expect(human.stderr).toContain("INVALID USAGE");
    expect(human.stderr).toContain(`Run: ${form === "installed" ? "git mog" : "gitmog"} --help`);
    expect(json.exitCode).toBe(2);
    expect(json.stderr).toBe("");
    expect(JSON.parse(json.stdout)).toEqual({
      error: {
        code: "usage",
        message: "Both handles are the same account.",
        retryable: false,
      },
    });
    expect(calls).toBe(0);
  });
});

describe("complete result", () => {
  it("does not inject famous onboarding handles into completed unrelated battles", async () => {
    const result = await invoke(battleContext(), "strongmaintainer", "sidequester");
    expect(result.exitCode).toBe(0);
    for (const handle of ["torvalds", "gvanrossum", "karpathy", "geohot"]) {
      expect(result.stdout).not.toContain(handle);
    }
  });

  it("runs source analysis automatically and emits the final JSON contract", async () => {
    const result = await invoke(battleContext(), "strongmaintainer", "sidequester", "--json");
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "battle",
      "presentationVerdict",
      "qualityPreview",
      "sourceAnalysis",
      "story",
    ]);
    expect(payload.presentationVerdict).toMatchObject({
      version: "1.0.0-coverage-aware",
      band: "qualified",
      label: "PUBLIC REPO GAP",
      minimumCoverage: 54,
      coverageDifference: 5,
    });
    expect(isRecord(payload.sourceAnalysis)).toBe(true);
    expect(isRecord(payload.story)).toBe(true);
    if (!isRecord(payload.sourceAnalysis) || !isRecord(payload.story)) {
      throw new Error("Complete JSON objects are missing.");
    }
    expect(["ready", "partial", "insufficient"]).toContain(payload.sourceAnalysis.status);
    expect(isRecord(payload.sourceAnalysis.left)).toBe(true);
    expect(isRecord(payload.sourceAnalysis.right)).toBe(true);
    expect(typeof payload.story.planId).toBe("string");
    expect(isRecord(payload.story.finisher)).toBe(true);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('"content"');
    expect(serialized).not.toContain('"scanType"');
    for (const key of [
      "provider",
      ["mo", "del"].join(""),
      "inference",
      ["re", "mix"].join(""),
      "endpoint",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(`"${key}"`);
    }
  });

  it("renders the result first with three plain fight rows and compact receipts", async () => {
    const result = await invoke(battleContext(), "strongmaintainer", "sidequester");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.startsWith("GIT MOG\n")).toBe(true);
    expect(result.stdout).toContain("◆ @strongmaintainer WINS");
    expect(result.stdout).toContain("92–39 · PUBLIC REPO GAP");
    expect(result.stdout).not.toContain("NUCLEAR");
    expect(result.stdout).toContain("Coverage: @strongmaintainer 59% · @sidequester 54%");
    expect(result.stdout).toContain("THE FIGHT");
    expect(result.stdout.match(/^(?:TOOLING|TESTS|COMMIT QUALITY)\s+/gmu)).toHaveLength(3);
    expect(result.stdout).toContain("THE READ");
    expect(result.stdout).not.toContain("CODE DNA ·");
    expect(result.stdout).toContain("RECEIPTS");
    expect(result.stdout).toContain("More: --details · --receipts · --share x");
    expect(result.stdout).not.toContain("requests 32/32");
    expect(result.stdout).not.toContain("Deterministic public-GitHub analysis");
    expect(result.stdout).not.toContain("NOT SCORED");
    expect(result.stdout.trim().split("\n").length).toBeGreaterThanOrEqual(24);
    expect(result.stdout.trim().split("\n").length).toBeLessThanOrEqual(36);
  });

  it("keeps required support outside the optional receipt presentation", async () => {
    const normal = await invoke(battleContext(), "strongmaintainer", "sidequester");
    const repeated = await invoke(battleContext(), "strongmaintainer", "sidequester");
    const full = await invoke(battleContext(), "strongmaintainer", "sidequester", "--receipts");
    const details = await invoke(battleContext(), "strongmaintainer", "sidequester", "--details");
    const json = await invoke(battleContext(), "strongmaintainer", "sidequester", "--json");
    const jsonWithReceipts = await invoke(
      battleContext(),
      "strongmaintainer",
      "sidequester",
      "--json",
      "--receipts",
    );
    const payload = JSON.parse(json.stdout) as {
      battle: {
        left: { evidence: readonly { id: string; category: string }[] };
        right: { evidence: readonly { id: string; category: string }[] };
        rounds: readonly {
          categoryId: string;
          leftScore: number | null;
          rightScore: number | null;
        }[];
      };
    };
    const decisiveCategories = payload.battle.rounds
      .filter(
        (round): round is typeof round & { leftScore: number; rightScore: number } =>
          round.leftScore !== null && round.rightScore !== null,
      )
      .toSorted(
        (left, right) =>
          Math.abs(right.leftScore - right.rightScore) - Math.abs(left.leftScore - left.rightScore),
      )
      .slice(0, 3)
      .map((round) => round.categoryId);
    expect(normal.stdout).toContain("RECEIPTS");
    expect(normal.stdout).toMatch(/^\[1\] /mu);
    expect(repeated.stdout).toBe(normal.stdout);
    expect(jsonWithReceipts.exitCode).toBe(2);
    expect(JSON.parse(jsonWithReceipts.stdout)).toEqual({
      error: {
        code: "usage",
        message: "--receipts is available only for normal terminal output.",
        retryable: false,
      },
    });
    expect(details.stdout).toContain("ALL SCORED ROUNDS");
    expect(details.stdout).toContain("THE READ");
    expect(details.stdout).toContain("Direct ↔ Abstract");
    expect(full.stdout).toContain("RAW RECEIPTS");
    expect(full.stdout).toContain("SOURCE SAMPLES");
    expect(full.stdout).toContain("VERSIONS");
    for (const side of ["left", "right"] as const)
      for (const item of payload.battle[side].evidence) {
        expect(normal.stdout).not.toContain(item.id);
        expect(full.stdout).toContain(item.id);
      }
    expect(decisiveCategories).toHaveLength(3);
  });

  it("prints JSON only and never leaks ANSI", async () => {
    const result = await invoke(
      { ...battleContext(), env: {}, isTty: true },
      "strongmaintainer",
      "sidequester",
      "--json",
      "--color",
      "always",
    );
    expect((): void => {
      void (JSON.parse(result.stdout) as unknown);
    }).not.toThrow();
    expect(result.stdout).not.toContain("\u001b[");
    expect(result.stderr).toBe("");
  });

  it.each([39, 30])(
    "fits and closes ANSI for two %i-character handles on card and battle output",
    async (length) => {
      const left = { ...PERSONAS.strongMaintainer, login: "a".repeat(length) };
      const right = { ...PERSONAS.manyTinyRepos, login: "b".repeat(length) };
      const context = { ...contextFor(left, right), env: {}, isTty: true };
      const [card, battle, never, noColor, automatic, share, json] = await Promise.all([
        invoke(context, left.login, right.login, "--card", "--color", "always"),
        invoke(context, left.login, right.login, "--color", "always"),
        invoke(context, left.login, right.login, "--card", "--color", "never"),
        invoke(
          { ...context, env: { NO_COLOR: "1" } },
          left.login,
          right.login,
          "--card",
          "--color",
          "always",
        ),
        invoke(context, left.login, right.login, "--color", "auto"),
        invoke(context, left.login, right.login, "--share", "plain", "--color", "always"),
        invoke(context, left.login, right.login, "--json", "--color", "always"),
      ]);
      for (const result of [card, battle, never, noColor, automatic, share, json]) {
        expect(result.exitCode).toBe(0);
      }
      expect(card.stdout).not.toContain("\u001b[");
      expect(battle.stdout).toContain("\u001b[");
      expect(automatic.stdout).toContain("\u001b[");
      assertAnsiIsLineBounded(battle.stdout);
      assertAnsiIsLineBounded(automatic.stdout);
      expect(card.stdout).toBe(never.stdout);
      expect(never.stdout).not.toContain("\u001b[");
      expect(noColor.stdout).toBe(never.stdout);
      expect(share.stdout).not.toContain("\u001b[");
      expect(json.stdout).not.toContain("\u001b[");
    },
  );

  it("keeps profile styles bounded while omitting injected classifier labels", async () => {
    const persona = { ...PERSONAS.strongMaintainer, login: "p".repeat(39) };
    const service = await import("@gitmog/battle");
    const result = await service.runProfile({
      handle: persona.login,
      fetchImpl: contextFor(persona).fetchImpl,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    });
    if (!result.ok) throw new Error(result.error.code);
    const longMogsona = "MOGSONA ".repeat(20).trim();
    const longCodeDna = "CODE DNA ".repeat(20).trim();
    const profile = {
      ...result.profile,
      mogsona: { ...result.profile.mogsona, name: longMogsona },
    };
    const source =
      result.sourceAnalysis.status !== "insufficient" && result.sourceAnalysis.label !== undefined
        ? {
            ...result.sourceAnalysis,
            label: { ...result.sourceAnalysis.label, name: longCodeDna },
          }
        : result.sourceAnalysis;
    const output = renderProfile(profile, source, { palette: createPalette(true) });
    expect(stripAnsi(output)).not.toContain(longCodeDna);
    expect(stripAnsi(output)).not.toContain(longMogsona);
    assertAnsiIsLineBounded(output);
  });

  it("runs the one-profile Code DNA path automatically", async () => {
    const result = await invoke(
      contextFor(PERSONAS.strongMaintainer),
      "strongmaintainer",
      "--json",
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as unknown;
    expect(isRecord(parsed)).toBe(true);
    if (
      !isRecord(parsed) ||
      !isRecord(parsed.profile) ||
      !isRecord(parsed.sourceAnalysis) ||
      !isRecord(parsed.requestBudget)
    ) {
      throw new Error("Profile JSON objects are missing.");
    }
    expect(parsed.profile.username).toBe("strongmaintainer");
    expect(["ready", "partial", "insufficient"]).toContain(parsed.sourceAnalysis.status);
    expect(parsed.requestBudget.total).toBeLessThanOrEqual(parsed.requestBudget.cap as number);

    const terminal = await invoke(contextFor(PERSONAS.strongMaintainer), "strongmaintainer");
    const details = await invoke(
      contextFor(PERSONAS.strongMaintainer),
      "strongmaintainer",
      "--details",
    );
    const receipts = await invoke(
      contextFor(PERSONAS.strongMaintainer),
      "strongmaintainer",
      "--receipts",
    );
    expect(terminal.stdout).toContain("Coverage:");
    expect(terminal.stdout).toContain("THE READ");
    expect(terminal.stdout).not.toContain("directAbstract");
    expect(terminal.stdout).not.toContain("SOURCE SAMPLES");
    expect(details.stdout).toContain("Direct ↔ Abstract");
    expect(details.stdout).not.toContain("directAbstract");
    expect(receipts.stdout).toContain("SOURCE SAMPLES");
  });

  it("keeps share output plain and uses one reproduction command", async () => {
    const result = await invoke(battleContext(), "strongmaintainer", "sidequester", "--share", "x");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("npx -y gitmog strongmaintainer sidequester");
    expect(result.stdout.match(/npx -y gitmog/g)).toHaveLength(1);
    expect(result.stdout).not.toContain("\u001b[");
    expect(result.stdout).toContain("SCORE ");
    expect(result.stdout).toContain("COVERAGE");
    expect(result.stdout).not.toContain("NORMALIZED");
    expect(result.stdout).not.toContain("MEASURED");
    expect(result.stdout).not.toContain("CODE DNA");
  });

  it.each(["clean", "spicy", "unhinged"] as const)(
    "renders the authoritative %s challenge commands without reconstruction",
    async (roast) => {
      const service = await import("@gitmog/battle");
      const result = await service.runBattle({
        left: "strongmaintainer",
        right: "sidequester",
        roast,
        fetchImpl: battleContext().fetchImpl,
        cache: null,
        now: () => FIXTURE_NOW_MS,
      });
      if (!result.ok) throw new Error(result.error.code);
      const terminal = renderBattle(result.battle, result.sourceAnalysis, result.story);
      const card = renderCard(result.battle, result.sourceAnalysis, result.story);
      const roastFlag = roast === "spicy" ? "" : ` --roast ${roast}`;
      expect(terminal).toContain(`Rematch: gitmog strongmaintainer sidequester${roastFlag}`);
      expect(terminal).toContain(`Next: gitmog strongmaintainer <handle>${roastFlag}`);
      expect(terminal).toContain("--share x");
      expect(card).toContain(result.battle.challenge.canonical);
      expect(renderShare(result.battle, "x", result.sourceAnalysis, result.story)).toContain(
        result.battle.challenge.canonical,
      );
      const roastArgs = roast === "spicy" ? [] : ["--roast", roast];
      const baseArgs = ["strongmaintainer", "sidequester", ...roastArgs] as const;
      const [defaultOutput, receiptOutput, cardOutput, shareOutput] = await Promise.all([
        invoke(battleContext(), ...baseArgs),
        invoke(battleContext(), ...baseArgs, "--receipts"),
        invoke(battleContext(), ...baseArgs, "--card"),
        invoke(battleContext(), ...baseArgs, "--share", "x"),
      ]);
      for (const output of [defaultOutput, receiptOutput]) {
        expect(output.stdout).toContain(`Rematch: gitmog strongmaintainer sidequester${roastFlag}`);
        expect(output.stdout).toContain(`Next: gitmog strongmaintainer <handle>${roastFlag}`);
        expect(output.stdout).toContain("--share x");
      }
      expect(cardOutput.stdout).toContain(result.battle.challenge.canonical);
      expect(shareOutput.stdout).toContain(result.battle.challenge.canonical);
    },
  );

  it("renders GitHub-originated control characters as visible inert text", async () => {
    const service = await import("@gitmog/battle");
    const result = await service.runBattle({
      left: "strongmaintainer",
      right: "sidequester",
      fetchImpl: battleContext().fetchImpl,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    });
    if (!result.ok) throw new Error(result.error.code);
    const path =
      "src/混合\\nline\r\n\u001b[2J\u001b]8;;https://evil.example\u0007link\u001b]8;;\u0007bell\u0008.ts";
    const sample = result.sourceAnalysis.left.samples[0];
    const evidence = result.battle.left.evidence[0];
    if (sample === undefined || evidence === undefined) throw new Error("fixture support missing");
    const unsafeSample = { ...sample, repository: `owner/repo\u001b]2;title\u0007`, path };
    const unsafeSource = {
      ...result.sourceAnalysis,
      left: {
        ...result.sourceAnalysis.left,
        samples: [unsafeSample, ...result.sourceAnalysis.left.samples.slice(1)],
        codeDna: {
          ...result.sourceAnalysis.left.codeDna,
          samples: [unsafeSample, ...result.sourceAnalysis.left.codeDna.samples.slice(1)],
        },
      },
    };
    const unsafeEvidence = {
      ...evidence,
      detail: `path ${path}`,
      sourceUrl: `https://github.com/example/repo/${path}`,
    };
    const unsafeBattle = {
      ...result.battle,
      left: {
        ...result.battle.left,
        evidence: [unsafeEvidence, ...result.battle.left.evidence.slice(1)],
      },
    };
    const human = [
      renderProfile(unsafeBattle.left, unsafeSource.left.codeDna, { receipts: true }),
      renderBattle(unsafeBattle, unsafeSource, result.story, { receipts: true }),
      renderCard(unsafeBattle, unsafeSource, result.story),
      ...(["plain", "x", "discord", "linkedin"] as const).map((preset) =>
        renderShare(unsafeBattle, preset, unsafeSource, result.story),
      ),
    ];
    for (const output of human) {
      expect(output).not.toContain("\u001b[2J");
      expect(output).not.toContain("\u001b]");
      expect(output).not.toContain("\u0007");
      expect(output).not.toContain("\u0008");
      expect(output).not.toContain("混合\nline");
    }
    expect(human.join("\n")).toContain("混合\\nline\\r\\n\\x1b[2J");
    for (const line of human[2]!.split("\n").filter((entry) => entry.startsWith("║"))) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(74);
    }
  });

  it("keeps JSON valid and naturally escaped for adversarial source paths", async () => {
    const path = "src/混合\nline\r\n\u001b[2J\u001b]8;;https://evil.example\u0007link\u0008.ts";
    const persona: PersonaSpec = {
      ...PERSONAS.strongMaintainer,
      login: "controlpath",
      trees: { orchestrator: [path] },
      sourceFiles: {
        orchestrator: {
          [path]: "export function safe(value: string) { return value.trim(); }\n".repeat(40),
        },
      },
    };
    const result = await invoke(contextFor(persona), persona.login, "--json");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("\u001b[2J");
    expect(result.stdout).not.toContain("\u0007");
    const payload = JSON.parse(result.stdout) as {
      sourceAnalysis: { samples: readonly { path: string }[] };
    };
    expect(payload.sourceAnalysis.samples[0]?.path).toBe(path);
    expect(result.stdout).toContain("\\u001b[2J");
  });

  it("uses canonical metadata/repository copy on zero-sample and one-sided battles", async () => {
    const lowLeft: PersonaSpec = { ...PERSONAS.lowPublicEvidence, login: "lowleft" };
    const lowRight: PersonaSpec = { ...PERSONAS.lowPublicEvidence, login: "lowright" };
    for (const [left, right, expectedStatus, expectedPresentation] of [
      [lowLeft, lowRight, "insufficient", "INCOMPLETE TAPE"],
      [PERSONAS.strongMaintainer, lowRight, "partial", "LIMITED READ"],
    ] as const) {
      const context = contextFor(left, right);
      const json = await invoke(context, left.login, right.login, "--json");
      const payload = JSON.parse(json.stdout) as {
        battle: { finishingMove: { text: string } };
        sourceAnalysis: {
          status: string;
          left: { samples: readonly unknown[] };
          right: { samples: readonly unknown[] };
        };
        story: {
          basis: string;
          planId: string | null;
          candidatePlanIds: readonly string[];
          sampleIds: readonly string[];
          leftRead: unknown;
          rightRead: unknown;
          finisher: { text: string };
        };
      };
      expect(payload.sourceAnalysis.status).toBe(expectedStatus);
      expect(payload.story).toMatchObject({
        basis: "canonical",
        planId: null,
        candidatePlanIds: [],
        sampleIds: [],
        leftRead: null,
        rightRead: null,
      });
      expect(payload.story.finisher.text).toBe(payload.battle.finishingMove.text);
      const surfaces = [
        await invoke(contextFor(left, right), left.login, right.login),
        await invoke(contextFor(left, right), left.login, right.login, "--card"),
        await invoke(contextFor(left, right), left.login, right.login, "--share", "plain"),
      ];
      for (const surface of surfaces) {
        expect(surface.stdout).toContain(expectedPresentation);
        expect(surface.stdout).not.toContain("NUCLEAR");
        expect(surface.stdout).not.toMatch(/code signature|compact source|source style/i);
      }
    }
  });

  it("keeps every canonical category, including null-score rounds, in JSON", async () => {
    const result = await invoke(battleContext(), "strongmaintainer", "sidequester", "--json");
    const payload = JSON.parse(result.stdout) as {
      battle: {
        scoringVersion: string;
        margin: number;
        winner: string;
        verdictClass: string;
        verdictLabel: string;
        rounds: readonly {
          categoryId: string;
          leftScore: number | null;
          rightScore: number | null;
        }[];
        left: {
          categories: readonly unknown[];
          overallScore: number;
          confidence: { measuredWeight: number };
        };
        right: { overallScore: number; confidence: { measuredWeight: number } };
      };
      presentationVerdict: { version: string; band: string; label: string };
    };
    expect(payload.battle.rounds).toHaveLength(payload.battle.left.categories.length);
    expect(
      payload.battle.rounds.some((round) => round.leftScore === null || round.rightScore === null),
    ).toBe(true);
    expect(payload.battle).toMatchObject({
      scoringVersion: "0.1.0-fast-scan",
      winner: "left",
      margin: 53,
      verdictClass: "nuclear-repo-gap",
      verdictLabel: "NUCLEAR REPO GAP",
      left: { overallScore: 92, confidence: { measuredWeight: 59 } },
      right: { overallScore: 39, confidence: { measuredWeight: 54 } },
    });
    expect(payload.presentationVerdict).toMatchObject({
      version: "1.0.0-coverage-aware",
      band: "qualified",
      label: "PUBLIC REPO GAP",
    });
    const terminal = await invoke(battleContext(), "strongmaintainer", "sidequester");
    expect(terminal.stdout).not.toContain("NOT SCORED");
  });

  it("keeps visible terminal and card claims behind compact numbered support", async () => {
    const json = await invoke(battleContext(), "strongmaintainer", "sidequester", "--json");
    const payload = JSON.parse(json.stdout) as {
      story: {
        finisher: {
          text: string;
          primaryEvidenceId: string;
          evidenceIds: string[];
          sampleIds: string[];
        };
        leftRead: {
          text: string;
          primaryEvidenceId: string;
          evidenceIds: string[];
          sampleIds: string[];
        };
        rightRead: {
          text: string;
          primaryEvidenceId: string;
          evidenceIds: string[];
          sampleIds: string[];
        };
      };
    };
    const normal = await invoke(battleContext(), "strongmaintainer", "sidequester");
    const details = await invoke(battleContext(), "strongmaintainer", "sidequester", "--details");
    expect(normal.stdout).toContain("RECEIPTS");
    expect(normal.stdout).toMatch(/» .+ \[1\]/u);
    expect(normal.stdout).toMatch(/^\[1\] /mu);
    for (const claim of [payload.story.finisher, payload.story.leftRead, payload.story.rightRead]) {
      expect(normal.stdout).not.toContain(claim.primaryEvidenceId);
      for (const sampleId of claim.sampleIds) expect(normal.stdout).not.toContain(sampleId);
    }
    const flatDetails = details.stdout.replace(/\s+/g, " ");
    for (const read of [payload.story.leftRead, payload.story.rightRead])
      if (classifierLabelsIn(read.text).length > 0) expect(flatDetails).not.toContain(read.text);
      else expect(flatDetails).toContain(read.text);

    const card = await invoke(battleContext(), "strongmaintainer", "sidequester", "--card");
    expect(card.stdout.replace(/[│]/gu, " ").replace(/\s+/gu, " ")).toMatch(/» .+ \[1\]/u);
    expect(card.stdout).toMatch(/│ \[1\] /u);
    expect(card.stdout).not.toContain(payload.story.finisher.primaryEvidenceId);
  });

  it("renders all four source receipts when a visible finisher references four samples", async () => {
    const service = await import("@gitmog/battle");
    const result = await service.runBattle({
      left: "strongmaintainer",
      right: "sidequester",
      fetchImpl: battleContext().fetchImpl,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    });
    if (!result.ok) throw new Error(result.error.code);
    const sampleIds = [
      ...result.sourceAnalysis.left.samples,
      ...result.sourceAnalysis.right.samples,
    ]
      .slice(0, 4)
      .map((sample) => sample.sampleId);
    expect(sampleIds).toHaveLength(4);
    const story = {
      ...result.story,
      finisher: { ...result.story.finisher, sampleIds },
    };
    const surfaces = [
      renderShare(result.battle, "plain", result.sourceAnalysis, story),
      renderShare(result.battle, "discord", result.sourceAnalysis, story),
    ];
    for (const output of surfaces) {
      expect(output.replace(/\s+/g, " ")).toContain(story.finisher.text);
      expect(output).toContain("[1]");
      for (const sampleId of sampleIds) expect(output).not.toContain(sampleId);
      for (const sample of [
        ...result.sourceAnalysis.left.samples,
        ...result.sourceAnalysis.right.samples,
      ].filter((entry) => sampleIds.includes(entry.sampleId))) {
        expect(output).toContain(sample.repository);
      }
    }
  });

  it("never renders a story claim with an unknown evidence or sample id on any surface", async () => {
    const service = await import("@gitmog/battle");
    const result = await service.runBattle({
      left: "strongmaintainer",
      right: "sidequester",
      fetchImpl: battleContext().fetchImpl,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    });
    if (!result.ok) throw new Error(result.error.code);
    const unknownText = "This unsupported claim must not reach the card.";
    const unsupportedStory = {
      ...result.story,
      finisher: {
        ...result.story.finisher,
        text: unknownText,
        primaryEvidenceId: "unknown-evidence",
        evidenceIds: ["unknown-evidence"],
        sampleIds: ["unknown-sample"],
      },
    };
    const outputs = [
      renderBattle(result.battle, result.sourceAnalysis, unsupportedStory),
      renderCard(result.battle, result.sourceAnalysis, unsupportedStory),
      ...(["plain", "x", "discord", "linkedin"] as const).map((preset) =>
        renderShare(result.battle, preset, result.sourceAnalysis, unsupportedStory),
      ),
    ];
    for (const output of outputs) {
      expect(output).not.toContain(unknownText);
      expect(output).not.toContain("unknown-evidence");
      expect(output).not.toContain("unknown-sample");
    }
  });

  it("suppresses unsupported profile identities instead of detaching them from receipts", async () => {
    const service = await import("@gitmog/battle");
    const result = await service.runProfile({
      handle: "strongmaintainer",
      fetchImpl: contextFor(PERSONAS.strongMaintainer).fetchImpl,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    });
    if (!result.ok) throw new Error(result.error.code);

    const unsupportedMogsona = "Unsupported Mogsona";
    const profileOutput = renderProfile(
      {
        ...result.profile,
        mogsona: {
          ...result.profile.mogsona,
          name: unsupportedMogsona,
          evidenceIds: ["unknown-evidence"],
        },
      },
      result.sourceAnalysis,
    );
    expect(profileOutput).not.toContain(unsupportedMogsona);
    expect(profileOutput).not.toContain("support missing");

    if (
      result.sourceAnalysis.status === "insufficient" ||
      result.sourceAnalysis.label === undefined
    )
      throw new Error("fixture has no Code DNA label");
    const unsupportedCodeId = "Unsupported Code ID";
    const codeOutput = renderProfile(result.profile, {
      ...result.sourceAnalysis,
      label: {
        ...result.sourceAnalysis.label,
        name: unsupportedCodeId,
        sampleIds: ["unknown-sample"],
      },
    });
    expect(codeOutput).not.toContain(unsupportedCodeId);
    expect(codeOutput).not.toContain("MOGSONA:");
  });

  it.each([
    ["ready", PERSONAS.strongMaintainer],
    ["partial", PERSONAS.partialTreeFailure],
    ["insufficient", PERSONAS.lowPublicEvidence],
  ] as const)("keeps one-profile %s classifier identity machine-only", async (status, persona) => {
    const terminal = await invoke(contextFor(persona), persona.login);
    expect(terminal.exitCode).toBe(0);
    expect(terminal.stdout).toContain("Score:");
    expect(terminal.stdout).toContain("Coverage:");
    expect(terminal.stdout).not.toContain("NORMALIZED");
    expect(terminal.stdout).not.toContain("MEASURED");
    expect(terminal.stdout).not.toContain("CODE DNA:");
    expect(terminal.stdout).not.toContain("CODE DNA ·");
    expect(classifierLabelsIn(terminal.stdout), status).toEqual([]);
  });

  it("keeps partial and insufficient source taxonomy off cards and shares", async () => {
    const partialContext = () => contextFor(PERSONAS.strongMaintainer, PERSONAS.partialTreeFailure);
    const card = await invoke(partialContext(), "strongmaintainer", "partialtree", "--card");
    expect(card.stdout.toUpperCase()).not.toContain("CODE DNA");
    for (const preset of ["plain", "x", "discord", "linkedin"] as const) {
      const share = await invoke(
        partialContext(),
        "strongmaintainer",
        "partialtree",
        "--share",
        preset,
      );
      expect(share.stdout.toUpperCase(), preset).not.toContain("CODE DNA");
      expect(share.stdout, preset).toContain("SCORE");
      expect(share.stdout, preset).toContain("COVERAGE");
      expect(share.stdout, preset).not.toContain("NORMALIZED");
      expect(share.stdout, preset).not.toContain("MEASURED");
      if (preset === "x") expect(share.stdout.trim().length).toBeLessThanOrEqual(X_CHARACTER_LIMIT);
      if (preset === "discord")
        expect(share.stdout.trim().length).toBeLessThanOrEqual(DISCORD_CHARACTER_LIMIT);
    }

    const secondLow = { ...PERSONAS.lowPublicEvidence, login: "lowpublictwo" };
    const insufficientContext = () => contextFor(PERSONAS.lowPublicEvidence, secondLow);
    const insufficient = await invoke(
      insufficientContext(),
      PERSONAS.lowPublicEvidence.login,
      secondLow.login,
      "--card",
    );
    expect(insufficient.stdout).not.toContain("CODE DNA");
    expect(insufficient.stdout).not.toContain("VIBE MERCHANT");
  });

  it("keeps supported share claims receipt-backed and within platform budgets for every roast", async () => {
    for (const roast of ["clean", "spicy", "unhinged"] as const) {
      const json = await invoke(
        battleContext(),
        "strongmaintainer",
        "sidequester",
        "--roast",
        roast,
        "--json",
      );
      const payload = JSON.parse(json.stdout) as {
        story: {
          finisher: { text: string; primaryEvidenceId: string; sampleIds: readonly string[] };
        };
      };
      for (const preset of ["plain", "x", "discord", "linkedin"] as const) {
        const share = await invoke(
          battleContext(),
          "strongmaintainer",
          "sidequester",
          "--roast",
          roast,
          "--share",
          preset,
        );
        if (share.stdout.includes(payload.story.finisher.text)) {
          expect(share.stdout).toContain("[1]");
          expect(share.stdout).not.toContain(payload.story.finisher.primaryEvidenceId);
          for (const sampleId of payload.story.finisher.sampleIds) {
            expect(share.stdout).not.toContain(sampleId);
          }
        }
        if (preset === "x") expect(share.stdout.trim().length).toBeLessThanOrEqual(280);
        if (preset === "discord") expect(share.stdout.trim().length).toBeLessThanOrEqual(2_000);
      }
    }
  });

  it("keeps long valid handles inside card and share budgets for every roast", async () => {
    const left = {
      ...PERSONAS.strongMaintainer,
      login: "long-valid-handle-for-card-check-01",
    };
    const right = { ...PERSONAS.manyTinyRepos, login: "long-valid-handle-for-card-check-02" };
    for (const roast of ["clean", "spicy", "unhinged"] as const) {
      const card = await invoke(
        contextFor(left, right),
        left.login,
        right.login,
        "--roast",
        roast,
        "--card",
      );
      expect(card.exitCode).toBe(0);
      for (const line of card.stdout.split("\n").filter((entry) => entry.startsWith("║"))) {
        expect(visibleWidth(line), `${roast}: ${line}`).toBeLessThanOrEqual(74);
      }
      const x = await invoke(
        contextFor(left, right),
        left.login,
        right.login,
        "--roast",
        roast,
        "--share",
        "x",
      );
      expect(x.stdout.trim().length).toBeLessThanOrEqual(X_CHARACTER_LIMIT);
    }
  });

  it.each([
    ["usage", ["not a handle", "--json"]],
    ["not_found", ["doesnotexist", "--json"]],
    ["rate_limited", ["ratelimited", "--json"]],
  ] as const)("returns JSON-only %s service failures", async (code, args) => {
    const persona =
      code === "not_found"
        ? PERSONAS.notFound
        : code === "rate_limited"
          ? PERSONAS.rateLimited
          : PERSONAS.strongMaintainer;
    const result = await invoke(contextFor(persona), ...args);
    expect(result.exitCode).toBe(code === "usage" ? 2 : 1);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("\u001b[");
    expect(JSON.parse(result.stdout)).toMatchObject({ error: { code } });
  });

  it("returns JSON-only usage errors when --json is recognizable", async () => {
    for (const args of [
      ["--json"],
      ["alice", "bob", "carol", "--json"],
      ["alice", "--card", "--json"],
    ]) {
      const result = await invoke(battleContext(), ...args);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "usage", retryable: false },
      });
    }
  });

  it("returns a sanitized JSON-only upstream failure", async () => {
    const context: CliContext = {
      invokedAs: "gitmog",
      version: "0.1.0",
      env: { NO_COLOR: "1" },
      fetchImpl: () =>
        Promise.resolve(
          new Response('{"message":"private upstream body must not escape"}', { status: 500 }),
        ),
      now: () => FIXTURE_NOW_MS,
      useFilesystem: false,
      skipBudgetPreflight: true,
    };
    const result = await invoke(context, "upstreamuser", "--json");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { code: "upstream_failure", retryable: true },
    });
    expect(result.stdout).not.toContain("private upstream body");
  });

  it("keeps usage, not-found, rate-limit, timeout, and upstream failures distinct", async () => {
    const timeoutContext: CliContext = {
      invokedAs: "gitmog",
      version: "0.2.1",
      env: { NO_COLOR: "1" },
      fetchImpl: () => Promise.reject(new DOMException("synthetic timeout", "TimeoutError")),
      now: () => FIXTURE_NOW_MS,
      terminalColumns: 80,
      useFilesystem: false,
      skipBudgetPreflight: true,
    };
    const upstreamContext: CliContext = {
      ...timeoutContext,
      fetchImpl: () => Promise.resolve(new Response('{"message":"synthetic"}', { status: 500 })),
    };
    const [usageResult, notFound, rateLimited, timedOut, upstream] = await Promise.all([
      invoke(battleContext(), "bad handle"),
      invoke(
        contextFor(PERSONAS.notFound, PERSONAS.strongMaintainer),
        "doesnotexist",
        "strongmaintainer",
      ),
      invoke(
        contextFor(PERSONAS.rateLimited, PERSONAS.strongMaintainer),
        "ratelimited",
        "strongmaintainer",
      ),
      invoke(timeoutContext, "timeoutleft", "timeoutright"),
      invoke(upstreamContext, "upstreamleft", "upstreamright"),
    ]);
    const headings = [usageResult, notFound, rateLimited, timedOut, upstream].map(
      (result) => result.stderr.split("\n", 1)[0],
    );
    expect(headings).toEqual([
      "INVALID USAGE",
      "GITHUB PROFILE NOT FOUND",
      "GITHUB LIMIT REACHED",
      "GITHUB TIMED OUT",
      "GITHUB UPSTREAM FAILURE",
    ]);
    expect(new Set(headings).size).toBe(5);
    for (const [result, handles] of [
      [notFound, ["doesnotexist", "strongmaintainer"]],
      [rateLimited, ["ratelimited", "strongmaintainer"]],
      [timedOut, ["timeoutleft", "timeoutright"]],
      [upstream, ["upstreamleft", "upstreamright"]],
    ] as const) {
      for (const handle of handles) expect(result.stderr).toContain(`@${handle}`);
      expect(result.stderr).not.toContain("No score was fabricated");
      expect(result.stderr).not.toContain("public receipt machine");
    }
    expect(rateLimited.stderr).toContain("Retry after ");
    expect(rateLimited.stderr).toContain("--sign-in");
    expect(timedOut.stderr).toContain("Retry the battle.");
    expect(timedOut.stderr).not.toContain("RATE LIMIT");

    const withoutReset = renderError(
      { code: "rate_limited", message: "synthetic" },
      { handles: ["left", "right"], columns: 80 },
    );
    expect(withoutReset).toContain("Retry later");
    expect(withoutReset).not.toMatch(/Retry after|Retry in \d+ seconds/u);
  });

  it("returns timeout JSON without human stderr contamination", async () => {
    const result = await invoke(
      {
        invokedAs: "gitmog",
        version: "0.2.1",
        env: { NO_COLOR: "1" },
        fetchImpl: () => Promise.reject(new DOMException("synthetic timeout", "TimeoutError")),
        now: () => FIXTURE_NOW_MS,
        useFilesystem: false,
        skipBudgetPreflight: true,
      },
      "timeoutleft",
      "timeoutright",
      "--json",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { code: "timeout", retryable: true },
    });
  });
});
