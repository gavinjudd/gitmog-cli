import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
  type PersonaSpec,
} from "@gitmog/test-fixtures/github-personas";
import { PRIVATE_CONTEXT_APP_CONFIG } from "@gitmog/private-context";
import { describe, expect, it } from "vitest";

import { run, usage, type CliContext } from "../src/cli.js";
import { createPalette, stripAnsi } from "../src/color.js";
import {
  createTerminalProgress,
  PROGRESS_REVEAL_MS,
  renderProgressHeader,
  shouldRenderProgress,
  type ProgressClock,
  type TerminalProgressEvent,
} from "../src/progress.js";
import { PRIVATE_CONTEXT_FIXTURE } from "./private-context-fixture.js";

const ESCAPE = String.fromCodePoint(27);
const CSI_PATTERN = new RegExp(`${ESCAPE}\\[[0-9;?]*[A-Za-z]`, "gu");
const CSI_PREFIX_PATTERN = new RegExp(`^${ESCAPE}\\[[0-9;?]*[A-Za-z]`, "u");

class ManualClock implements ProgressClock {
  nowMs = 0;
  #nextId = 1;
  #tasks = new Map<number, { readonly at: number; readonly callback: () => void }>();

  readonly now = (): number => this.nowMs;
  readonly setTimeout = (callback: () => void, delayMs: number): ReturnType<typeof setTimeout> => {
    const id = this.#nextId++;
    this.#tasks.set(id, { at: this.nowMs + delayMs, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  readonly clearTimeout = (handle: ReturnType<typeof setTimeout>): void => {
    this.#tasks.delete(handle as unknown as number);
  };
  advance(milliseconds: number): void {
    const target = this.nowMs + milliseconds;
    while (true) {
      const next = [...this.#tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .toSorted((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (next === undefined) break;
      this.#tasks.delete(next[0]);
      this.nowMs = next[1].at;
      next[1].callback();
    }
    this.nowMs = target;
  }
}

const progressEvents = (status: "ready" | "partial" | "insufficient" = "ready") =>
  [
    { type: "command-start" },
    {
      type: "profile-collection-start",
      mode: "battle",
      handles: ["torvalds", "gvanrossum"],
    },
    { type: "repository-ranking-start", cached: false },
    { type: "profile-collection-complete", metadataRequests: 18, cachedProfiles: 0 },
    {
      type: "repository-ranking-complete",
      eligibleRepositories: 12,
      inspectedRepositories: 6,
      cached: false,
    },
    { type: "scoring-start" },
    { type: "scoring-complete", scores: [67, 65], winner: "left" },
    { type: "source-analysis-start" },
    {
      type: "source-analysis-complete",
      status,
      files: status === "insufficient" ? 0 : 6,
      repositories: status === "insufficient" ? 0 : 4,
      requests: 14,
      rateLimited: status === "partial",
    },
    { type: "story-start" },
    { type: "story-complete" },
    { type: "command-complete" },
  ] satisfies readonly TerminalProgressEvent[];

const capture = (
  input: {
    readonly color?: boolean;
    readonly columns?: number;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly events?: readonly TerminalProgressEvent[];
    readonly cacheMode?: "normal" | "refresh" | "no-cache";
  } = {},
): string => {
  const writes: string[] = [];
  const clock = new ManualClock();
  const progress = createTerminalProgress({
    mode: "battle",
    handles: ["torvalds", "gvanrossum"],
    env: input.env ?? {},
    isTty: true,
    columns: input.columns ?? 74,
    palette: createPalette(input.color === true),
    cacheMode: input.cacheMode ?? "normal",
    write: (value) => writes.push(value),
    clock,
  });
  const events = input.events ?? progressEvents();
  progress.update(events[0] ?? { type: "command-start" });
  clock.advance(120);
  for (const event of events.slice(1, -1)) progress.update(event);
  clock.nowMs = 2_400;
  const last = events.at(-1);
  if (last !== undefined) progress.update(last);
  progress.dispose();
  return writes.join("");
};

const normalized = (value: string): string =>
  value
    .replaceAll("\u001B", "<ESC>")
    .replaceAll("\r", "<CR>")
    .replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/gu, "⠋")
    .replace(/(READY|STOPPED) · \d+\.\ds/gu, "$1 · <elapsed>");
const goldenPath = (name: string): string =>
  resolve(import.meta.dirname, "fixtures", "terminal-progress", `${name}.txt`);
const golden = (name: string): string => readFileSync(goldenPath(name), "utf8");
const expectGolden = (name: string, value: string): void => {
  if (process.env.UPDATE_TERMINAL_FIXTURES === "1") writeFileSync(goldenPath(name), value);
  expect(value).toBe(golden(name));
};
const normalizedMotion = (value: string): string => `${normalized(value)}\n`;

const renderedTerminalLines = (transcript: string): readonly string[] => {
  const lines: string[] = [];
  let current = "";
  for (let index = 0; index < transcript.length; index += 1) {
    const character = transcript[index] as string;
    if (character === "\u001B" && transcript[index + 1] === "[") {
      const match = CSI_PREFIX_PATTERN.exec(transcript.slice(index));
      if (match !== null) {
        if (match[0].endsWith("K")) current = "";
        index += match[0].length - 1;
        continue;
      }
    }
    if (character === "\r") {
      current = "";
      continue;
    }
    if (character === "\n") {
      lines.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current !== "") lines.push(current);
  return lines;
};

const fixtureContext = (...personas: readonly PersonaSpec[]): CliContext => {
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
    version: "0.2.1",
    env: {},
    fetchImpl,
    now: () => FIXTURE_NOW_MS,
    useFilesystem: false,
    skipBudgetPreflight: true,
  };
};

describe("terminal progress captures", () => {
  it("matches the reviewed full-width color battle", () => {
    expectGolden("battle-color", normalizedMotion(capture({ color: true })));
  });

  it("matches the reviewed full-width no-color battle", () => {
    expectGolden("battle-no-color", normalizedMotion(capture()));
  });

  it("matches the compact-width fallback without a broken border", () => {
    const output = capture({ columns: 48 });
    expectGolden("battle-compact", normalizedMotion(output));
    expect(output).not.toContain("╭");
    const visibleFrames = stripAnsi(output).replace(CSI_PATTERN, "").split(/\r|\n/u);
    expect(visibleFrames.every((line) => Array.from(line).length <= 48)).toBe(true);
  });

  it("matches cached, partial, and no-motion captures", () => {
    const cachedEvents = progressEvents().map((event) =>
      event.type === "profile-collection-complete"
        ? { ...event, metadataRequests: 0, cachedProfiles: 2 }
        : event.type === "repository-ranking-start" || event.type === "repository-ranking-complete"
          ? { ...event, cached: true }
          : event,
    ) as readonly TerminalProgressEvent[];
    expectGolden("battle-cached", normalizedMotion(capture({ events: cachedEvents })));
    expectGolden(
      "battle-partial",
      normalizedMotion(capture({ events: progressEvents("partial") })),
    );
    const noMotion = capture({ env: { GITMOG_NO_MOTION: "1" } });
    expectGolden("battle-no-motion", normalized(noMotion));
    expect(noMotion).not.toContain("\n");
    expect(noMotion).not.toContain(`${ESCAPE}[?25`);
  });

  it("matches polished help", () => {
    expectGolden("help", usage());
  });
});

describe("terminal progress behavior", () => {
  it("waits 120ms without delaying a fast command", () => {
    const writes: string[] = [];
    const clock = new ManualClock();
    const progress = createTerminalProgress({
      mode: "profile",
      handles: ["alice"],
      env: {},
      isTty: true,
      columns: 74,
      palette: createPalette(false),
      cacheMode: "normal",
      write: (value) => writes.push(value),
      clock,
    });
    progress.update({ type: "command-start" });
    progress.update({ type: "command-complete" });
    expect(clock.nowMs).toBe(0);
    expect(writes).toEqual([]);
  });

  it.each([
    ["non-tty", false, {}, true, false],
    ["CI", true, { CI: "true" }, true, false],
    ["TERM dumb", true, { TERM: "dumb" }, true, false],
    ["human", true, {}, true, true],
    ["machine mode", true, {}, false, false],
  ] as const)("gates %s correctly", (_name, stderrIsTty, env, normalHumanOutput, expected) => {
    expect(shouldRenderProgress({ stderrIsTty, env, normalHumanOutput })).toBe(expected);
  });

  it("restores the cursor and closes the active line on interruption", () => {
    const writes: string[] = [];
    const clock = new ManualClock();
    const controller = new AbortController();
    const progress = createTerminalProgress({
      mode: "battle",
      handles: ["alice", "bob"],
      env: {},
      isTty: true,
      columns: 74,
      palette: createPalette(true),
      cacheMode: "normal",
      write: (value) => writes.push(value),
      clock,
      signal: controller.signal,
    });
    progress.update({ type: "command-start" });
    clock.advance(120);
    controller.abort();
    const output = writes.join("");
    expect(output).toContain("\u001B[?25l");
    expect(output).toContain("\u001B[?25h");
    expect(output).toContain("Interrupted");
    expect(output.indexOf("\u001B[?25h")).toBeLessThan(output.indexOf("Interrupted"));
    expect(output.endsWith("Interrupted\n")).toBe(true);
  });

  it("clears successful progress and reports a rate limit once", () => {
    const insufficient = capture({ events: progressEvents("insufficient") });
    expect(insufficient).not.toContain("INSUFFICIENT");
    expect(insufficient.endsWith("\r\u001B[2K\u001B[?25h")).toBe(true);
    const failed: readonly TerminalProgressEvent[] = [
      ...progressEvents().slice(0, 3),
      {
        type: "command-failed",
        error: { code: "rate_limited", message: "bounded" },
      },
    ];
    expect(capture({ events: failed })).toContain("GitHub rate limit reached");
    expect(capture({ events: failed }).match(/GitHub rate limit reached/gu)).toHaveLength(1);
  });

  it("keeps refresh and no-cache progress direct and transient", () => {
    expect(capture({ cacheMode: "refresh" })).toBe(capture());
    expect(capture({ cacheMode: "no-cache" })).toBe(capture());
  });

  it("sanitizes handles before width calculation", () => {
    const header = renderProgressHeader({
      mode: "battle",
      handles: ["alice\u001B[2J", "bob\nline"],
      columns: 60,
      palette: createPalette(true),
    });
    expect(header).not.toContain("\u001B[2J");
    expect(header).not.toContain("bob\nline");
    for (const line of header.split("\n")) expect(Array.from(stripAnsi(line)).length).toBe(60);
  });

  it("keeps forced-color SGR balanced and cursor controls paired", () => {
    const output = capture({ color: true });
    const opens = [...output.matchAll(new RegExp(`${ESCAPE}\\[(?!0m)[0-9]+m`, "gu"))].length;
    const resets = output.split(`${ESCAPE}[0m`).length - 1;
    expect(resets).toBe(opens);
    expect(output.split(`${ESCAPE}[?25l`)).toHaveLength(2);
    expect(output.split(`${ESCAPE}[?25h`)).toHaveLength(2);
  });

  it("is line-ending and host-platform neutral", () => {
    const output = normalized(capture({ env: { GITMOG_NO_MOTION: "1" } }));
    expect(output.replaceAll("\n", "\r\n").replaceAll("\r\n", "\n")).toBe(output);
    expect(output).not.toMatch(/[A-Za-z]:\\|\/Users\//u);
  });

  it.each([
    ["public authorization", "GITHUB SIGN-IN · 1 OF 2", "settle", 60, true, false],
    ["private authorization", "PRIVATE REPOS · 2 OF 2", "settle", 80, false, false],
    [
      "user choice",
      "[Enter] sign in once · [l] smaller read · [q] cancel",
      "settle",
      100,
      true,
      true,
    ],
    ["error", "GIT MOG STOPPED", "failure", 60, false, false],
    ["final battle", "GIT MOG · FINAL BATTLE", "complete", 80, true, false],
    ["Ctrl-C", "CANCELLED", "abort", 100, false, false],
    ["timeout", "GITHUB TIMED OUT", "failure", 80, true, true],
  ] as const)(
    "keeps PTY %s text off the transient line",
    (_name, persistent, action, columns, color, noMotion) => {
      const writes: string[] = [];
      const clock = new ManualClock();
      const controller = new AbortController();
      const progress = createTerminalProgress({
        mode: "battle",
        handles: ["alice", "bob"],
        env: noMotion ? { GITMOG_NO_MOTION: "1" } : {},
        isTty: true,
        columns,
        palette: createPalette(color),
        cacheMode: "normal",
        write: (value) => writes.push(value),
        clock,
        signal: controller.signal,
      });
      progress.update({ type: "command-start" });
      clock.advance(PROGRESS_REVEAL_MS);
      progress.update({ type: "quality-analysis-start" });
      if (action === "settle") progress.settle();
      else if (action === "complete") progress.update({ type: "command-complete" });
      else if (action === "abort") controller.abort();
      else {
        progress.update({
          type: "command-failed",
          error: {
            code: persistent.includes("TIMED OUT") ? "timeout" : "upstream_error",
            message: "synthetic persistent failure",
          },
        });
      }
      writes.push(`${persistent}\n`);
      progress.dispose();

      const persistentLine = renderedTerminalLines(writes.join("")).find((line) =>
        line.includes(persistent),
      );
      expect(persistentLine).toBe(persistent);
      expect(persistentLine).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
      expect(persistentLine).not.toContain("Reviewing code quality");
    },
  );

  it("keeps piped persistent output free of transient bytes", () => {
    const writes: string[] = [];
    const progress = createTerminalProgress({
      mode: "battle",
      handles: ["alice", "bob"],
      env: {},
      isTty: false,
      columns: 80,
      palette: createPalette(false),
      cacheMode: "normal",
      write: (value) => writes.push(value),
    });
    progress.update({ type: "command-start" });
    progress.settle();
    writes.push("PIPED FINAL OUTPUT\n");
    expect(writes.join("")).toBe("PIPED FINAL OUTPUT\n");
  });
});

describe("CLI output boundaries", () => {
  it("renders interactive profile and battle progress without changing canonical stdout", async () => {
    for (const args of [["strongmaintainer"], ["strongmaintainer", "sidequester"]] as const) {
      const personas =
        args.length === 1
          ? [PERSONAS.strongMaintainer]
          : [PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos];
      const clock = new ManualClock();
      const progressWrites: string[] = [];
      const base = fixtureContext(...personas);
      let advanced = false;
      const command = ["node", "gitmog", ...args, "--color", "never"];
      const interactive = await run(command, {
        ...base,
        isTty: true,
        stderrIsTty: true,
        terminalColumns: 74,
        progressClock: clock,
        writeProgress: (value) => progressWrites.push(value),
        fetchImpl: (input, init) => {
          if (!advanced) {
            advanced = true;
            clock.advance(120);
          }
          return base.fetchImpl!(input, init);
        },
      });
      const plain = await run(command, { ...base, terminalColumns: 74 });
      expect(interactive.stdout).toBe(plain.stdout);
      expect(progressWrites.join("")).toContain("Fetching profiles");
      expect(progressWrites.join("")).not.toContain("PUBLIC EVIDENCE");
      expect(progressWrites.join("").endsWith("\r\u001B[2K\u001B[?25h")).toBe(true);
    }
  });

  it("clears the active quality spinner before Private Context authorization", async () => {
    const clock = new ManualClock();
    const transcript: string[] = [];
    const base = fixtureContext(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
    let revealed = false;
    const result = await run(
      ["node", "gitmog", "strongmaintainer", "sidequester", "--private-context"],
      {
        ...base,
        isTty: true,
        stderrIsTty: true,
        stdinIsTty: true,
        terminalColumns: 80,
        prompt: () => Promise.resolve(""),
        progressClock: clock,
        writeProgress: (value) => transcript.push(value),
        writeOutput: (value) => transcript.push(value),
        fetchImpl: (input, init) => {
          if (!revealed) {
            revealed = true;
            clock.advance(PROGRESS_REVEAL_MS);
          }
          return base.fetchImpl!(input, init);
        },
        privateContextAppConfig: PRIVATE_CONTEXT_APP_CONFIG,
        authorizePrivateDevice: async (options) => {
          await options.onPrompt({
            userCode: "PRIVATE-PTY",
            verificationUri: "https://github.com/login/device",
            expiresAt: "2026-08-25T12:00:00.000Z",
            intervalSeconds: 5,
          });
          let active = true;
          return {
            ok: true,
            lease: {
              get active() {
                return active;
              },
              expiresAt: null,
              use: async (callback) => callback("private_fixture_access_token_123456"),
              dispose: () => {
                active = false;
              },
            },
          };
        },
        runPrivateContext: () => Promise.resolve({ ok: true, result: PRIVATE_CONTEXT_FIXTURE }),
      },
    );
    if (result.exitCode !== 0) throw new Error(JSON.stringify(result));
    const raw = transcript.join("");
    expect(raw).not.toContain("Reviewing code qualityPRIVATE CONTEXT");
    const promptLine = renderedTerminalLines(raw).find((line) => line === "PRIVATE REPOS");
    expect(promptLine).toBe("PRIVATE REPOS");
  });

  it.each([
    ["json", ["strongmaintainer", "sidequester", "--json"]],
    ["card", ["strongmaintainer", "sidequester", "--card"]],
    ["caption", ["strongmaintainer", "sidequester", "--caption"]],
    ["share plain", ["strongmaintainer", "sidequester", "--share", "plain"]],
    ["share x", ["strongmaintainer", "sidequester", "--share", "x"]],
    ["share discord", ["strongmaintainer", "sidequester", "--share", "discord"]],
    ["share linkedin", ["strongmaintainer", "sidequester", "--share", "linkedin"]],
  ] as const)("keeps %s free of progress and ANSI", async (_name, args) => {
    const writes: string[] = [];
    const result = await run(["node", "gitmog", ...args, "--color", "always"], {
      ...fixtureContext(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos),
      isTty: true,
      stderrIsTty: true,
      writeProgress: (value) => writes.push(value),
    });
    expect(result.exitCode).toBe(0);
    expect(writes).toEqual([]);
    expect(result.stdout).not.toContain("\u001B");
    expect(result.stderr).toBe("");
  });

  it.each([
    ["help", ["help"]],
    ["version", ["--version"]],
    ["invalid", ["not a handle"]],
    ["same handle", ["alice", "Alice"]],
  ] as const)("keeps %s deliberate and animation-free", async (_name, args) => {
    const writes: string[] = [];
    const result = await run(["node", "gitmog", ...args], {
      ...fixtureContext(PERSONAS.strongMaintainer),
      isTty: true,
      stderrIsTty: true,
      writeProgress: (value) => writes.push(value),
    });
    expect(writes).toEqual([]);
    expect([0, 1, 2]).toContain(result.exitCode);
  });

  it("respects NO_COLOR, --color never, and --color always", async () => {
    const args = ["strongmaintainer", "sidequester"] as const;
    const base = fixtureContext(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
    const never = await run(["node", "gitmog", ...args, "--color", "never"], {
      ...base,
      isTty: true,
    });
    const noColor = await run(["node", "gitmog", ...args, "--color", "always"], {
      ...base,
      env: { NO_COLOR: "1" },
      isTty: true,
    });
    const always = await run(["node", "gitmog", ...args, "--color", "always"], {
      ...base,
      isTty: true,
    });
    expect(noColor.stdout).toBe(never.stdout);
    expect(never.stdout).not.toContain("\u001B");
    expect(always.stdout).toContain("\u001B");
  });
});
