import { describe, expect, it } from "vitest";

import { GithubHttpClient } from "../src/http.js";

const jsonFetch = (
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): { fetchImpl: typeof globalThis.fetch; urls: string[]; headers: Headers[] } => {
  const urls: string[] = [];
  const headers: Headers[] = [];
  const fetchImpl: typeof globalThis.fetch = (input, requestInit) => {
    urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    headers.push(new Headers(requestInit?.headers));
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json", ...init.headers },
      }),
    );
  };
  return { fetchImpl, urls, headers };
};

describe("GithubHttpClient", () => {
  it("builds every request against the hard-coded GitHub origin", async () => {
    const { fetchImpl, urls } = jsonFetch({ login: "octocat" });
    const client = new GithubHttpClient({ fetchImpl });
    await client.get("/users/octocat", { per_page: "100" });
    expect(urls[0]).toBe("https://api.github.com/users/octocat?per_page=100");
  });

  it("refuses a path that could redirect the request at another origin", async () => {
    const { fetchImpl, urls } = jsonFetch({});
    const client = new GithubHttpClient({ fetchImpl });
    const result = await client.get("//evil.example.com/users/octocat");
    expect(result.ok).toBe(false);
    expect(urls).toHaveLength(0);
  });

  it("sends no authorization header without a token", async () => {
    const { fetchImpl, headers } = jsonFetch({});
    await new GithubHttpClient({ fetchImpl }).get("/users/octocat");
    expect(headers[0]?.has("authorization")).toBe(false);
  });

  it("sends a bearer token when one is configured and never returns it", async () => {
    const { fetchImpl, headers } = jsonFetch({ login: "octocat" });
    const client = new GithubHttpClient({ fetchImpl, token: "ghp_secret" });
    const result = await client.get("/users/octocat");
    expect(headers[0]?.get("authorization")).toBe("Bearer ghp_secret");
    expect(JSON.stringify(result)).not.toContain("ghp_secret");
    expect(JSON.stringify(client.rateLimit)).not.toContain("ghp_secret");
  });

  it("parses rate-limit headers", async () => {
    const { fetchImpl } = jsonFetch(
      {},
      {
        headers: {
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "42",
          "x-ratelimit-reset": "1786605766",
        },
      },
    );
    const client = new GithubHttpClient({ fetchImpl });
    await client.get("/users/octocat");
    expect(client.rateLimit).toEqual({
      authenticated: false,
      limit: 60,
      remaining: 42,
      resetAt: new Date(1786605766 * 1000).toISOString(),
    });
  });

  it("classifies an exhausted rate limit and reports when to retry", async () => {
    const { fetchImpl } = jsonFetch(
      { message: "API rate limit exceeded" },
      { status: 403, headers: { "x-ratelimit-remaining": "0", "retry-after": "120" } },
    );
    const result = await new GithubHttpClient({ fetchImpl }).get("/users/octocat");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("rate_limited");
    expect(result.error.rateLimitClass).toBe("primary");
    expect(result.error.remaining).toBe(0);
    expect(result.error.retryAfterSeconds).toBe(120);
  });

  it.each([
    [403, { "x-ratelimit-remaining": "14", "retry-after": "30" }, "secondary", 30],
    [429, {}, "secondary", undefined],
    [429, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1786605766" }, "primary", null],
  ] as const)(
    "distinguishes %i rate-limit classes without reading user-facing strings",
    async (status, headers, rateLimitClass, retryAfterSeconds) => {
      const { fetchImpl } = jsonFetch({ message: "ignored" }, { status, headers });
      const result = await new GithubHttpClient({ fetchImpl }).get("/users/octocat");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({ code: "rate_limited", rateLimitClass });
      if (retryAfterSeconds === null) {
        expect(result.error.resetAt).toBe(new Date(1_786_605_766_000).toISOString());
      } else if (retryAfterSeconds === undefined) {
        expect(result.error.retryAfterSeconds).toBeUndefined();
      } else {
        expect(result.error.retryAfterSeconds).toBe(retryAfterSeconds);
      }
    },
  );

  it.each([
    [403, { "x-ratelimit-remaining": "0" }, "x".repeat(2_000_000)],
    [403, { "x-ratelimit-remaining": "0" }, "{invalid json"],
    [429, {}, "x".repeat(2_000_000)],
    [403, { "retry-after": "45" }, "ignored"],
  ] as const)(
    "classifies known rate-limit metadata before reading the %i response body",
    async (status, headers, body) => {
      let canceled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
        },
        cancel() {
          canceled = true;
        },
      });
      const fetchImpl: typeof globalThis.fetch = () =>
        Promise.resolve(new Response(stream, { status, headers }));
      const result = await new GithubHttpClient({ fetchImpl }).getBoundedJson("/bounded", 100);
      expect(result).toMatchObject({ ok: false, error: { code: "rate_limited" } });
      expect(canceled).toBe(true);
    },
  );

  it("classifies exhausted headers without touching an unreadable stream", async () => {
    let read = false;
    let canceled = false;
    const unreadable = {
      status: 403,
      ok: false,
      headers: new Headers({ "x-ratelimit-remaining": "0" }),
      body: {
        cancel: () => {
          canceled = true;
          return Promise.resolve();
        },
        getReader: () => {
          read = true;
          throw new Error("must not read");
        },
      },
      text: () => {
        read = true;
        return Promise.reject(new Error("must not read"));
      },
    } as unknown as Response;
    const fetchImpl: typeof globalThis.fetch = () => Promise.resolve(unreadable);
    const result = await new GithubHttpClient({ fetchImpl }).getBoundedJson("/bounded", 100);
    expect(result).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect(read).toBe(false);
    expect(canceled).toBe(true);
  });

  it("keeps a non-rate-limit 403 as an upstream refusal", async () => {
    const { fetchImpl } = jsonFetch({ message: "Resource not accessible" }, { status: 403 });
    const result = await new GithubHttpClient({ fetchImpl }).getBoundedJson("/bounded", 1_000);
    expect(result).toMatchObject({ ok: false, error: { code: "upstream_error" } });
  });

  it("classifies 404, 451 and 5xx distinctly", async () => {
    const codes = await Promise.all(
      [
        [404, "Not Found"],
        [451, "Unavailable For Legal Reasons"],
        [503, "Server Error"],
      ].map(async ([status, message]) => {
        const { fetchImpl } = jsonFetch({ message }, { status: status as number });
        const result = await new GithubHttpClient({ fetchImpl }).get("/users/x");
        return result.ok ? "ok" : result.error.code;
      }),
    );
    expect(codes).toEqual(["not_found", "suspended", "upstream_error"]);
  });

  it("reports unreadable JSON rather than throwing", async () => {
    const fetchImpl: typeof globalThis.fetch = () =>
      Promise.resolve(new Response("<html>nope</html>", { status: 200 }));
    const result = await new GithubHttpClient({ fetchImpl }).get("/users/octocat");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("malformed_response");
  });

  it("enforces the request budget", async () => {
    const { fetchImpl, urls } = jsonFetch({});
    const client = new GithubHttpClient({ fetchImpl, maxRequests: 2 });
    await client.get("/users/a");
    await client.get("/users/b");
    expect(client.canSpend(1)).toBe(false);
    const third = await client.get("/users/c");
    expect(third.ok).toBe(false);
    expect(urls).toHaveLength(2);
  });

  it("rejects Content-Length above a bounded JSON envelope before consumption", async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    });
    const fetchImpl: typeof globalThis.fetch = () =>
      Promise.resolve(
        new Response(body, {
          headers: {
            "content-length": "1000",
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "39",
          },
        }),
      );
    const client = new GithubHttpClient({ fetchImpl });
    const result = await client.getBoundedJson("/bounded", 100);
    expect(result).toMatchObject({ ok: false, error: { code: "response_too_large" } });
    expect(canceled).toBe(true);
    expect(client.requestsUsed).toBe(1);
    expect(client.rateLimit.remaining).toBe(39);
  });

  it("cancels a chunked body as soon as the bounded envelope is crossed", async () => {
    let pulls = 0;
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode(pulls === 1 ? '{"a":"' : "xxxxxxxx"));
      },
      cancel() {
        canceled = true;
      },
    });
    const fetchImpl: typeof globalThis.fetch = () => Promise.resolve(new Response(body));
    const client = new GithubHttpClient({ fetchImpl });
    const result = await client.getBoundedJson("/bounded", 10);
    expect(result).toMatchObject({ ok: false, error: { code: "response_too_large" } });
    expect(pulls).toBeLessThanOrEqual(3);
    expect(canceled).toBe(true);
    expect(client.requestsUsed).toBe(1);
  });
});
