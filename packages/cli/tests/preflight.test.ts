import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
  type PersonaSpec,
} from "@gitmog/test-fixtures/github-personas";
import { describe, expect, it } from "vitest";

import { run, type CliContext } from "../src/cli.js";

const routedFetch = (...personas: readonly PersonaSpec[]) => {
  const handlers = personas.map((persona) => ({
    login: persona.login,
    fetchImpl: createFixtureFetch(persona),
  }));
  const authorizationHeaders: (string | null)[] = [];
  let calls = 0;
  const fetchImpl: typeof fetch = (input, init) => {
    calls += 1;
    const request = new Request(input, init);
    authorizationHeaders.push(request.headers.get("authorization"));
    const found = handlers.find((handler) =>
      request.url.toLowerCase().includes(handler.login.toLowerCase()),
    );
    return (
      found?.fetchImpl(input, init) ??
      Promise.resolve(new Response('{"message":"Not Found"}', { status: 404 }))
    );
  };
  return { fetchImpl, authorizationHeaders, calls: () => calls };
};

const allowance = (remaining: number, authenticated = false) => ({
  ok: true as const,
  allowance: {
    authenticated,
    limit: authenticated ? 5_000 : 60,
    remaining,
    resetAt: "2026-08-24T00:00:00.000Z",
    rateLimitClass: remaining === 0 ? ("primary" as const) : ("none" as const),
    retryAfterSeconds: null,
    source: "endpoint" as const,
  },
});

const baseContext = (...personas: readonly PersonaSpec[]): CliContext => {
  const routed = routedFetch(...personas);
  return {
    invokedAs: "gitmog",
    version: "0.2.2",
    env: { NO_COLOR: "1" },
    fetchImpl: routed.fetchImpl,
    now: () => FIXTURE_NOW_MS,
    useFilesystem: false,
  };
};

const invoke = (context: CliContext, ...args: readonly string[]) =>
  run(["node", "gitmog", ...args], context);

describe("request-budget preflight", () => {
  it("does no allowance, auth, or GitHub work for local help", async () => {
    let allowanceCalls = 0;
    let authCalls = 0;
    let githubCalls = 0;
    const result = await invoke({
      ...baseContext(),
      fetchImpl: () => {
        githubCalls += 1;
        return Promise.resolve(new Response("{}"));
      },
      readAllowance: () => {
        allowanceCalls += 1;
        return Promise.resolve(allowance(60));
      },
      authorizeDevice: () => {
        authCalls += 1;
        return Promise.resolve({ ok: false, error: "cancelled" });
      },
    });
    expect(result.exitCode).toBe(0);
    expect({ allowanceCalls, authCalls, githubCalls }).toEqual({
      allowanceCalls: 0,
      authCalls: 0,
      githubCalls: 0,
    });
  });

  it("returns JSON-only blocked and limited dispositions before collection", async () => {
    for (const [remaining, expectedCode, expectedDisposition] of [
      [0, "github_limit_reached", "blocked"],
      [31, "github_budget_limited", "limited"],
    ] as const) {
      let collectionCalls = 0;
      const result = await invoke(
        {
          ...baseContext(),
          fetchImpl: () => {
            collectionCalls += 1;
            return Promise.resolve(new Response("{}"));
          },
          readAllowance: () => Promise.resolve(allowance(remaining)),
        },
        "strongmaintainer",
        "sidequester",
        "--json",
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(collectionCalls).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: {
          code: expectedCode,
          authenticationState: "anonymous",
          remaining,
          limitedRunPossible: expectedDisposition === "limited",
          collectionBegan: false,
        },
        requestPlan: { disposition: expectedDisposition, expectedCurrentRequests: 32 },
      });
    }
  });

  it("permits an explicit limited anonymous continuation", async () => {
    const context = baseContext(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
    const result = await invoke(
      { ...context, readAllowance: () => Promise.resolve(allowance(31)) },
      PERSONAS.strongMaintainer.login,
      PERSONAS.manyTinyRepos.login,
      "--anonymous",
      "--json",
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toHaveProperty("battle");
  });

  it("fails closed when --quality cannot obtain the complete preview tier", async () => {
    let collectionCalls = 0;
    const result = await invoke(
      {
        ...baseContext(PERSONAS.strongMaintainer),
        fetchImpl: () => {
          collectionCalls += 1;
          return Promise.resolve(new Response("{}"));
        },
        readAllowance: () => Promise.resolve(allowance(60)),
      },
      PERSONAS.strongMaintainer.login,
      "--quality",
      "--json",
    );
    expect(result.exitCode).toBe(1);
    expect(collectionCalls).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { code: "github_budget_limited", collectionBegan: false },
      requestPlan: { quality: { disposition: "limited" } },
    });
  });

  it("rejects mutually exclusive complete-quality and anonymous modes", async () => {
    const result = await invoke(
      baseContext(PERSONAS.strongMaintainer),
      PERSONAS.strongMaintainer.login,
      "--quality",
      "--anonymous",
      "--json",
    );
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ error: { code: "usage" } });
  });

  it("continues the same battle after session-only device authorization", async () => {
    const token = "fixture-device-token-never-render";
    const routed = routedFetch(PERSONAS.strongMaintainer, PERSONAS.manyTinyRepos);
    const liveOutput: string[] = [];
    let allowanceCalls = 0;
    const result = await invoke(
      {
        invokedAs: "gitmog",
        version: "0.2.2",
        env: { NO_COLOR: "1" },
        fetchImpl: routed.fetchImpl,
        now: () => FIXTURE_NOW_MS,
        useFilesystem: false,
        isTty: true,
        prompt: () => Promise.resolve("s"),
        writeOutput: (value) => liveOutput.push(value),
        readAllowance: (options) => {
          allowanceCalls += 1;
          return Promise.resolve(
            options.token === undefined ? allowance(0) : allowance(5_000, true),
          );
        },
        authorizeDevice: async (options) => {
          await options.onPrompt({
            userCode: "ABCD-EFGH",
            verificationUri: "https://github.com/login/device",
            expiresAt: "2026-08-24T00:00:00.000Z",
            intervalSeconds: 5,
          });
          return { ok: true, token, tokenType: "bearer", scopes: [] };
        },
      },
      PERSONAS.strongMaintainer.login,
      PERSONAS.manyTinyRepos.login,
    );
    expect(result.exitCode).toBe(0);
    expect(allowanceCalls).toBe(2);
    expect(routed.calls()).toBeGreaterThan(0);
    expect(routed.authorizationHeaders.every((value) => value === `Bearer ${token}`)).toBe(true);
    expect(`${result.stdout}${result.stderr}${liveOutput.join("")}`).not.toContain(token);
    expect(liveOutput.join("")).toContain("https://github.com/login/device");
  });

  it("rejects conflicting explicit token aliases without revealing or using them", async () => {
    let calls = 0;
    const result = await invoke(
      {
        ...baseContext(),
        env: { GITHUB_TOKEN: "first-secret", GH_TOKEN: "second-secret" },
        fetchImpl: () => {
          calls += 1;
          return Promise.resolve(new Response("{}"));
        },
      },
      "octocat",
      "--json",
    );
    expect(result.exitCode).toBe(2);
    expect(calls).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("first-secret");
    expect(result.stdout).not.toContain("second-secret");
  });
});
