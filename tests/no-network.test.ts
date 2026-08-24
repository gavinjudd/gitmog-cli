import dns from "node:dns";
import dnsPromises from "node:dns/promises";

import { describe, expect, it } from "vitest";

const externalHost = "offline-guard.example";
const resolverMethods = [
  "resolve",
  "resolve4",
  "resolve6",
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTxt",
  "reverse",
] as const;

describe("default test network guard", () => {
  it.each(["lookup", "lookupService", ...resolverMethods] as const)(
    "blocks dns.%s before it can perform I/O",
    (method) => {
      expect(() => (dns[method] as (...arguments_: unknown[]) => unknown)(externalHost)).toThrow(
        "Network access is disabled",
      );
    },
  );

  it.each(["lookup", "lookupService", ...resolverMethods] as const)(
    "blocks dns.promises.%s before it can perform I/O",
    (method) => {
      expect(() =>
        (dnsPromises[method] as (...arguments_: unknown[]) => unknown)(externalHost),
      ).toThrow("Network access is disabled");
    },
  );

  it.each(resolverMethods)("blocks Resolver.%s before it can perform I/O", (method) => {
    const callbackResolver = new dns.Resolver();
    const promiseResolver = new dnsPromises.Resolver();
    expect(() =>
      (callbackResolver[method] as (...arguments_: unknown[]) => unknown)(externalHost),
    ).toThrow("Network access is disabled");
    expect(() =>
      (promiseResolver[method] as (...arguments_: unknown[]) => unknown)(externalHost),
    ).toThrow("Network access is disabled");
  });
});
