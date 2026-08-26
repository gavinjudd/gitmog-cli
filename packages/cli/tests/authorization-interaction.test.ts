import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
  type PersonaSpec,
} from "@gitmog/test-fixtures/github-personas";
import { PRIVATE_CONTEXT_APP_CONFIG } from "@gitmog/private-context";
import { describe, expect, it, vi } from "vitest";

import type {
  AuthorizationInputCallbacks,
  AuthorizationInputController,
} from "../src/authorization-input.js";
import { run, type CliContext } from "../src/cli.js";
import type { ValidatedExternalDestination } from "../src/open-external.js";
import { PRIVATE_CONTEXT_FIXTURE } from "./private-context-fixture.js";

const interactionFixture = (name: string, code: string): string =>
  readFileSync(
    resolve(import.meta.dirname, "fixtures", "interaction", `${name}.txt`),
    "utf8",
  ).replace("TEST-CODE", code);

const contextFor = (...personas: readonly PersonaSpec[]): CliContext => {
  const handlers = personas.map((persona) => ({
    login: persona.login,
    fetchImpl: createFixtureFetch(persona),
  }));
  return {
    invokedAs: "gitmog",
    version: "0.5.0",
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

const allowance = () =>
  Promise.resolve({
    ok: true as const,
    allowance: {
      authenticated: true,
      limit: 5_000,
      remaining: 5_000,
      resetAt: "2026-08-26T06:00:00.000Z",
      rateLimitClass: "none" as const,
      retryAfterSeconds: null,
      source: "endpoint" as const,
    },
  });

const inputHarness = (): {
  readonly controller: AuthorizationInputController;
  readonly callbacks: () => AuthorizationInputCallbacks;
  readonly closed: () => number;
} => {
  let active: AuthorizationInputCallbacks | undefined;
  let closes = 0;
  return {
    controller: {
      start: (callbacks) => {
        active = callbacks;
        return {
          close: () => {
            closes += 1;
            active = undefined;
          },
        };
      },
    },
    callbacks: () => {
      if (active === undefined) throw new Error("Authorization input is not active.");
      return active;
    },
    closed: () => closes,
  };
};

const privateAuthorize = async (
  options: Parameters<NonNullable<CliContext["authorizePrivateDevice"]>>[0],
) => {
  await options.onPrompt({
    userCode: "PRIV-ATE1",
    verificationUri: "https://github.com/login/device",
    expiresAt: "2026-08-26T06:00:00.000Z",
    intervalSeconds: 5,
  });
  let active = true;
  return {
    ok: true as const,
    lease: {
      get active() {
        return active;
      },
      expiresAt: null,
      use: async <T>(callback: (token: string) => Promise<T>) => {
        try {
          return await callback("synthetic_private_token_value_123");
        } finally {
          active = false;
        }
      },
      dispose: () => {
        active = false;
      },
    },
  };
};

describe("device authorization interaction", () => {
  it("opens once, rate-limits Enter, caps five reopens, and cleans up after polling", async () => {
    const input = inputHarness();
    const opened: ValidatedExternalDestination[] = [];
    const transcript: string[] = [];
    let now = 10_000;
    let finish: (() => void) | undefined;
    const resultPromise = run(["node", "gitmog", "strongmaintainer", "--sign-in"], {
      ...contextFor(PERSONAS.strongMaintainer),
      skipBudgetPreflight: false,
      isTty: true,
      stderrIsTty: true,
      stdinIsTty: true,
      now: () => now,
      readAllowance: allowance,
      writeOutput: (value) => transcript.push(value),
      openExternal: (destination) => {
        opened.push(destination);
        return Promise.resolve({ status: "opened" });
      },
      authorizationInput: input.controller,
      authorizeDevice: async (options) => {
        await options.onPrompt({
          userCode: "OPEN-TEST",
          verificationUri: "https://github.com/login/device",
          expiresAt: "2026-08-26T06:00:00.000Z",
          intervalSeconds: 5,
        });
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return {
          ok: true,
          token: "synthetic_public_token_value_123",
          tokenType: "bearer",
          scopes: [],
        };
      },
    });

    await vi.waitFor(() => expect(opened).toHaveLength(1));
    await vi.waitFor(() => expect(() => input.callbacks()).not.toThrow());
    await input.callbacks().onEnter();
    expect(opened).toHaveLength(1);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      now += 1_000;
      await input.callbacks().onEnter();
    }
    expect(opened).toHaveLength(6);
    expect(opened.every((destination) => destination.kind === "github-device")).toBe(true);
    finish?.();
    const result = await resultPromise;
    expect(result.exitCode).toBe(0);
    expect(input.closed()).toBe(1);
    expect(
      transcript.join("").startsWith(interactionFixture("public-auth-opened", "OPEN-TEST")),
    ).toBe(true);
    expect(transcript.join("")).toContain("Browser opened.");
    expect(transcript.join("")).toContain("[Enter] open again · [q] cancel");
    expect(transcript.join("")).toContain("Open this link: https://github.com/login/device");
  });

  it("keeps opener failure nonfatal and preserves the manual fallback", async () => {
    const input = inputHarness();
    const transcript: string[] = [];
    const result = await run(["node", "gitmog", "strongmaintainer", "--sign-in"], {
      ...contextFor(PERSONAS.strongMaintainer),
      skipBudgetPreflight: false,
      isTty: true,
      stderrIsTty: true,
      stdinIsTty: true,
      readAllowance: allowance,
      writeOutput: (value) => transcript.push(value),
      openExternal: () => Promise.resolve({ status: "failed" }),
      authorizationInput: input.controller,
      authorizeDevice: async (options) => {
        await options.onPrompt({
          userCode: "FAIL-OPEN",
          verificationUri: "https://github.com/login/device",
          expiresAt: "2026-08-26T06:00:00.000Z",
          intervalSeconds: 5,
        });
        return {
          ok: true,
          token: "synthetic_public_token_value_123",
          tokenType: "bearer",
          scopes: [],
        };
      },
    });
    expect(result.exitCode).toBe(0);
    expect(
      transcript.join("").startsWith(interactionFixture("public-auth-fallback", "FAIL-OPEN")),
    ).toBe(true);
    expect(transcript.join("")).toContain("The browser did not open.");
    expect(transcript.join("")).toContain("Open this link: https://github.com/login/device");
    expect(transcript.join("")).not.toContain("Error:");
  });

  it.each([
    ["--no-open", {}, true, true, true],
    ["environment opt-out", { GITMOG_NO_BROWSER: "1" }, true, true, true],
    ["CI", { CI: "true" }, true, true, true],
    ["piped stdout", {}, false, true, true],
    ["non-TTY stderr", {}, true, false, true],
    ["non-TTY stdin", {}, true, true, false],
  ] as const)("does not open for %s", async (name, env, isTty, stderrIsTty, stdinIsTty) => {
    const opener = vi.fn(() => Promise.resolve({ status: "opened" as const }));
    const input = inputHarness();
    const args = name === "--no-open" ? ["--sign-in", "--no-open"] : ["--sign-in"];
    const result = await run(["node", "gitmog", "strongmaintainer", ...args], {
      ...contextFor(PERSONAS.strongMaintainer),
      env: { NO_COLOR: "1", ...env },
      skipBudgetPreflight: false,
      isTty,
      stderrIsTty,
      stdinIsTty,
      readAllowance: allowance,
      writeOutput: () => undefined,
      openExternal: opener,
      authorizationInput: input.controller,
      authorizeDevice: async (options) => {
        await options.onPrompt({
          userCode: "NOOP-OPEN",
          verificationUri: "https://github.com/login/device",
          expiresAt: "2026-08-26T06:00:00.000Z",
          intervalSeconds: 5,
        });
        return {
          ok: true,
          token: "synthetic_public_token_value_123",
          tokenType: "bearer",
          scopes: [],
        };
      },
    });
    expect(result.exitCode).toBe(0);
    expect(opener).not.toHaveBeenCalled();
  });

  it("q cancels polling and removes the listener", async () => {
    const input = inputHarness();
    const resultPromise = run(["node", "gitmog", "strongmaintainer", "--sign-in"], {
      ...contextFor(PERSONAS.strongMaintainer),
      skipBudgetPreflight: false,
      isTty: true,
      stderrIsTty: true,
      stdinIsTty: true,
      readAllowance: allowance,
      writeOutput: () => undefined,
      openExternal: () => Promise.resolve({ status: "opened" }),
      authorizationInput: input.controller,
      authorizeDevice: async (options) => {
        await options.onPrompt({
          userCode: "CANC-ELME",
          verificationUri: "https://github.com/login/device",
          expiresAt: "2026-08-26T06:00:00.000Z",
          intervalSeconds: 5,
        });
        await new Promise<void>((resolve) => {
          options.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return { ok: false, error: "cancelled" };
      },
    });
    await vi.waitFor(() => expect(() => input.callbacks()).not.toThrow());
    input.callbacks().onCancel();
    const result = await resultPromise;
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("GitHub sign-in was cancelled.");
    expect(input.closed()).toBe(1);
  });
});

describe("Private Context setup continuation", () => {
  const privateContext = (
    overrides: Partial<CliContext> = {},
  ): {
    readonly context: CliContext;
    readonly opened: ValidatedExternalDestination[];
    readonly output: string[];
    readonly questions: string[];
  } => {
    const input = inputHarness();
    const opened: ValidatedExternalDestination[] = [];
    const output: string[] = [];
    const questions: string[] = [];
    return {
      opened,
      output,
      questions,
      context: {
        ...contextFor(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos),
        isTty: true,
        stderrIsTty: true,
        stdinIsTty: true,
        prompt: (question) => {
          questions.push(question);
          return Promise.resolve("");
        },
        writeOutput: (value) => output.push(value),
        openExternal: (destination) => {
          opened.push(destination);
          return Promise.resolve({ status: "opened" });
        },
        authorizationInput: input.controller,
        authorizePrivateDevice: privateAuthorize,
        privateContextAppConfig: PRIVATE_CONTEXT_APP_CONFIG,
        ...overrides,
      },
    };
  };

  it("rechecks a missing installation and continues the same command", async () => {
    let runs = 0;
    const harness = privateContext({
      runPrivateContext: () => {
        runs += 1;
        return Promise.resolve(
          runs === 1
            ? {
                ok: false as const,
                error: {
                  code: "private_context_installation_required" as const,
                  message: "Installation missing.",
                  installationUrl:
                    "https://github.com/apps/git-mog-private-context/installations/new",
                },
              }
            : { ok: true as const, result: PRIVATE_CONTEXT_FIXTURE },
        );
      },
    });
    const result = await run(
      ["node", "gitmog", "strongmaintainer", "sidequester", "--private-context"],
      harness.context,
    );
    expect(result.exitCode).toBe(0);
    expect(runs).toBe(2);
    expect(harness.opened.map((destination) => destination.kind)).toEqual([
      "github-device",
      "private-app-install",
    ]);
    expect(
      harness.output.join("").startsWith(interactionFixture("private-auth", "PRIV-ATE1")),
    ).toBe(true);
    expect(harness.questions[0]).toBe(interactionFixture("private-setup-install", ""));
    expect(harness.output.join("")).toContain("Private repos connected for @StrongMaintainer.");
    expect(result.stdout).toContain("PRIVATE CONTEXT · @StrongMaintainer");
  });

  it("continues public-only when p is selected", async () => {
    const harness = privateContext({
      prompt: () => Promise.resolve("p"),
      runPrivateContext: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "private_context_installation_required",
            message: "Installation missing.",
            installationUrl: "https://github.com/apps/git-mog-private-context/installations/new",
          },
        }),
    });
    const result = await run(
      ["node", "gitmog", "strongmaintainer", "sidequester", "--private-context"],
      harness.context,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("Context:");
    expect(result.stdout).not.toContain("PRIVATE CONTEXT");
  });

  it("opens an exact settings destination without printing its identifier", async () => {
    let runs = 0;
    const questions: string[] = [];
    const harness = privateContext({
      prompt: (question) => {
        questions.push(question);
        return Promise.resolve("");
      },
      runPrivateContext: () => {
        runs += 1;
        return Promise.resolve(
          runs === 1
            ? {
                ok: false as const,
                error: {
                  code: "private_context_selected_repositories_required" as const,
                  message: "Selected repositories required.",
                  settingsUrl: "https://github.com/settings/installations/987654",
                },
              }
            : { ok: true as const, result: PRIVATE_CONTEXT_FIXTURE },
        );
      },
    });
    const result = await run(
      ["node", "gitmog", "strongmaintainer", "sidequester", "--private-context"],
      harness.context,
    );
    expect(result.exitCode).toBe(0);
    expect(harness.opened.at(-1)).toEqual({
      kind: "private-app-settings",
      url: "https://github.com/settings/installations/987654",
    });
    expect(`${questions.join("")}\n${harness.output.join("")}\n${result.stdout}`).not.toContain(
      "987654",
    );
    expect(questions[0]).toBe(interactionFixture("private-setup-settings", ""));
  });
});
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
