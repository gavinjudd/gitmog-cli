import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { runPrivateContext } from "../src/run.js";
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

const sha = (character: string): string => character.repeat(40);

const repository = (
  fullName: string,
  options: {
    readonly visibility?: "private" | "internal" | "public";
    readonly ownerType?: "User" | "Organization";
    readonly permissions?: Record<string, boolean>;
    readonly id?: number;
  } = {},
) => {
  const [owner, name] = fullName.split("/") as [string, string];
  const visibility = options.visibility ?? "private";
  return {
    id: options.id ?? 101,
    name,
    full_name: fullName,
    private: visibility === "private",
    visibility,
    owner: { login: owner, type: options.ownerType ?? "User" },
    permissions: options.permissions ?? { admin: false, maintain: false, push: true, pull: true },
    html_url: `https://github.com/${fullName}`,
    description: "Synthetic bounded repository",
    fork: false,
    archived: false,
    disabled: false,
    is_template: false,
    mirror_url: null,
    size: 512,
    stargazers_count: 999,
    forks_count: 999,
    open_issues_count: 0,
    language: "TypeScript",
    topics: [],
    homepage: null,
    license: { spdx_id: "MIT" },
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    pushed_at: "2026-08-01T00:00:00.000Z",
    default_branch: "main",
  };
};

const selectedFixture = (
  repositories: readonly Record<string, unknown>[],
  options: { readonly linkedAuthor?: boolean; readonly treePath?: string } = {},
) => {
  const requests: Request[] = [];
  const source = "export function add(a: number, b: number): number { return a + b; }\n";
  const fetchImpl: typeof fetch = (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const url = new URL(request.url);
    if (url.pathname === "/user") return Promise.resolve(Response.json({ login: "FixtureUser" }));
    if (url.pathname === "/user/installations")
      return Promise.resolve(
        Response.json({
          installations: [
            {
              id: 77,
              app_id: 123456,
              repository_selection: "selected",
              permissions: { metadata: "read", contents: "read" },
            },
          ],
        }),
      );
    if (url.pathname === "/user/installations/77/repositories")
      return Promise.resolve(Response.json({ total_count: repositories.length, repositories }));
    if (url.pathname.endsWith("/commits/main"))
      return Promise.resolve(Response.json({ sha: sha("a"), commit: { tree: { sha: sha("b") } } }));
    if (url.pathname.includes("/git/trees/"))
      return Promise.resolve(
        Response.json({
          sha: sha("b"),
          truncated: false,
          tree: [
            {
              path: options.treePath ?? "src/add.ts",
              mode: "100644",
              type: "blob",
              sha: sha("c"),
              size: source.length,
            },
            {
              path: ".github/workflows/verify.yml",
              mode: "100644",
              type: "blob",
              sha: sha("d"),
              size: 100,
            },
          ],
        }),
      );
    if (url.pathname.endsWith("/releases")) return Promise.resolve(Response.json([]));
    if (url.pathname.includes("/git/blobs/"))
      return Promise.resolve(
        Response.json({
          encoding: "base64",
          size: Buffer.byteLength(source),
          content: Buffer.from(source).toString("base64"),
        }),
      );
    if (url.pathname.endsWith("/commits") && url.searchParams.has("author"))
      return Promise.resolve(
        Response.json([
          options.linkedAuthor === false
            ? {
                sha: sha("e"),
                author: null,
                committer: { login: "FixtureUser" },
                commit: {
                  author: {
                    name: "FixtureUser",
                    email: "fixture-user@example.invalid",
                  },
                },
              }
            : {
                sha: sha("e"),
                author: { login: "FixtureUser" },
                commit: { message: "private commit message must not leave the process" },
              },
        ]),
      );
    return Promise.resolve(Response.json({ message: "not found" }, { status: 404 }));
  };
  return { fetchImpl, requests, source };
};

describe("bounded private repository collection", () => {
  it("accepts a selected personal installation and emits aggregates only", async () => {
    const privateName = "FixtureUser/sensitive-private-project";
    const fixture = selectedFixture([repository(privateName)]);
    const outcome = await runPrivateContext({
      handles: ["FixtureUser", "Opponent"],
      token: "private_fixture_access_token_123456",
      config,
      fetchImpl: fixture.fetchImpl,
      now: () => Date.parse("2026-08-25T00:00:00.000Z"),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result).toMatchObject({
      subject: "FixtureUser",
      scoreInfluence: 0,
      publicWinnerInfluence: 0,
      persisted: false,
      repositorySelection: {
        installedPrivateRepositories: 1,
        consideredRepositories: 1,
        analyzedRepositories: 1,
        maintainedRepositories: 1,
        attributableRepositories: 1,
      },
    });
    const serialized = JSON.stringify(outcome.result);
    expect(serialized).not.toContain(privateName);
    expect(serialized).not.toContain("sensitive-private-project");
    expect(serialized).not.toContain("src/add.ts");
    expect(serialized).not.toContain(fixture.source.trim());
    expect(serialized).not.toContain("private_fixture_access_token_123456");
    expect(
      fixture.requests.every(
        (request) =>
          request.headers.get("authorization") === "Bearer private_fixture_access_token_123456",
      ),
    ).toBe(true);
    expect(fixture.requests.every((request) => request.redirect === "error")).toBe(true);
    expect(
      fixture.requests.every((request) => new URL(request.url).origin === "https://api.github.com"),
    ).toBe(true);
    expect(
      fixture.requests.every(
        (request) =>
          !request.url.includes("issues") &&
          !request.url.includes("pulls") &&
          !request.url.includes("actions"),
      ),
    ).toBe(true);
  });

  it("keeps malicious private paths, controls, and commit messages out of the aggregate result", async () => {
    const maliciousPath = "src/private\u001b[31m-marker.ts";
    const fixture = selectedFixture([repository("FixtureUser/private-project")], {
      treePath: maliciousPath,
    });
    const outcome = await runPrivateContext({
      handles: ["FixtureUser", "Opponent"],
      token: "private_fixture_access_token_123456",
      config,
      fetchImpl: fixture.fetchImpl,
      now: () => Date.parse("2026-08-25T00:00:00.000Z"),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const serialized = JSON.stringify(outcome.result);
    expect(serialized).not.toContain(maliciousPath);
    expect(serialized).not.toContain("\\u001b");
    expect(serialized).not.toContain("private commit message");
    expect(serialized).not.toContain("private-project");
  });

  it("rejects all-repository installations before listing or reading a repository", async () => {
    const paths: string[] = [];
    const outcome = await runPrivateContext({
      handles: ["FixtureUser", "Opponent"],
      token: "private_fixture_access_token_123456",
      config,
      fetchImpl: (input) => {
        const path = new URL(new Request(input).url).pathname;
        paths.push(path);
        return Promise.resolve(
          path === "/user"
            ? Response.json({ login: "FixtureUser" })
            : Response.json({
                installations: [
                  {
                    id: 77,
                    app_id: 123456,
                    repository_selection: "all",
                    permissions: { metadata: "read", contents: "read" },
                  },
                ],
              }),
        );
      },
    });
    expect(outcome).toEqual({
      ok: false,
      error: {
        code: "private_context_selected_repositories_required",
        message:
          "Change the GitHub App installation to Only select repositories, then run it again.",
      },
    });
    expect(paths).toEqual(["/user", "/user/installations"]);
  });

  it("rejects an identity mismatch before any installation or repository request", async () => {
    const paths: string[] = [];
    const outcome = await runPrivateContext({
      handles: ["LeftFixture", "RightFixture"],
      token: "private_fixture_access_token_123456",
      config,
      fetchImpl: (input) => {
        paths.push(new URL(new Request(input).url).pathname);
        return Promise.resolve(Response.json({ login: "ActualFixture" }));
      },
    });
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "private_context_identity_mismatch", signedInAs: "ActualFixture" },
    });
    expect(paths).toEqual(["/user"]);
  });

  it("excludes public and different-person repositories and keeps org pull access attribution-only", async () => {
    const fixture = selectedFixture([
      repository("FixtureUser/public-project", { visibility: "public", id: 1 }),
      repository("DifferentUser/private-project", { id: 2 }),
      repository("SyntheticOrg/private-project", {
        ownerType: "Organization",
        permissions: { admin: false, maintain: false, push: true, pull: true },
        id: 3,
      }),
    ]);
    const outcome = await runPrivateContext({
      handles: ["Opponent", "fixtureuser"],
      token: "private_fixture_access_token_123456",
      config,
      fetchImpl: fixture.fetchImpl,
      now: () => Date.parse("2026-08-25T00:00:00.000Z"),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.subject).toBe("FixtureUser");
    expect(outcome.result.repositorySelection).toMatchObject({
      installedPrivateRepositories: 1,
      maintainedRepositories: 0,
      attributableRepositories: 1,
    });
    expect(outcome.result.relationship).toBe("attributed-only");
  });

  it("bounds more than five repositories deterministically without using popularity", async () => {
    const repositories = ["zeta", "epsilon", "delta", "gamma", "beta", "alpha"].map((name, index) =>
      repository(`FixtureUser/${name}`, { id: index + 1 }),
    );
    const fixture = selectedFixture(repositories);
    const outcome = await runPrivateContext({
      handles: ["FixtureUser", "Opponent"],
      token: "private_fixture_access_token_123456",
      config,
      fetchImpl: fixture.fetchImpl,
      now: () => Date.parse("2026-08-25T00:00:00.000Z"),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.repositorySelection).toMatchObject({
      installedPrivateRepositories: 6,
      consideredRepositories: 5,
      analyzedRepositories: 5,
    });
    expect(outcome.result.limitations).toContainEqual({
      code: "repository-limit",
      detail: "The five-repository Private Context limit was applied deterministically.",
      count: 1,
    });
    const repositoryReads = fixture.requests
      .map((request) => new URL(request.url).pathname)
      .filter((path) => path.includes("/commits/main"));
    expect(repositoryReads.some((path) => path.includes("/zeta/"))).toBe(false);
    expect(new Set(repositoryReads.map((path) => path.split("/")[3])).size).toBe(5);
  });

  it.each(["maintain", "admin"] as const)(
    "treats organization %s permission as maintained",
    async (permission) => {
      const fixture = selectedFixture([
        repository("SyntheticOrg/private-project", {
          ownerType: "Organization",
          permissions: {
            admin: permission === "admin",
            maintain: permission === "maintain",
            push: true,
            pull: true,
          },
        }),
      ]);
      const outcome = await runPrivateContext({
        handles: ["FixtureUser", "Opponent"],
        token: "private_fixture_access_token_123456",
        config,
        fetchImpl: fixture.fetchImpl,
        now: () => Date.parse("2026-08-25T00:00:00.000Z"),
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.repositorySelection.maintainedRepositories).toBe(1);
      expect(outcome.result.relationship).toBe("maintained-and-attributed");
    },
  );

  it("requires a GitHub-linked author and ignores committer, name, and email inference", async () => {
    const fixture = selectedFixture([repository("FixtureUser/private-project")], {
      linkedAuthor: false,
    });
    const outcome = await runPrivateContext({
      handles: ["FixtureUser", "Opponent"],
      token: "private_fixture_access_token_123456",
      config,
      fetchImpl: fixture.fetchImpl,
      now: () => Date.parse("2026-08-25T00:00:00.000Z"),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.repositorySelection).toMatchObject({
      maintainedRepositories: 1,
      attributableRepositories: 0,
    });
    expect(outcome.result.relationship).toBe("maintained-only");
  });
});
