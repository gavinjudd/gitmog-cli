import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
  type PersonaSpec,
} from "@gitmog/test-fixtures/github-personas";
import { describe, expect, it } from "vitest";

import { run, type CliContext } from "../src/cli.js";

const fixturePath = (name: string): string =>
  resolve(import.meta.dirname, "fixtures", "terminal-output", `${name}.txt`);
const expectFixture = (name: string, value: string): void => {
  if (process.env.UPDATE_TERMINAL_OUTPUT_FIXTURES === "1") writeFileSync(fixturePath(name), value);
  expect(value).toBe(readFileSync(fixturePath(name), "utf8"));
};
const contextFor = (...personas: readonly PersonaSpec[]): CliContext => {
  const handlers = personas.map((persona) => ({
    login: persona.login,
    fetchImpl: createFixtureFetch(persona),
  }));
  return {
    invokedAs: "gitmog",
    version: "0.2.1",
    env: { NO_COLOR: "1" },
    timeZone: "America/New_York",
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
let invocationLane = Promise.resolve();
const invoke = (context: CliContext, ...args: readonly string[]) => {
  const execution = invocationLane.then(() => run(["node", "gitmog", ...args], context));
  invocationLane = execution.then(
    () => undefined,
    () => undefined,
  );
  return execution;
};

describe("reviewed terminal output fixtures", () => {
  it("matches ready, limited, and insufficient battle captures", async () => {
    const secondLow = { ...PERSONAS.lowPublicEvidence, login: "lowpublictwo" };
    const [ready, partial, insufficient] = await Promise.all([
      invoke(
        contextFor(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos),
        "strongmaintainer",
        "sidequester",
      ),
      invoke(
        contextFor(PERSONAS.strongMaintainer, PERSONAS.partialTreeFailure),
        "strongmaintainer",
        "partialtree",
      ),
      invoke(
        contextFor(PERSONAS.lowPublicEvidence, secondLow),
        PERSONAS.lowPublicEvidence.login,
        secondLow.login,
      ),
    ]);
    expectFixture("battle-ready", ready.stdout);
    expectFixture("battle-partial", partial.stdout);
    expectFixture("battle-insufficient", insufficient.stdout);
  });

  it("matches the losing-side decisive-round capture", async () => {
    const result = await invoke(
      contextFor(PERSONAS.releaseHeavy, PERSONAS.testHeavy),
      "tagmachine",
      "assertionpilled",
    );
    expectFixture("battle-losing-side-round", result.stdout);
  });

  it("matches ready and limited profile captures", async () => {
    const [ready, partial] = await Promise.all([
      invoke(contextFor(PERSONAS.strongMaintainer), "strongmaintainer"),
      invoke(contextFor(PERSONAS.partialTreeFailure), "partialtree"),
    ]);
    expectFixture("profile-ready", ready.stdout);
    expectFixture("profile-partial", partial.stdout);
  });

  it("matches no-color and forced-color captures exactly", async () => {
    const context = contextFor(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
    const [plain, color] = await Promise.all([
      invoke(
        { ...context, terminalColumns: 80 },
        "strongmaintainer",
        "sidequester",
        "--color",
        "never",
      ),
      invoke(
        { ...context, env: {}, isTty: true, terminalColumns: 80 },
        "strongmaintainer",
        "sidequester",
        "--color",
        "always",
      ),
    ]);
    expectFixture("battle-no-color", plain.stdout);
    expectFixture("battle-color", color.stdout);
  });

  it("matches warm-cache and no-motion result captures", async () => {
    const directory = mkdtempSync(join(tmpdir(), "gitmog-terminal-output-"));
    try {
      const base = contextFor(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
      let calls = 0;
      const cachedContext: CliContext = {
        ...base,
        env: { NO_COLOR: "1", GITMOG_CACHE_DIR: directory },
        useFilesystem: true,
        fetchImpl: (input, init) => {
          calls += 1;
          return base.fetchImpl!(input, init);
        },
      };
      await invoke(cachedContext, "strongmaintainer", "sidequester");
      calls = 0;
      const warm = await invoke(cachedContext, "strongmaintainer", "sidequester");
      expect(calls).toBe(0);
      expectFixture("battle-warm-cache", warm.stdout);

      const noMotion = await invoke(
        {
          ...contextFor(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos),
          env: { NO_COLOR: "1", GITMOG_NO_MOTION: "1" },
          isTty: true,
          stderrIsTty: true,
        },
        "strongmaintainer",
        "sidequester",
      );
      expectFixture("battle-no-motion", noMotion.stdout);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([60, 80, 100] as const)("matches the %i-column battle capture", async (columns) => {
    const result = await invoke(
      {
        ...contextFor(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos),
        terminalColumns: columns,
      },
      "strongmaintainer",
      "sidequester",
    );
    expectFixture(`battle-width-${String(columns)}`, result.stdout);
  });

  it("matches card, details, and receipts captures", async () => {
    const context = contextFor(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
    const [card, details, receipts] = await Promise.all([
      invoke({ ...context, terminalColumns: 80 }, "strongmaintainer", "sidequester", "--card"),
      invoke({ ...context, terminalColumns: 80 }, "strongmaintainer", "sidequester", "--details"),
      invoke({ ...context, terminalColumns: 80 }, "strongmaintainer", "sidequester", "--receipts"),
    ]);
    expectFixture("battle-card", card.stdout);
    expectFixture("battle-details", details.stdout);
    expectFixture("battle-receipts", receipts.stdout);
  });

  it("matches rate-limit and timeout failure captures", async () => {
    const rateLimited = await invoke(
      {
        ...contextFor(PERSONAS.rateLimited, PERSONAS.strongMaintainer),
        terminalColumns: 80,
      },
      "ratelimited",
      "strongmaintainer",
    );
    const timedOut = await invoke(
      {
        invokedAs: "gitmog",
        version: "0.2.1",
        env: { NO_COLOR: "1" },
        fetchImpl: () => Promise.reject(new DOMException("synthetic timeout", "TimeoutError")),
        now: () => FIXTURE_NOW_MS,
        terminalColumns: 80,
        useFilesystem: false,
        skipBudgetPreflight: true,
      },
      "timeoutleft",
      "timeoutright",
    );
    expectFixture("rate-limit", rateLimited.stderr);
    expectFixture("timeout", timedOut.stderr);
  });
});
