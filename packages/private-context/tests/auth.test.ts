import { describe, expect, it } from "vitest";

import {
  authorizePrivateGithubDevice,
  type PrivateDeviceAuthorizationPrompt,
} from "../src/auth.js";
import type { PrivateContextAppConfig } from "../src/types.js";

const config: PrivateContextAppConfig = {
  version: "1.0.0",
  name: "Git Mog Private Context",
  slug: "git-mog-private-context",
  appId: "123456",
  clientId: "Iv123456789012345678",
  deviceFlow: true,
  permissions: { metadata: "read", contents: "read" },
  installationSelectionRequired: "selected",
  privateKeys: 0,
  clientSecrets: 0,
};

const codeResponse = () =>
  Response.json({
    device_code: "private-device-code-with-enough-characters",
    user_code: "ABCD-EFGH",
    verification_uri: "https://github.com/login/device",
    expires_in: 900,
    interval: 5,
  });

const flow = (polls: readonly unknown[]) => {
  const requests: Request[] = [];
  let index = 0;
  const fetchImpl: typeof fetch = (input, init) => {
    requests.push(new Request(input, init));
    const response = index === 0 ? codeResponse() : Response.json(polls[index - 1]);
    index += 1;
    return Promise.resolve(response);
  };
  return { fetchImpl, requests };
};

describe("private GitHub App device flow", () => {
  it("uses client ID only, discards refresh tokens, and consumes the access token once", async () => {
    const token = "private_fixture_access_token_123456";
    const refresh = "private_fixture_refresh_token_123456";
    const fixture = flow([
      { error: "authorization_pending" },
      {
        access_token: token,
        token_type: "bearer",
        scope: "",
        expires_in: 28_800,
        refresh_token: refresh,
      },
    ]);
    const prompts: PrivateDeviceAuthorizationPrompt[] = [];
    const result = await authorizePrivateGithubDevice({
      config,
      fetchImpl: fixture.fetchImpl,
      sleep: () => Promise.resolve(),
      onPrompt: (prompt) => {
        prompts.push(prompt);
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(refresh);
    expect(await result.lease.use((value) => Promise.resolve(value === token))).toBe(true);
    expect(result.lease.active).toBe(false);
    await expect(result.lease.use(() => Promise.resolve())).rejects.toThrow("unavailable");
    const bodies = await Promise.all(fixture.requests.map((request) => request.text()));
    expect(bodies[0]).toBe(`client_id=${config.clientId}`);
    expect(bodies.slice(1)).toEqual([
      `client_id=${config.clientId}&device_code=private-device-code-with-enough-characters&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code`,
      `client_id=${config.clientId}&device_code=private-device-code-with-enough-characters&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code`,
    ]);
    expect(bodies.join("&")).not.toContain("client_secret");
    expect(bodies.join("&")).not.toContain("scope=");
    expect(JSON.stringify(prompts)).not.toContain("device-code");
  });

  it("slows down and rejects scopes or a token shared with public auth", async () => {
    const slow = flow([
      { error: "slow_down" },
      { access_token: "private_fixture_access_token_123456", token_type: "bearer", scope: "" },
    ]);
    const waits: number[] = [];
    const slowed = await authorizePrivateGithubDevice({
      config,
      fetchImpl: slow.fetchImpl,
      sleep: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
      onPrompt: () => undefined,
    });
    expect(slowed.ok).toBe(true);
    expect(waits).toEqual([5_000, 10_000]);

    const scoped = flow([
      { access_token: "private_fixture_access_token_123456", token_type: "bearer", scope: "repo" },
    ]);
    expect(
      await authorizePrivateGithubDevice({
        config,
        fetchImpl: scoped.fetchImpl,
        sleep: () => Promise.resolve(),
        onPrompt: () => undefined,
      }),
    ).toEqual({ ok: false, error: "unexpected_scope" });

    const conflicting = flow([
      { access_token: "shared_fixture_access_token_1234567", token_type: "bearer", scope: "" },
    ]);
    expect(
      await authorizePrivateGithubDevice({
        config,
        forbiddenTokens: ["shared_fixture_access_token_1234567"],
        fetchImpl: conflicting.fetchImpl,
        sleep: () => Promise.resolve(),
        onPrompt: () => undefined,
      }),
    ).toEqual({ ok: false, error: "conflicting_token_boundary" });
  });

  it.each([
    ["access_denied", "access_denied"],
    ["expired_token", "expired"],
    ["unexpected", "malformed"],
  ] as const)("handles %s", async (serverError, expected) => {
    const fixture = flow([{ error: serverError }]);
    expect(
      await authorizePrivateGithubDevice({
        config,
        fetchImpl: fixture.fetchImpl,
        sleep: () => Promise.resolve(),
        onPrompt: () => undefined,
      }),
    ).toEqual({ ok: false, error: expected });
  });

  it("handles malformed, network, timeout, and cancellation without token output", async () => {
    const malformed = await authorizePrivateGithubDevice({
      config,
      fetchImpl: () => Promise.resolve(Response.json({ user_code: "NOPE" })),
      onPrompt: () => undefined,
    });
    expect(malformed).toEqual({ ok: false, error: "malformed" });

    for (const [cause, expected] of [
      [new TypeError("offline"), "network"],
      [new DOMException("timed out", "TimeoutError"), "timeout"],
    ] as const) {
      const result = await authorizePrivateGithubDevice({
        config,
        fetchImpl: () => Promise.reject(cause),
        onPrompt: () => undefined,
      });
      expect(result).toEqual({ ok: false, error: expected });
    }

    const controller = new AbortController();
    const pending = flow([{ error: "authorization_pending" }]);
    const cancelled = await authorizePrivateGithubDevice({
      config,
      fetchImpl: pending.fetchImpl,
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
