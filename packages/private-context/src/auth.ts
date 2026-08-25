import type { PrivateContextAppConfig } from "./types.js";

export const PRIVATE_CONTEXT_DEVICE_FLOW_VERSION = "1.0.0-session-only-github-app";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export interface PrivateDeviceAuthorizationPrompt {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresAt: string;
  readonly intervalSeconds: number;
}

export type PrivateDeviceAuthorizationError =
  | "access_denied"
  | "expired"
  | "cancelled"
  | "network"
  | "timeout"
  | "malformed"
  | "unexpected_scope"
  | "conflicting_token_boundary"
  | "configuration";

export interface PrivateAccessTokenLease {
  readonly active: boolean;
  readonly expiresAt: string | null;
  use<T>(callback: (token: string) => Promise<T>): Promise<T>;
  dispose(): void;
}

export type PrivateDeviceAuthorizationResult =
  | { readonly ok: true; readonly lease: PrivateAccessTokenLease }
  | { readonly ok: false; readonly error: PrivateDeviceAuthorizationError };

export interface PrivateDeviceAuthorizationOptions {
  readonly config: PrivateContextAppConfig;
  readonly forbiddenTokens?: readonly string[] | undefined;
  readonly fetchImpl?: typeof globalThis.fetch | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly now?: (() => number) | undefined;
  readonly sleep?: ((milliseconds: number, signal?: AbortSignal) => Promise<void>) | undefined;
  readonly onPrompt: (prompt: PrivateDeviceAuthorizationPrompt) => void | Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const boundedInteger = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;

const abortableSleep = async (milliseconds: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted === true) throw new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const finish = (callback: () => void): void => {
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const timer = setTimeout(() => finish(resolve), milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      finish(() => reject(new DOMException("Aborted", "AbortError")));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted === true) abort();
  });
};

const postForm = async (
  fetchImpl: typeof globalThis.fetch,
  url: string,
  body: URLSearchParams,
  signal: AbortSignal | undefined,
): Promise<Response> =>
  fetchImpl(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "gitmog-private-context-device-flow",
    },
    body,
    redirect: "error",
    signal:
      signal === undefined
        ? AbortSignal.timeout(8_000)
        : AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
  });

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const safeVerificationUri = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname === "/login/device" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
      ? url.toString()
      : null;
  } catch {
    return null;
  }
};

const requestFailure = (cause: unknown): PrivateDeviceAuthorizationError => {
  const name = cause instanceof Error ? cause.name : "";
  return name === "AbortError" ? "cancelled" : name === "TimeoutError" ? "timeout" : "network";
};

const createLease = (value: string, expiresAt: string | null): PrivateAccessTokenLease => {
  let token: string | undefined = value;
  let inUse = false;
  const lease: PrivateAccessTokenLease = {
    get active() {
      return token !== undefined;
    },
    expiresAt,
    use: async <T>(callback: (accessToken: string) => Promise<T>): Promise<T> => {
      if (token === undefined || inUse) throw new Error("Private Context token is unavailable.");
      inUse = true;
      const current = token;
      try {
        return await callback(current);
      } finally {
        token = undefined;
        inUse = false;
      }
    },
    dispose: () => {
      token = undefined;
      inUse = false;
    },
  };
  return lease;
};

export async function authorizePrivateGithubDevice(
  options: PrivateDeviceAuthorizationOptions,
): Promise<PrivateDeviceAuthorizationResult> {
  const clientId = options.config.clientId.trim();
  if (!/^Iv[0-9A-Za-z]{18,126}$/u.test(clientId)) {
    return { ok: false, error: "configuration" };
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableSleep;
  const signal = options.signal;
  let codeResponse: Response;
  try {
    codeResponse = await postForm(
      fetchImpl,
      DEVICE_CODE_URL,
      new URLSearchParams({ client_id: clientId }),
      signal,
    );
  } catch (cause) {
    return { ok: false, error: requestFailure(cause) };
  }
  const codeBody = await readJson(codeResponse);
  if (!codeResponse.ok || !isRecord(codeBody)) return { ok: false, error: "malformed" };
  const deviceCode = codeBody.device_code;
  const userCode = codeBody.user_code;
  const verificationUri = safeVerificationUri(codeBody.verification_uri);
  const expiresIn = codeBody.expires_in;
  const interval = codeBody.interval;
  if (
    typeof deviceCode !== "string" ||
    deviceCode.length < 20 ||
    deviceCode.length > 256 ||
    typeof userCode !== "string" ||
    !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/u.test(userCode) ||
    verificationUri === null ||
    !boundedInteger(expiresIn, 60, 1_800) ||
    !boundedInteger(interval, 1, 60)
  ) {
    return { ok: false, error: "malformed" };
  }
  const flowExpiresAtMs = now() + expiresIn * 1_000;
  try {
    await options.onPrompt({
      userCode,
      verificationUri,
      expiresAt: new Date(flowExpiresAtMs).toISOString(),
      intervalSeconds: interval,
    });
  } catch {
    return { ok: false, error: "cancelled" };
  }

  let intervalSeconds = interval;
  while (now() < flowExpiresAtMs) {
    try {
      await sleep(intervalSeconds * 1_000, signal);
    } catch (cause) {
      return { ok: false, error: requestFailure(cause) };
    }
    if (now() >= flowExpiresAtMs) return { ok: false, error: "expired" };
    let tokenResponse: Response;
    try {
      tokenResponse = await postForm(
        fetchImpl,
        ACCESS_TOKEN_URL,
        new URLSearchParams({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: GRANT_TYPE,
        }),
        signal,
      );
    } catch (cause) {
      return { ok: false, error: requestFailure(cause) };
    }
    const tokenBody = await readJson(tokenResponse);
    if (!tokenResponse.ok || !isRecord(tokenBody)) return { ok: false, error: "malformed" };
    if (typeof tokenBody.access_token === "string" && tokenBody.token_type === "bearer") {
      if (typeof tokenBody.scope !== "string" || tokenBody.scope.trim() !== "")
        return { ok: false, error: "unexpected_scope" };
      if (!/^[A-Za-z0-9_]{20,512}$/u.test(tokenBody.access_token))
        return { ok: false, error: "malformed" };
      if (options.forbiddenTokens?.includes(tokenBody.access_token) === true)
        return { ok: false, error: "conflicting_token_boundary" };
      const tokenExpiresIn = tokenBody.expires_in;
      const tokenExpiresAt =
        tokenExpiresIn === undefined
          ? null
          : boundedInteger(tokenExpiresIn, 60, 86_400)
            ? new Date(now() + tokenExpiresIn * 1_000).toISOString()
            : undefined;
      if (tokenExpiresAt === undefined) return { ok: false, error: "malformed" };
      return {
        ok: true,
        lease: createLease(tokenBody.access_token, tokenExpiresAt),
      };
    }
    const error = tokenBody.error;
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      const returnedInterval = tokenBody.interval;
      intervalSeconds = Math.max(
        intervalSeconds + 5,
        boundedInteger(returnedInterval, 1, 300) ? returnedInterval : 0,
      );
      continue;
    }
    if (error === "access_denied") return { ok: false, error: "access_denied" };
    if (error === "expired_token" || error === "token_expired")
      return { ok: false, error: "expired" };
    return { ok: false, error: "malformed" };
  }
  return { ok: false, error: "expired" };
}
