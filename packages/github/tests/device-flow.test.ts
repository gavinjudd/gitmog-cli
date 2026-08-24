import { describe, expect, it } from "vitest";

import { authorizeGithubDevice, type DeviceAuthorizationPrompt } from "../src/device-flow.js";

const codeResponse = () =>
  Response.json({
    device_code: "device-code-with-enough-characters",
    user_code: "ABCD-EFGH",
    verification_uri: "https://github.com/login/device",
    expires_in: 900,
    interval: 5,
  });

const fixtureFlow = (polls: readonly unknown[]) => {
  const requests: Request[] = [];
  let index = 0;
  const fetchImpl: typeof fetch = (input, init) => {
    requests.push(new Request(input, init));
    if (index === 0) {
      index += 1;
      return Promise.resolve(codeResponse());
    }
    const body = polls[index - 1];
    index += 1;
    return Promise.resolve(Response.json(body));
  };
  return { fetchImpl, requests };
};

describe("authorizeGithubDevice", () => {
  it("requests no scope or secret, respects pending, and returns the token only in memory", async () => {
    const token = "fixture-session-token-value";
    const fixture = fixtureFlow([
      { error: "authorization_pending" },
      { access_token: token, token_type: "bearer", scope: "" },
    ]);
    const waits: number[] = [];
    const prompts: DeviceAuthorizationPrompt[] = [];
    const result = await authorizeGithubDevice({
      clientId: "0123456789ABCDEF",
      fetchImpl: fixture.fetchImpl,
      sleep: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
      onPrompt: (prompt) => {
        prompts.push(prompt);
      },
    });

    expect(result).toEqual({ ok: true, token, tokenType: "bearer", scopes: [] });
    expect(waits).toEqual([5_000, 5_000]);
    expect(prompts).toHaveLength(1);
    const bodies = await Promise.all(fixture.requests.map((request) => request.text()));
    expect(bodies[0]).toBe("client_id=0123456789ABCDEF");
    expect(bodies.join("&")).not.toContain("client_secret");
    expect(bodies.join("&")).not.toContain("scope");
    expect(JSON.stringify(prompts)).not.toContain(token);
  });

  it("adds five seconds after slow_down", async () => {
    const fixture = fixtureFlow([
      { error: "slow_down" },
      { error: "authorization_pending" },
      { access_token: "fixture-session-token", token_type: "bearer", scope: "" },
    ]);
    const waits: number[] = [];
    const result = await authorizeGithubDevice({
      clientId: "0123456789ABCDEF",
      fetchImpl: fixture.fetchImpl,
      sleep: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
      onPrompt: () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(waits).toEqual([5_000, 10_000, 10_000]);
  });

  it.each([
    ["access_denied", "access_denied"],
    ["expired_token", "expired"],
    ["unexpected", "malformed"],
  ] as const)("handles %s", async (serverError, expected) => {
    const fixture = fixtureFlow([{ error: serverError }]);
    const result = await authorizeGithubDevice({
      clientId: "0123456789ABCDEF",
      fetchImpl: fixture.fetchImpl,
      sleep: () => Promise.resolve(),
      onPrompt: () => undefined,
    });
    expect(result).toEqual({ ok: false, error: expected });
  });

  it("stops at expiration without another poll", async () => {
    let now = 1_000;
    const fixture = fixtureFlow([]);
    const result = await authorizeGithubDevice({
      clientId: "0123456789ABCDEF",
      fetchImpl: fixture.fetchImpl,
      now: () => now,
      sleep: () => {
        now += 900_000;
        return Promise.resolve();
      },
      onPrompt: () => undefined,
    });
    expect(result).toEqual({ ok: false, error: "expired" });
    expect(fixture.requests).toHaveLength(1);
  });

  it("handles malformed, network, timeout, and cancellation states", async () => {
    const malformed = await authorizeGithubDevice({
      clientId: "0123456789ABCDEF",
      fetchImpl: () => Promise.resolve(Response.json({ user_code: "NOPE" })),
      onPrompt: () => undefined,
    });
    expect(malformed).toEqual({ ok: false, error: "malformed" });

    const network = await authorizeGithubDevice({
      clientId: "0123456789ABCDEF",
      fetchImpl: () => Promise.reject(new TypeError("offline")),
      onPrompt: () => undefined,
    });
    expect(network).toEqual({ ok: false, error: "network" });

    const timeout = await authorizeGithubDevice({
      clientId: "0123456789ABCDEF",
      fetchImpl: () => Promise.reject(new DOMException("timed out", "TimeoutError")),
      onPrompt: () => undefined,
    });
    expect(timeout).toEqual({ ok: false, error: "timeout" });

    const controller = new AbortController();
    const fixture = fixtureFlow([{ error: "authorization_pending" }]);
    const cancelled = await authorizeGithubDevice({
      clientId: "0123456789ABCDEF",
      fetchImpl: fixture.fetchImpl,
      signal: controller.signal,
      sleep: () => {
        controller.abort();
        return Promise.reject(new DOMException("cancelled", "AbortError"));
      },
      onPrompt: () => undefined,
    });
    expect(cancelled).toEqual({ ok: false, error: "cancelled" });
  });
});
