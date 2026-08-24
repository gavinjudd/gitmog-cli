import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Blocks outbound network access from the Node APIs this repository can reach.
 *
 * Boundary, stated honestly: this is an in-process JavaScript guard. It covers
 * fetch, WebSocket, node:http, node:https, node:net and node:dns. It does not
 * constrain child processes, native addons, or anything below the Node API
 * surface, and it is not operating-system-level network isolation.
 *
 * Loopback destinations stay reachable so that gated integration tests and the
 * test runner's own machinery keep working.
 */
export const NO_NETWORK_MESSAGE = "Network access is disabled in the default test suite";

const INSTALLED = Symbol.for("gitmog.no-network.installed");

const LOOPBACK_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function isLoopback(host: string): boolean {
  const bare = host.startsWith("[") ? host : (host.split(":")[0] ?? "");
  return LOOPBACK_HOSTS.has(bare.toLowerCase());
}

function deny(target: string): never {
  throw new Error(`${NO_NETWORK_MESSAGE}. Blocked: ${target}`);
}

function hostFromUrlish(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function hostFromHttpArguments(args: readonly unknown[]): string {
  const first = args[0];
  if (typeof first === "string") return hostFromUrlish(first);
  if (first instanceof URL) return first.hostname;
  if (typeof first === "object" && first !== null) {
    const options = first as { host?: unknown; hostname?: unknown; socketPath?: unknown };
    if (typeof options.socketPath === "string") return "";
    if (typeof options.hostname === "string") return options.hostname;
    if (typeof options.host === "string") return options.host;
  }
  return "";
}

function hostFromSocketArguments(args: readonly unknown[]): string {
  const first = args[0];
  if (typeof first === "string") return "";
  if (typeof first === "object" && first !== null) {
    const options = first as { host?: unknown; path?: unknown };
    if (typeof options.path === "string") return "";
    if (typeof options.host === "string") return options.host;
    return "";
  }
  const second = args[1];
  return typeof second === "string" ? second : "";
}

type Guarded = Record<string, unknown>;

function guard(target: Guarded, key: string, hostOf: (args: readonly unknown[]) => string): void {
  const original = target[key];
  if (typeof original !== "function") return;
  const wrapped = function guarded(this: unknown, ...args: unknown[]): unknown {
    const host = hostOf(args);
    if (!isLoopback(host)) deny(`${key} ${host}`);
    return (original as (...callArgs: unknown[]) => unknown).apply(this, args);
  };
  target[key] = wrapped;
}

function installNoNetworkGuard(): void {
  const scope = globalThis as unknown as Record<symbol, boolean>;
  if (scope[INSTALLED] === true) return;
  scope[INSTALLED] = true;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: unknown, init?: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : ((input as { url?: string }).url ?? "");
    if (!isLoopback(hostFromUrlish(url))) deny(`fetch ${url}`);
    return originalFetch(input as RequestInfo, init as RequestInit | undefined);
  }) as typeof globalThis.fetch;

  const NativeWebSocket = globalThis.WebSocket;
  if (typeof NativeWebSocket === "function") {
    globalThis.WebSocket = class GuardedWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const href = typeof url === "string" ? url : url.href;
        if (!isLoopback(hostFromUrlish(href))) deny(`WebSocket ${href}`);
        super(url, protocols);
      }
    };
  }

  for (const key of ["request", "get"]) {
    guard(http as unknown as Guarded, key, hostFromHttpArguments);
    guard(https as unknown as Guarded, key, hostFromHttpArguments);
  }

  guard(net as unknown as Guarded, "createConnection", hostFromSocketArguments);
  guard(net as unknown as Guarded, "connect", hostFromSocketArguments);
  guard(net.Socket.prototype as unknown as Guarded, "connect", hostFromSocketArguments);

  const hostFromFirstArgument = (args: readonly unknown[]): string =>
    typeof args[0] === "string" ? args[0] : "";
  for (const key of ["lookup", "resolve"]) {
    guard(dns as unknown as Guarded, key, hostFromFirstArgument);
    guard(dnsPromises as unknown as Guarded, key, hostFromFirstArgument);
  }
}

installNoNetworkGuard();
