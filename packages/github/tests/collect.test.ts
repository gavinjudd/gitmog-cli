import { describe, expect, it } from "vitest";

import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
  type PersonaSpec,
} from "@gitmog/test-fixtures/github-personas";
import { collectProfileSnapshot, REQUEST_BUDGETS } from "../src/collect.js";
import { EVENTS_PER_PAGE, MAX_EVENT_PAGES, MAX_PROFILE_EVENTS } from "../src/types.js";
import { createSnapshotCache } from "../src/cache.js";
import type { ProfileSnapshot } from "../src/types.js";

const collect = async (persona: PersonaSpec, options: Record<string, unknown> = {}) => {
  const fetchImpl = createFixtureFetch(persona);
  const result = await collectProfileSnapshot(persona.login, {
    fetchImpl,
    cache: null,
    now: () => FIXTURE_NOW_MS,
    ...options,
  });
  return { result, fetchImpl };
};

const expectSnapshot = (result: Awaited<ReturnType<typeof collect>>["result"]): ProfileSnapshot => {
  if (!result.ok) throw new Error(`expected a snapshot, got ${result.error.code}`);
  return result.snapshot;
};

describe("collectProfileSnapshot", () => {
  it("collects a complete tokenless snapshot inside the anonymous budget", async () => {
    const { result, fetchImpl } = await collect(PERSONAS.strongMaintainer);
    const snapshot = expectSnapshot(result);

    expect(snapshot.profile.login).toBe("strongmaintainer");
    expect(snapshot.repositories).toHaveLength(5);
    expect(snapshot.eligibleRepositoryCount).toBe(5);
    expect(snapshot.selectedRepositories).toHaveLength(
      REQUEST_BUDGETS.anonymous.inspectedRepositories,
    );
    expect(snapshot.commitSample?.commits.length).toBeGreaterThan(20);
    expect(snapshot.budget.usedRequests).toBeLessThanOrEqual(REQUEST_BUDGETS.anonymous.maxRequests);
    expect(fetchImpl.calls.length).toBe(snapshot.budget.usedRequests);
    if (result.ok) expect(result.requestsUsed).toBe(fetchImpl.calls.length);
  });

  it("never sends an authorization header without a token, and never leaks one with it", async () => {
    const { fetchImpl } = await collect(PERSONAS.strongMaintainer);
    expect(fetchImpl.headerNames).not.toContain("authorization");

    const authorized = createFixtureFetch(PERSONAS.strongMaintainer);
    const result = await collectProfileSnapshot("strongmaintainer", {
      fetchImpl: authorized,
      cache: null,
      now: () => FIXTURE_NOW_MS,
      token: "ghp_fixture_secret_value",
    });
    const snapshot = expectSnapshot(result);
    expect(authorized.headerNames).toContain("authorization");
    expect(JSON.stringify(snapshot)).not.toContain("ghp_fixture_secret_value");
    expect(snapshot.rateLimit.authenticated).toBe(true);
  });

  it("keeps authenticated and anonymous evidence byte-identical", async () => {
    const anonymous = expectSnapshot((await collect(PERSONAS.strongMaintainer)).result);
    const authenticated = expectSnapshot(
      (await collect(PERSONAS.strongMaintainer, { token: "ghp_fixture" })).result,
    );
    expect(authenticated.snapshotKey).toBe(anonymous.snapshotKey);
    expect(authenticated.profile).toEqual(anonymous.profile);
    expect(authenticated.repositories).toEqual(anonymous.repositories);
    expect(authenticated.inspections).toEqual(anonymous.inspections);
    expect(authenticated.events).toEqual(anonymous.events);
    expect(authenticated.commitSample).toEqual(anonymous.commitSample);
    expect(authenticated.budget.maxInspectedRepositories).toBe(
      REQUEST_BUDGETS.anonymous.inspectedRepositories,
    );
  });

  it("keeps the six-request minimum useful envelope honest and bounded", async () => {
    const { result, fetchImpl } = await collect(PERSONAS.strongMaintainer, { maxRequests: 6 });
    const snapshot = expectSnapshot(result);
    expect(fetchImpl.calls).toHaveLength(6);
    expect(snapshot.budget).toMatchObject({ maxRequests: 6, usedRequests: 6, exhausted: true });
    expect(snapshot.profile.login).toBe(PERSONAS.strongMaintainer.login);
    expect(snapshot.repositories.length).toBeGreaterThan(0);
    expect(snapshot.inspections).toHaveLength(1);
    expect(snapshot.degradations.join(" ")).toContain(
      "request budget stopped repository inspection",
    );
  });

  it("caps repository pagination and says so", async () => {
    const wide: PersonaSpec = {
      login: "widespread",
      repos: Array.from({ length: 260 }, (_value, index) => ({
        name: `repo-${String(index)}`,
        sizeKb: 100,
      })),
      trees: {},
    };
    const { result, fetchImpl } = await collect(wide);
    const snapshot = expectSnapshot(result);
    const repoCalls = fetchImpl.calls.filter((call) => call.includes("/repos?"));
    expect(repoCalls).toHaveLength(REQUEST_BUDGETS.anonymous.repositoryPages);
    expect(snapshot.repositories).toHaveLength(200);
    expect(snapshot.repositoryListComplete).toBe(false);
    expect(snapshot.degradations.join(" ")).toContain("most recently pushed repositories");
  });

  it("caps the event window and records the truncation", async () => {
    const busy: PersonaSpec = {
      login: "eventstorm",
      repos: [{ name: "main-project", sizeKb: 900 }],
      trees: { "main-project": ["README.md", "src/index.ts"] },
      events: Array.from({ length: 400 }, (_value, index) => ({
        type: "PushEvent",
        repo: "eventstorm/main-project",
        daysAgo: index % 60,
      })),
    };
    const { result, fetchImpl } = await collect(busy);
    const snapshot = expectSnapshot(result);
    expect(fetchImpl.calls.filter((call) => call.includes("/events/public"))).toHaveLength(
      REQUEST_BUDGETS.anonymous.eventPages,
    );
    expect(snapshot.events).toHaveLength(200);
    expect(snapshot.eventWindow.truncated).toBe(true);
  });

  it("uses the same event depth for authenticated and anonymous collection", async () => {
    const busy: PersonaSpec = {
      login: "authenticeventstorm",
      repos: [{ name: "main-project", sizeKb: 900 }],
      trees: { "main-project": ["README.md", "src/index.ts"] },
      events: Array.from({ length: MAX_PROFILE_EVENTS + 50 }, (_value, index) => ({
        type: "PushEvent",
        repo: "authenticeventstorm/main-project",
        daysAgo: index % 60,
      })),
    };
    const { result, fetchImpl } = await collect(busy, { token: "fixture-token" });
    const snapshot = expectSnapshot(result);
    const eventCalls = fetchImpl.calls.filter((call) => call.includes("/events/public"));
    expect(MAX_PROFILE_EVENTS).toBe(MAX_EVENT_PAGES * EVENTS_PER_PAGE);
    expect(REQUEST_BUDGETS.authenticated.eventPages).toBe(REQUEST_BUDGETS.anonymous.eventPages);
    expect(eventCalls).toHaveLength(REQUEST_BUDGETS.authenticated.eventPages);
    expect(eventCalls.every((call) => call.includes(`per_page=${String(EVENTS_PER_PAGE)}`))).toBe(
      true,
    );
    expect(snapshot.events).toHaveLength(
      REQUEST_BUDGETS.authenticated.eventPages * EVENTS_PER_PAGE,
    );
    expect(snapshot.eventWindow.truncated).toBe(true);
  });

  it("returns partial evidence when one repository endpoint fails", async () => {
    const { result } = await collect(PERSONAS.partialTreeFailure);
    const snapshot = expectSnapshot(result);
    const failed = snapshot.inspections.filter((inspection) =>
      inspection.failures.includes("tree"),
    );
    expect(failed.length).toBeGreaterThan(0);
    expect(snapshot.inspections.some((inspection) => inspection.tree !== null)).toBe(true);
  });

  it("maps a missing user to not_found without inventing a profile", async () => {
    const { result } = await collect(PERSONAS.notFound);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_found");
  });

  it("maps an exhausted rate limit to rate_limited", async () => {
    const { result } = await collect(PERSONAS.rateLimited);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("rate_limited");
    expect(result.error.resetAt).toBeTypeOf("string");
  });

  it("rejects an invalid handle before making any request", async () => {
    const fetchImpl = createFixtureFetch(PERSONAS.strongMaintainer);
    const result = await collectProfileSnapshot("not a handle", { fetchImpl, cache: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_handle");
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("selects the same repositories every time for the same input", async () => {
    const first = expectSnapshot((await collect(PERSONAS.strongMaintainer)).result);
    const second = expectSnapshot((await collect(PERSONAS.strongMaintainer)).result);
    expect(second.selectedRepositories).toEqual(first.selectedRepositories);
    expect(second.snapshotKey).toBe(first.snapshotKey);
  });

  it("serves a cached snapshot without touching the network again", async () => {
    const cache = createSnapshotCache<ProfileSnapshot>();
    const fetchImpl = createFixtureFetch(PERSONAS.strongMaintainer);
    const options = { fetchImpl, cache, now: () => FIXTURE_NOW_MS };
    const first = await collectProfileSnapshot("strongmaintainer", options);
    const callsAfterFirst = fetchImpl.calls.length;
    const second = await collectProfileSnapshot("strongmaintainer", options);
    expect(fetchImpl.calls.length).toBe(callsAfterFirst);
    expect(expectSnapshot(second).snapshotKey).toBe(expectSnapshot(first).snapshotKey);
    if (second.ok) expect(second.requestsUsed).toBe(0);
  });

  it("times out rather than hanging", async () => {
    const hang: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("timed out", "TimeoutError"));
        });
      });
    const result = await collectProfileSnapshot("strongmaintainer", {
      fetchImpl: hang,
      cache: null,
      timeoutMs: 10,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("timeout");
  });
});
