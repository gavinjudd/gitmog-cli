import { GITHUB_REST_BASE_URL } from "./endpoints.js";
import type { GithubError, RateLimitStatus } from "./types.js";

const GITHUB_ORIGIN = new URL(GITHUB_REST_BASE_URL).origin;

export const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
export const DEFAULT_USER_AGENT = "gitmog-fast-scan";

export interface GithubHttpOptions {
  /** Server-side only. Never rendered, never logged, never returned to a client. */
  readonly token?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxRequests?: number | undefined;
  readonly fetchImpl?: typeof globalThis.fetch | undefined;
  readonly userAgent?: string | undefined;
}

export type GithubFetchResult<T> =
  | { readonly ok: true; readonly status: number; readonly data: T }
  | { readonly ok: false; readonly status: number | null; readonly error: GithubError };

const asNumber = (value: string | null): number | null => {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const messageOf = (body: unknown): string => {
  if (typeof body === "object" && body !== null) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
};

/**
 * Minimal public-REST client.
 *
 * The API origin is a compile-time constant. Callers pass a path, never a URL, and a
 * constructed request whose origin is not GitHub's is refused rather than sent — so a
 * hostile username can never redirect a request at another host.
 */
export class GithubHttpClient {
  readonly #token: string | undefined;
  readonly #timeoutMs: number;
  readonly #maxRequests: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #userAgent: string;
  #used = 0;
  #rateLimit: RateLimitStatus;

  constructor(options: GithubHttpOptions = {}) {
    const token = options.token?.trim();
    this.#token = token === undefined || token === "" ? undefined : token;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#maxRequests = options.maxRequests ?? 16;
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.#rateLimit = {
      authenticated: this.#token !== undefined,
      limit: null,
      remaining: null,
      resetAt: null,
    };
  }

  get authenticated(): boolean {
    return this.#token !== undefined;
  }

  get requestsUsed(): number {
    return this.#used;
  }

  get maxRequests(): number {
    return this.#maxRequests;
  }

  get rateLimit(): RateLimitStatus {
    return this.#rateLimit;
  }

  /** True when `count` more requests fit inside the per-profile budget. */
  canSpend(count: number): boolean {
    return this.#used + count <= this.#maxRequests;
  }

  async get<T>(
    path: string,
    query: Readonly<Record<string, string>> = {},
  ): Promise<GithubFetchResult<T>> {
    return this.#get<T>(path, query, null);
  }

  /**
   * JSON request whose raw response body can never exceed `maximumBodyBytes` in memory.
   * Source-blob callers use this instead of the unrestricted metadata reader.
   */
  async getBoundedJson<T>(
    path: string,
    maximumBodyBytes: number,
    query: Readonly<Record<string, string>> = {},
  ): Promise<GithubFetchResult<T>> {
    if (!Number.isSafeInteger(maximumBodyBytes) || maximumBodyBytes <= 0) {
      return { ok: false, status: null, error: internal("Invalid response-body ceiling") };
    }
    return this.#get<T>(path, query, maximumBodyBytes);
  }

  async #get<T>(
    path: string,
    query: Readonly<Record<string, string>>,
    maximumBodyBytes: number | null,
  ): Promise<GithubFetchResult<T>> {
    if (!path.startsWith("/") || path.startsWith("//")) {
      return { ok: false, status: null, error: internal(`Refusing malformed path`) };
    }
    const url = new URL(`${GITHUB_REST_BASE_URL}${path}`);
    if (url.origin !== GITHUB_ORIGIN) {
      return { ok: false, status: null, error: internal("Refusing non-GitHub origin") };
    }
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    if (!this.canSpend(1)) {
      return { ok: false, status: null, error: internal("Request budget exhausted") };
    }
    this.#used += 1;

    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": this.#userAgent,
    };
    if (this.#token !== undefined) headers.authorization = `Bearer ${this.#token}`;

    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        return {
          ok: false,
          status: null,
          error: { code: "timeout", message: "GitHub did not respond in time." },
        };
      }
      return {
        ok: false,
        status: null,
        error: { code: "network_error", message: "GitHub could not be reached." },
      };
    }

    this.#rateLimit = readRateLimit(response.headers, this.authenticated);

    // GitHub status and headers are authoritative for a known rate limit. Do not
    // buffer an error body merely to rediscover what the response metadata already
    // established; oversized or unreadable bodies must not mask this outcome.
    const knownRateLimit = classifyRateLimit(response);
    if (knownRateLimit !== null) {
      await cancelBody(response);
      return { ok: false, status: response.status, error: knownRateLimit };
    }

    const read = await readResponseBody(response, maximumBodyBytes);
    if (!read.ok) {
      return {
        ok: false,
        status: response.status,
        error: read.oversized
          ? { code: "response_too_large", message: "GitHub returned an oversized response." }
          : { code: "malformed_response", message: "GitHub returned unreadable JSON." },
      };
    }

    let body: unknown = null;
    let parsed = true;
    const text = read.text;
    if (text !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        parsed = false;
      }
    }

    if (!response.ok) {
      return { ok: false, status: response.status, error: classify(response, messageOf(body)) };
    }
    if (!parsed) {
      return {
        ok: false,
        status: response.status,
        error: { code: "malformed_response", message: "GitHub returned unreadable JSON." },
      };
    }
    return { ok: true, status: response.status, data: body as T };
  }
}

type BodyReadResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly oversized: boolean };

const cancelBody = async (response: Response): Promise<void> => {
  await response.body?.cancel().catch(() => undefined);
};

async function readResponseBody(
  response: Response,
  maximumBodyBytes: number | null,
): Promise<BodyReadResult> {
  if (maximumBodyBytes === null) {
    const text = await response.text().catch(() => null);
    return text === null ? { ok: false, oversized: false } : { ok: true, text };
  }

  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader !== null && /^\d+$/.test(contentLengthHeader)) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isSafeInteger(contentLength) && contentLength > maximumBodyBytes) {
      await cancelBody(response);
      return { ok: false, oversized: true };
    }
  }

  const reader = response.body?.getReader();
  if (reader === undefined) return { ok: true, text: "" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next: unknown = await reader.read();
      if (typeof next !== "object" || next === null) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, oversized: false };
      }
      const result = next as { readonly done?: unknown; readonly value?: unknown };
      if (result.done === true) break;
      const chunk = result.value;
      if (!(chunk instanceof Uint8Array)) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, oversized: false };
      }
      if (total + chunk.byteLength > maximumBodyBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, oversized: true };
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, oversized: false };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, oversized: false };
  }
}

const internal = (message: string): GithubError => ({ code: "upstream_error", message });

function readRateLimit(headers: Headers, authenticated: boolean): RateLimitStatus {
  const reset = asNumber(headers.get("x-ratelimit-reset"));
  return {
    authenticated,
    limit: asNumber(headers.get("x-ratelimit-limit")),
    remaining: asNumber(headers.get("x-ratelimit-remaining")),
    resetAt: reset === null ? null : new Date(reset * 1000).toISOString(),
  };
}

function classify(response: Response, message: string): GithubError {
  const status = response.status;
  const lower = message.toLowerCase();
  if (status === 403 && lower.includes("rate limit")) return rateLimitError(response);

  if (status === 451 || lower.includes("suspended")) {
    return { code: "suspended", message: "That GitHub account is not publicly available." };
  }
  if (status === 404) {
    return { code: "not_found", message: "GitHub has no public record of that handle." };
  }
  if (status >= 500) {
    return { code: "upstream_error", message: `GitHub returned ${String(status)}.` };
  }
  return { code: "upstream_error", message: `GitHub refused the request (${String(status)}).` };
}

function classifyRateLimit(response: Response): GithubError | null {
  const remaining = asNumber(response.headers.get("x-ratelimit-remaining"));
  const retryAfter = asNumber(response.headers.get("retry-after"));
  return response.status === 429 ||
    (response.status === 403 && (remaining === 0 || retryAfter !== null))
    ? rateLimitError(response)
    : null;
}

function rateLimitError(response: Response): GithubError {
  const retryAfter = asNumber(response.headers.get("retry-after"));
  const reset = asNumber(response.headers.get("x-ratelimit-reset"));
  const remaining = asNumber(response.headers.get("x-ratelimit-remaining"));
  const rateLimitClass = remaining === 0 ? "primary" : "secondary";
  const secondsUntilReset =
    reset === null ? null : Math.max(0, reset - Math.floor(Date.now() / 1000));
  const wait = retryAfter ?? (rateLimitClass === "primary" ? secondsUntilReset : null);
  return {
    code: "rate_limited",
    message:
      rateLimitClass === "primary"
        ? "GitHub's public rate limit is exhausted."
        : "GitHub temporarily slowed this request.",
    rateLimitClass,
    remaining,
    ...(wait === null ? {} : { retryAfterSeconds: wait }),
    ...(reset === null ? {} : { resetAt: new Date(reset * 1000).toISOString() }),
  };
}
