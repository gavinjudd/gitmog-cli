export const DEVICE_FLOW_VERSION = "1.0.0-session-only";

/** Public identifier for the reviewed, device-flow-only Git Mog CLI OAuth app. */
export const GITMOG_OAUTH_CLIENT_ID = "Ov23liCoM36m2og1vuvv";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export interface DeviceAuthorizationPrompt {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresAt: string;
  readonly intervalSeconds: number;
}

export type DeviceAuthorizationError =
  "access_denied" | "expired" | "cancelled" | "network" | "timeout" | "malformed" | "configuration";

export type DeviceAuthorizationResult =
  | {
      readonly ok: true;
      /** Session-only bearer value. Callers must not log, serialize, cache, or persist it. */
      readonly token: string;
      readonly tokenType: "bearer";
      readonly scopes: readonly string[];
    }
  | { readonly ok: false; readonly error: DeviceAuthorizationError };

export interface DeviceAuthorizationOptions {
  readonly clientId?: string | undefined;
  readonly fetchImpl?: typeof globalThis.fetch | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly now?: (() => number) | undefined;
  readonly sleep?: ((milliseconds: number, signal?: AbortSignal) => Promise<void>) | undefined;
  readonly onPrompt: (prompt: DeviceAuthorizationPrompt) => void | Promise<void>;
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
      "user-agent": "gitmog-device-flow",
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

const requestFailure = (cause: unknown): DeviceAuthorizationError => {
  const name = cause instanceof Error ? cause.name : "";
  return name === "AbortError" ? "cancelled" : name === "TimeoutError" ? "timeout" : "network";
};

export async function authorizeGithubDevice(
  options: DeviceAuthorizationOptions,
): Promise<DeviceAuthorizationResult> {
  const clientId = (options.clientId ?? GITMOG_OAUTH_CLIENT_ID).trim();
  if (!/^[A-Za-z0-9]{10,128}$/.test(clientId)) {
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
    !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(userCode) ||
    verificationUri === null ||
    !boundedInteger(expiresIn, 60, 1_800) ||
    !boundedInteger(interval, 1, 60)
  ) {
    return { ok: false, error: "malformed" };
  }
  const expiresAtMs = now() + expiresIn * 1000;
  try {
    await options.onPrompt({
      userCode,
      verificationUri,
      expiresAt: new Date(expiresAtMs).toISOString(),
      intervalSeconds: interval,
    });
  } catch {
    return { ok: false, error: "cancelled" };
  }

  let intervalSeconds = interval;
  while (now() < expiresAtMs) {
    try {
      await sleep(intervalSeconds * 1000, signal);
    } catch (cause) {
      return { ok: false, error: requestFailure(cause) };
    }
    if (now() >= expiresAtMs) return { ok: false, error: "expired" };
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
      const scopes =
        typeof tokenBody.scope === "string" && tokenBody.scope.trim() !== ""
          ? tokenBody.scope.split(/\s+/).filter(Boolean)
          : [];
      return { ok: true, token: tokenBody.access_token, tokenType: "bearer", scopes };
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
    if (error === "expired_token" || error === "token_expired") {
      return { ok: false, error: "expired" };
    }
    return { ok: false, error: "malformed" };
  }
  return { ok: false, error: "expired" };
}
