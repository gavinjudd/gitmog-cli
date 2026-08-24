import { Buffer } from "node:buffer";

/**
 * Deterministic GitHub API fixtures.
 *
 * Shapes are transcribed from responses recorded against the live public API on
 * 2026-08-13 (see `packages/github/tests/fixtures/recorded/rest/`), with every field
 * this product does not read removed and nothing sensitive retained. No authorization
 * header was recorded, because the recordings were unauthenticated.
 *
 * Content is synthetic on purpose: `AGENTS.md` requires the default suite to be
 * offline and synthetic, and a persona set has to cover cases no real pair of accounts
 * provides at the same time.
 */

/** Every relative date in this module is measured from here, so fixtures never drift
 * with the wall clock. */
export const FIXTURE_NOW = "2026-08-13T09:30:00.000Z";
export const FIXTURE_NOW_MS = Date.parse(FIXTURE_NOW);

const DAY_MS = 86_400_000;

export const daysAgo = (days: number): string =>
  new Date(FIXTURE_NOW_MS - days * DAY_MS).toISOString();

export interface RepoSpec {
  readonly name: string;
  readonly sizeKb?: number;
  readonly language?: string | null;
  readonly stars?: number;
  readonly forks?: number;
  readonly fork?: boolean;
  readonly archived?: boolean;
  readonly disabled?: boolean;
  readonly isTemplate?: boolean;
  readonly mirrorUrl?: string | null;
  readonly createdDaysAgo?: number;
  readonly pushedDaysAgo?: number;
  readonly topics?: readonly string[];
  readonly homepage?: string | null;
  readonly defaultBranch?: string;
}

export interface PersonaSpec {
  readonly login: string;
  readonly name?: string | null;
  readonly accountCreatedDaysAgo?: number;
  readonly followers?: number;
  readonly repos: readonly RepoSpec[];
  /** Paths per repository name. A repository absent from this map has no tree. */
  readonly trees?: Readonly<Record<string, readonly string[]>>;
  /** Optional synthetic source bytes used by the personality-roast fixture path. */
  readonly sourceFiles?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly releases?: Readonly<Record<string, number>>;
  readonly languages?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly commitMessages?: readonly string[];
  readonly events?: readonly EventSpec[];
  /** Endpoints that should fail, keyed by a substring of the path. */
  readonly failures?: Readonly<Record<string, number>>;
  readonly userStatus?: number;
  readonly rateLimitRemaining?: number;
}

export interface EventSpec {
  readonly type: string;
  readonly repo: string;
  readonly daysAgo: number;
  readonly merged?: boolean;
  readonly actor?: string;
}

const repoJson = (login: string, spec: RepoSpec): Record<string, unknown> => ({
  id: hash(`${login}/${spec.name}`),
  name: spec.name,
  full_name: `${login}/${spec.name}`,
  owner: { login },
  html_url: `https://github.com/${login}/${spec.name}`,
  description: `${spec.name} by ${login}`,
  fork: spec.fork ?? false,
  archived: spec.archived ?? false,
  disabled: spec.disabled ?? false,
  is_template: spec.isTemplate ?? false,
  mirror_url: spec.mirrorUrl ?? null,
  size: spec.sizeKb ?? 120,
  stargazers_count: spec.stars ?? 0,
  forks_count: spec.forks ?? 0,
  open_issues_count: 0,
  language: spec.language === undefined ? "TypeScript" : spec.language,
  topics: spec.topics ?? [],
  homepage: spec.homepage ?? null,
  license: { spdx_id: "MIT" },
  created_at: daysAgo(spec.createdDaysAgo ?? 700),
  updated_at: daysAgo(spec.pushedDaysAgo ?? 20),
  pushed_at: daysAgo(spec.pushedDaysAgo ?? 20),
  default_branch: spec.defaultBranch ?? "main",
});

const eventJson = (persona: PersonaSpec, spec: EventSpec, index: number) => ({
  id: String(index),
  type: spec.type,
  actor: { login: spec.actor ?? persona.login },
  repo: { name: spec.repo },
  // Verified against the live API: public PushEvent payloads carry no commits.
  payload:
    spec.type === "PushEvent"
      ? { push_id: index, ref: "refs/heads/main", head: "abc", before: "def" }
      : spec.type === "PullRequestEvent"
        ? {
            action: "closed",
            number: index,
            pull_request: { merged_at: spec.merged === true ? daysAgo(spec.daysAgo) : null },
          }
        : { action: "created" },
  public: true,
  created_at: daysAgo(spec.daysAgo),
});

function hash(value: string): number {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    total = (total * 31 + value.charCodeAt(index)) % 100_000_007;
  }
  return total;
}

const fixtureSha = (value: string): string => hash(value).toString(16).padStart(40, "0");

const treeJson = (paths: readonly string[]) => ({
  sha: fixtureSha(paths.join("\0")),
  truncated: false,
  tree: paths.map((path) => ({
    path,
    mode: "100644",
    type: path.endsWith("/") ? "tree" : "blob",
    sha: fixtureSha(path),
    size: path.endsWith("/") ? undefined : 400 + (hash(path) % 9_000),
  })),
});

const releasesJson = (count: number) =>
  Array.from({ length: count }, (_value, index) => ({
    tag_name: `v1.${String(index)}.0`,
    draft: false,
    prerelease: false,
    published_at: daysAgo(30 + index * 45),
  }));

const commitsJson = (messages: readonly string[], login: string) =>
  messages.map((message, index) => ({
    sha: fixtureSha(`${login}:${String(index)}:${message}`),
    commit: {
      message,
      author: { name: login, email: `${login}@users.noreply.github.com`, date: daysAgo(index * 3) },
    },
    author: { login },
    parents: message.toLowerCase().startsWith("merge ")
      ? [{ sha: "a" }, { sha: "b" }]
      : [{ sha: "a" }],
  }));

const jsonResponse = (body: unknown, status: number, remaining: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-limit": "60",
      "x-ratelimit-remaining": String(remaining),
      "x-ratelimit-reset": String(Math.floor((FIXTURE_NOW_MS + 3_600_000) / 1000)),
    },
  });

export interface FixtureFetch {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
  /** Every path requested, in order, so budget and pagination caps are assertable. */
  readonly calls: string[];
  /** Header names seen, lower-cased, so a token leak is assertable. */
  readonly headerNames: string[];
}

/**
 * A `fetch` that answers only GitHub REST paths this product uses. An unrecognised
 * path returns 404, which is what makes an unexpected request visible in a test.
 */
export function createFixtureFetch(persona: PersonaSpec): FixtureFetch {
  const respond = (body: unknown, status: number, remaining: number): Promise<Response> =>
    Promise.resolve(jsonResponse(body, status, remaining));
  const calls: string[] = [];
  const headerNames: string[] = [];
  let remaining = persona.rateLimitRemaining ?? 55;

  const implementation = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    calls.push(`${url.pathname}${url.search}`);
    for (const name of Object.keys(init?.headers ?? {})) {
      headerNames.push(name.toLowerCase());
    }
    remaining = Math.max(0, remaining - 1);

    for (const [fragment, status] of Object.entries(persona.failures ?? {})) {
      if (url.pathname.includes(fragment)) {
        return respond({ message: "Not Found" }, status, remaining);
      }
    }

    const { login } = persona;

    if (url.pathname === `/users/${login}`) {
      const status = persona.userStatus ?? 200;
      if (status !== 200) {
        return respond(
          { message: status === 403 ? "API rate limit exceeded" : "Not Found" },
          status,
          status === 403 ? 0 : remaining,
        );
      }
      return respond(
        {
          login,
          id: hash(login),
          name: persona.name ?? login,
          avatar_url: `https://avatars.githubusercontent.com/u/${String(hash(login))}?v=4`,
          html_url: `https://github.com/${login}`,
          bio: null,
          type: "User",
          public_repos: persona.repos.length,
          followers: persona.followers ?? 12,
          created_at: daysAgo(persona.accountCreatedDaysAgo ?? 1_500),
        },
        200,
        remaining,
      );
    }

    if (url.pathname === `/users/${login}/repos`) {
      const page = Number(url.searchParams.get("page") ?? "1");
      const perPage = Number(url.searchParams.get("per_page") ?? "100");
      const start = (page - 1) * perPage;
      const slice = persona.repos.slice(start, start + perPage);
      return respond(
        slice.map((spec) => repoJson(login, spec)),
        200,
        remaining,
      );
    }

    if (url.pathname === `/users/${login}/events/public`) {
      const page = Number(url.searchParams.get("page") ?? "1");
      const perPage = Number(url.searchParams.get("per_page") ?? "100");
      const events = persona.events ?? [];
      const slice = events.slice((page - 1) * perPage, (page - 1) * perPage + perPage);
      return respond(
        slice.map((spec, index) => eventJson(persona, spec, (page - 1) * perPage + index)),
        200,
        remaining,
      );
    }

    const repoMatch =
      /^\/repos\/([^/]+)\/([^/]+)\/(languages|releases|commits|git\/trees\/.+|git\/blobs\/.+)$/.exec(
        url.pathname,
      );
    if (repoMatch !== null) {
      const repository = repoMatch[2] ?? "";
      const endpoint = repoMatch[3] ?? "";
      if (endpoint === "languages") {
        return respond(persona.languages?.[repository] ?? { TypeScript: 40_000 }, 200, remaining);
      }
      if (endpoint === "releases") {
        return respond(releasesJson(persona.releases?.[repository] ?? 0), 200, remaining);
      }
      if (endpoint === "commits") {
        return respond(commitsJson(persona.commitMessages ?? [], login), 200, remaining);
      }
      if (endpoint.startsWith("git/blobs/")) {
        const sha = endpoint.slice("git/blobs/".length);
        const path = persona.trees?.[repository]?.find(
          (candidate) => fixtureSha(candidate) === sha,
        );
        if (path === undefined) return respond({ message: "Not Found" }, 404, remaining);
        const source =
          persona.sourceFiles?.[repository]?.[path] ??
          `export function ${path.replace(/[^a-z0-9]/gi, "_")}() {\n  return "synthetic fixture";\n}\n`;
        return respond(
          { sha, encoding: "base64", content: Buffer.from(source, "utf8").toString("base64") },
          200,
          remaining,
        );
      }
      const paths = persona.trees?.[repository];
      if (paths === undefined) return respond({ message: "Not Found" }, 404, remaining);
      return respond(treeJson(paths), 200, remaining);
    }

    return respond({ message: "Not Found" }, 404, remaining);
  };

  return Object.assign(implementation, { calls, headerNames });
}

const WELL_TOOLED_TREE = [
  "README.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "eslint.config.mjs",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  "docs/architecture.md",
  "src/index.ts",
  "src/server.ts",
  "src/router.ts",
  "src/store.ts",
  "src/auth.ts",
  "src/config.ts",
  "src/telemetry.ts",
  "src/queue.ts",
  "src/cache.ts",
  "src/schema.ts",
  "src/http.ts",
  "src/errors.ts",
  "src/render.ts",
  "src/parse.ts",
  "src/format.ts",
  "src/util.ts",
  "src/cli.ts",
  "src/worker.ts",
  "src/migrate.ts",
  "src/seed.ts",
  "tests/index.test.ts",
  "tests/router.test.ts",
  "tests/store.test.ts",
  "tests/auth.test.ts",
  "tests/schema.test.ts",
  "dist/index.js",
];

const BARE_TREE = ["README.md", "index.js", "style.css"];

/** Tests and CI, no manifest ceremony: reaches the verification identity without the
 * full well-tooled stack. */
const TEST_HEAVY_TREE = [
  "README.md",
  "LICENSE",
  "package.json",
  "pnpm-lock.yaml",
  ".github/workflows/ci.yml",
  "src/index.ts",
  "src/parse.ts",
  "src/render.ts",
  "src/store.ts",
  "src/http.ts",
  "src/errors.ts",
  "src/format.ts",
  "src/queue.ts",
  "src/config.ts",
  "src/schema.ts",
  "src/auth.ts",
  "src/cache.ts",
  "src/router.ts",
  "src/server.ts",
  "src/util.ts",
  "src/cli.ts",
  "tests/index.test.ts",
  "tests/parse.test.ts",
  "tests/render.test.ts",
  "tests/store.test.ts",
  "tests/http.test.ts",
  "tests/errors.test.ts",
  "tests/format.test.ts",
  "tests/queue.test.ts",
  "tests/schema.test.ts",
  "tests/auth.test.ts",
];

/** CI and configuration everywhere, almost no source and no tests. */
const CI_ONLY_TREE = [
  "README.md",
  ".github/workflows/ci.yml",
  ".github/workflows/lint.yml",
  ".github/workflows/deploy.yml",
  ".github/dependabot.yml",
  "Makefile",
  "Dockerfile",
  ".pre-commit-config.yaml",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "eslint.config.mjs",
  "src/index.ts",
  "src/main.ts",
];

/** A real workspace: two package manifests under `packages/`. */
const MONOREPO_TREE = [
  "README.md",
  "LICENSE",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tsconfig.json",
  "eslint.config.mjs",
  ".github/workflows/ci.yml",
  "docs/architecture.md",
  "packages/core/package.json",
  "packages/core/src/index.ts",
  "packages/core/src/engine.ts",
  "packages/core/src/parse.ts",
  "packages/core/src/store.ts",
  "packages/core/src/schema.ts",
  "packages/core/src/errors.ts",
  "packages/core/tests/engine.test.ts",
  "packages/core/tests/parse.test.ts",
  "packages/cli/package.json",
  "packages/cli/src/index.ts",
  "packages/cli/src/render.ts",
  "packages/cli/src/args.ts",
  "packages/cli/src/main.ts",
  "packages/cli/tests/render.test.ts",
  "apps/web/package.json",
  "apps/web/src/page.tsx",
  "apps/web/src/layout.tsx",
];

/** Documentation everywhere, source barely present, no releases. */
const DOCS_HEAVY_TREE = [
  "README.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "docs/overview.md",
  "docs/architecture.md",
  "docs/roadmap.md",
  "docs/faq.md",
  "docs/getting-started.md",
  "package.json",
  "pnpm-lock.yaml",
  "src/index.ts",
  "src/config.ts",
];

/** Build and lint configuration complete, no releases, no external work. */
const SETUP_COMPLETE_TREE = [
  "README.md",
  "LICENSE",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "eslint.config.mjs",
  ".prettierrc.json",
  "Dockerfile",
  "src/index.ts",
  "src/app.ts",
  "src/router.ts",
  "src/store.ts",
  "src/config.ts",
  "src/auth.ts",
  "src/render.ts",
  "src/errors.ts",
  "src/http.ts",
  "src/queue.ts",
  "src/schema.ts",
  "src/parse.ts",
  "src/format.ts",
  "src/util.ts",
];

/**
 * Deliberate layout and full tooling, but only two test files against 22 source files —
 * below the "meaningful tests" bar, so the structure signal is what leads.
 */
const STRUCTURED_TREE = [
  "README.md",
  "LICENSE",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "eslint.config.mjs",
  ".prettierrc.json",
  "Makefile",
  ".github/workflows/ci.yml",
  ".github/dependabot.yml",
  "src/index.ts",
  "src/kernel.ts",
  "src/registry.ts",
  "src/lifecycle.ts",
  "src/adapter.ts",
  "src/transport.ts",
  "src/codec.ts",
  "src/errors.ts",
  "src/config.ts",
  "src/logger.ts",
  "src/metrics.ts",
  "src/router.ts",
  "src/pipeline.ts",
  "src/context.ts",
  "src/resolve.ts",
  "src/inject.ts",
  "src/scope.ts",
  "src/token.ts",
  "src/plugin.ts",
  "src/hooks.ts",
  "src/util.ts",
  "src/types.ts",
  "tests/kernel.test.ts",
  "tests/registry.test.ts",
];

const PYTHON_TREE = [
  "README.md",
  "LICENSE",
  "pyproject.toml",
  "poetry.lock",
  "setup.cfg",
  ".github/workflows/ci.yml",
  "src/pipeline/__init__.py",
  "src/pipeline/ingest.py",
  "src/pipeline/transform.py",
  "src/pipeline/load.py",
  "src/pipeline/schema.py",
  "src/pipeline/metrics.py",
  "src/pipeline/cli.py",
  "src/pipeline/config.py",
  "src/pipeline/errors.py",
  "src/pipeline/store.py",
  "src/pipeline/util.py",
  "src/pipeline/report.py",
  "src/pipeline/plot.py",
  "src/pipeline/window.py",
  "src/pipeline/join.py",
  "tests/test_ingest.py",
  "tests/test_transform.py",
  "tests/test_load.py",
];

const RUST_TREE = [
  "README.md",
  "LICENSE",
  "Cargo.toml",
  "Cargo.lock",
  ".github/workflows/ci.yml",
  "src/main.rs",
  "src/lib.rs",
  "src/parser.rs",
  "src/lexer.rs",
  "src/codegen.rs",
  "src/vm.rs",
  "src/gc.rs",
  "src/alloc.rs",
  "src/wire.rs",
  "src/frame.rs",
  "src/socket.rs",
  "src/buffer.rs",
  "src/error.rs",
  "src/config.rs",
  "src/util.rs",
  "src/scheduler.rs",
  "tests/parser.rs",
  "tests/vm.rs",
];

const GO_TREE = [
  "README.md",
  "go.mod",
  "go.sum",
  "Makefile",
  ".github/workflows/ci.yml",
  "cmd/main.go",
  "internal/server.go",
  "internal/store.go",
  "internal/router.go",
  "internal/config.go",
  "internal/auth.go",
  "internal/queue.go",
  "internal/cache.go",
  "internal/parse.go",
  "internal/format.go",
  "internal/render.go",
  "internal/errors.go",
  "internal/http.go",
  "internal/db.go",
  "internal/log.go",
  "internal/metrics.go",
  "internal/server_test.go",
  "internal/store_test.go",
  "internal/router_test.go",
  "vendor/github.com/pkg/errors/errors.go",
];

const GOOD_MESSAGES = [
  "Add deterministic router table",
  "Extract queue backpressure into its own module",
  "Fix off-by-one in pagination cursor",
  "Document the retry contract",
  "Introduce schema validation at the boundary",
  "Split the auth middleware from the session store",
  "Cache resolved config for the process lifetime",
  "Merge branch 'main' into release",
  "Tighten error propagation in the worker loop",
  "Add integration coverage for the migrate path",
  "Reduce allocation in the format hot path",
  "Rename ambiguous helpers in parse",
  "Handle empty payloads explicitly",
  "Add a regression test for the cursor fix",
  "Expose queue depth as a metric",
  "Drop the unused telemetry shim",
  "Clarify the seed script output",
  "Guard against duplicate migrations",
  "Move HTTP constants beside their consumer",
  "Wire the CLI to the shared parser",
  "Support cancellation in the fetch wrapper",
  "Record the retry budget in the log line",
];

const SLOPPY_MESSAGES = [
  "fix",
  "update",
  "fix2",
  "wip",
  "stuff",
  ".",
  "fix again",
  "actually fix it",
  "revert broken thing",
  "update",
  "fix build",
  "temp",
  "cleanup",
  "fix fix",
  "asdf",
  "more",
  "final",
  "fix typo",
  "revert revert",
  "wip 2",
  "changes",
  "done",
];

/**
 * Legible subjects with a high repair rate: separates the fix-loop signal from the
 * low-effort-message signal, which the sloppy set conflates.
 */
const REPAIR_MESSAGES = [
  "Add the session refresh path",
  "Fix the session refresh path",
  "Fix session refresh again",
  "Actually fix the session refresh",
  "Revert the session refresh change",
  "Reapply session refresh with a guard",
  "Fix the guard condition",
  "Correct the guard boundary",
  "Fix the pagination cursor",
  "Fix pagination cursor off-by-one",
  "Actually correct the cursor maths",
  "Add the queue drain hook",
  "Fix the queue drain hook",
  "Hotfix queue drain ordering",
  "Revert queue drain ordering",
  "Patch the retry budget",
  "Fix retry budget accounting",
  "Introduce the config loader",
  "Correct the config loader precedence",
  "Fix config loader precedence again",
  "Document the retry contract",
  "Extract the transport helper",
  "Fix the transport helper timeout",
  "Retry the transport on a closed socket",
];

/** The persona set the offline suite battles against. */
export const PERSONAS = {
  strongMaintainer: {
    login: "strongmaintainer",
    name: "Strong Maintainer",
    accountCreatedDaysAgo: 2_600,
    repos: [
      { name: "orchestrator", sizeKb: 4_200, stars: 900, createdDaysAgo: 1_400, pushedDaysAgo: 2 },
      { name: "toolkit", sizeKb: 1_800, stars: 210, createdDaysAgo: 1_100, pushedDaysAgo: 9 },
      { name: "cli", sizeKb: 900, stars: 64, createdDaysAgo: 800, pushedDaysAgo: 18 },
      { name: "docs-site", sizeKb: 300, stars: 8, createdDaysAgo: 600, pushedDaysAgo: 44 },
      {
        name: "legacy-parser",
        sizeKb: 500,
        archived: true,
        createdDaysAgo: 2_000,
        pushedDaysAgo: 900,
      },
    ],
    trees: {
      orchestrator: WELL_TOOLED_TREE,
      toolkit: WELL_TOOLED_TREE,
      cli: WELL_TOOLED_TREE,
    },
    releases: { orchestrator: 9, toolkit: 4, cli: 2 },
    commitMessages: GOOD_MESSAGES,
    events: [
      ...Array.from({ length: 40 }, (_value, index) => ({
        type: "PushEvent",
        repo: "strongmaintainer/orchestrator",
        daysAgo: index * 2,
      })),
      { type: "PullRequestEvent", repo: "otherorg/upstream", daysAgo: 6, merged: true },
      { type: "PullRequestEvent", repo: "anotherorg/library", daysAgo: 21, merged: true },
      { type: "PullRequestReviewEvent", repo: "otherorg/upstream", daysAgo: 8 },
    ],
  },
  highActivityLowImpact: {
    login: "grindsetonly",
    accountCreatedDaysAgo: 900,
    repos: [
      { name: "scratchpad", sizeKb: 240, createdDaysAgo: 500, pushedDaysAgo: 1 },
      { name: "experiments", sizeKb: 180, createdDaysAgo: 420, pushedDaysAgo: 3 },
      { name: "notes", sizeKb: 60, createdDaysAgo: 380, pushedDaysAgo: 5 },
    ],
    trees: { scratchpad: BARE_TREE, experiments: BARE_TREE, notes: BARE_TREE },
    commitMessages: SLOPPY_MESSAGES,
    events: Array.from({ length: 80 }, (_value, index) => ({
      type: "PushEvent",
      repo: "grindsetonly/scratchpad",
      daysAgo: Math.floor(index / 2),
    })),
  },
  oneRepoHighImpact: {
    login: "onerepoboss",
    accountCreatedDaysAgo: 1_800,
    repos: [
      { name: "the-one", sizeKb: 9_000, stars: 4_200, createdDaysAgo: 1_500, pushedDaysAgo: 4 },
      { name: "dotfiles", sizeKb: 12, createdDaysAgo: 1_400, pushedDaysAgo: 300 },
    ],
    trees: { "the-one": WELL_TOOLED_TREE, dotfiles: BARE_TREE },
    releases: { "the-one": 22 },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 18 }, (_value, index) => ({
      type: "PushEvent",
      repo: "onerepoboss/the-one",
      daysAgo: index * 4,
    })),
  },
  manyTinyRepos: {
    login: "sidequester",
    accountCreatedDaysAgo: 1_300,
    repos: Array.from({ length: 14 }, (_value, index) => ({
      name: `project-${String(index)}`,
      sizeKb: index < 2 ? 300 : 8,
      createdDaysAgo: 600 - index * 20,
      pushedDaysAgo: index < 2 ? 40 : 500 + index,
    })),
    trees: { "project-0": BARE_TREE, "project-1": BARE_TREE, "project-2": BARE_TREE },
    commitMessages: SLOPPY_MESSAGES,
    events: Array.from({ length: 6 }, (_value, index) => ({
      type: "PushEvent",
      repo: "sidequester/project-0",
      daysAgo: index * 9,
    })),
  },
  archivedPortfolio: {
    login: "archivist",
    accountCreatedDaysAgo: 3_000,
    repos: [
      {
        name: "finished-one",
        sizeKb: 1_200,
        archived: true,
        createdDaysAgo: 2_400,
        pushedDaysAgo: 800,
      },
      {
        name: "finished-two",
        sizeKb: 800,
        archived: true,
        createdDaysAgo: 2_100,
        pushedDaysAgo: 700,
      },
      {
        name: "finished-three",
        sizeKb: 640,
        archived: true,
        createdDaysAgo: 1_900,
        pushedDaysAgo: 640,
      },
      { name: "current", sizeKb: 500, createdDaysAgo: 400, pushedDaysAgo: 12 },
    ],
    trees: {
      "finished-one": WELL_TOOLED_TREE,
      "finished-two": WELL_TOOLED_TREE,
      current: WELL_TOOLED_TREE,
    },
    releases: { "finished-one": 6, "finished-two": 3, current: 1 },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 8 }, (_value, index) => ({
      type: "PushEvent",
      repo: "archivist/current",
      daysAgo: index * 7,
    })),
  },
  lowPublicEvidence: {
    login: "ghostmode",
    accountCreatedDaysAgo: 400,
    repos: [{ name: "readme-only", sizeKb: 2, createdDaysAgo: 200, pushedDaysAgo: 190 }],
    trees: { "readme-only": ["README.md"] },
    events: [],
  },
  unsupportedLanguages: {
    login: "systemsmaxxer",
    accountCreatedDaysAgo: 2_200,
    repos: [
      { name: "engine", sizeKb: 3_000, language: "Zig", createdDaysAgo: 900, pushedDaysAgo: 6 },
      {
        name: "runtime",
        sizeKb: 2_100,
        language: "Haskell",
        createdDaysAgo: 800,
        pushedDaysAgo: 30,
      },
      {
        name: "kernel-mod",
        sizeKb: 1_400,
        language: "C",
        createdDaysAgo: 1_200,
        pushedDaysAgo: 70,
      },
    ],
    trees: { engine: GO_TREE, runtime: GO_TREE, "kernel-mod": GO_TREE },
    languages: {
      engine: { Zig: 90_000 },
      runtime: { Haskell: 60_000 },
      "kernel-mod": { C: 80_000 },
    },
    releases: { engine: 3 },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 20 }, (_value, index) => ({
      type: "PushEvent",
      repo: "systemsmaxxer/engine",
      daysAgo: index * 3,
    })),
  },
  notFound: {
    login: "doesnotexist",
    repos: [],
    userStatus: 404,
  },
  rateLimited: {
    login: "ratelimited",
    repos: [],
    userStatus: 403,
  },
  partialTreeFailure: {
    login: "partialtree",
    accountCreatedDaysAgo: 1_000,
    repos: [
      { name: "alpha", sizeKb: 900, createdDaysAgo: 600, pushedDaysAgo: 5 },
      { name: "beta", sizeKb: 700, createdDaysAgo: 500, pushedDaysAgo: 25 },
    ],
    trees: { alpha: WELL_TOOLED_TREE, beta: WELL_TOOLED_TREE },
    releases: { alpha: 2 },
    commitMessages: GOOD_MESSAGES,
    // Only the second repository's tree fails, so the snapshot has to degrade
    // coverage rather than fail the whole profile.
    failures: { "/partialtree/beta/git/trees": 500 },
    events: Array.from({ length: 10 }, (_value, index) => ({
      type: "PushEvent",
      repo: "partialtree/alpha",
      daysAgo: index * 5,
    })),
  },

  // ---------------------------------------------------------------------------
  // Identity calibration personas (ADR 0008 D5). Each one exists to make one
  // Mogsona or one Aura Leak reachable, so a label with no fixture fails the suite.
  // ---------------------------------------------------------------------------

  /** Release-heavy but stale: RELEASE GOBLIN, because SHIP GOBLIN blocks on recency. */
  releaseHeavy: {
    login: "tagmachine",
    accountCreatedDaysAgo: 2_800,
    repos: [
      { name: "packager", sizeKb: 2_600, createdDaysAgo: 1_900, pushedDaysAgo: 210 },
      { name: "formatter", sizeKb: 1_500, createdDaysAgo: 1_700, pushedDaysAgo: 240 },
      { name: "linter", sizeKb: 1_100, createdDaysAgo: 1_500, pushedDaysAgo: 260 },
    ],
    trees: { packager: WELL_TOOLED_TREE, formatter: WELL_TOOLED_TREE, linter: WELL_TOOLED_TREE },
    releases: { packager: 34, formatter: 18, linter: 11 },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 4 }, (_value, index) => ({
      type: "PushEvent",
      repo: "tagmachine/packager",
      daysAgo: 210 + index * 4,
    })),
  },

  /** Pipelines everywhere, almost no source and no releases: CI ENJOYER or YAML ENGINEER. */
  ciHeavy: {
    login: "pipelineposter",
    accountCreatedDaysAgo: 1_100,
    repos: [
      { name: "infra", sizeKb: 80, createdDaysAgo: 500, pushedDaysAgo: 7 },
      { name: "actions", sizeKb: 60, createdDaysAgo: 460, pushedDaysAgo: 14 },
      { name: "templates", sizeKb: 55, createdDaysAgo: 430, pushedDaysAgo: 26 },
    ],
    trees: { infra: CI_ONLY_TREE, actions: CI_ONLY_TREE, templates: CI_ONLY_TREE },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 14 }, (_value, index) => ({
      type: "PushEvent",
      repo: "pipelineposter/infra",
      daysAgo: index * 6,
    })),
  },

  /** Tests across every inspected repository, wired to CI: TEST PRIEST. */
  testHeavy: {
    login: "assertionpilled",
    accountCreatedDaysAgo: 1_600,
    repos: [
      { name: "validator", sizeKb: 700, createdDaysAgo: 900, pushedDaysAgo: 8 },
      { name: "matcher", sizeKb: 520, createdDaysAgo: 820, pushedDaysAgo: 19 },
      { name: "harness", sizeKb: 430, createdDaysAgo: 760, pushedDaysAgo: 33 },
    ],
    trees: { validator: TEST_HEAVY_TREE, matcher: TEST_HEAVY_TREE, harness: TEST_HEAVY_TREE },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 16 }, (_value, index) => ({
      type: "PushEvent",
      repo: "assertionpilled/validator",
      daysAgo: index * 5,
    })),
  },

  /** Mostly other people's repositories, with merged pull requests: OSS LANDLORD. */
  ossContributor: {
    login: "upstreamguest",
    accountCreatedDaysAgo: 2_000,
    repos: [
      { name: "notes-cli", sizeKb: 420, createdDaysAgo: 900, pushedDaysAgo: 21 },
      { name: "dotfiles", sizeKb: 90, createdDaysAgo: 1_400, pushedDaysAgo: 60 },
    ],
    trees: { "notes-cli": TEST_HEAVY_TREE, dotfiles: BARE_TREE },
    commitMessages: GOOD_MESSAGES,
    events: [
      ...Array.from({ length: 6 }, (_value, index) => ({
        type: "PushEvent" as const,
        repo: "upstreamguest/notes-cli",
        daysAgo: index * 9,
      })),
      { type: "PullRequestEvent", repo: "bigorg/framework", daysAgo: 4, merged: true },
      { type: "PullRequestEvent", repo: "bigorg/runtime", daysAgo: 12, merged: true },
      { type: "PullRequestEvent", repo: "otherorg/parser", daysAgo: 26, merged: true },
      { type: "PullRequestEvent", repo: "thirdorg/toolkit", daysAgo: 40, merged: true },
      { type: "PullRequestReviewEvent", repo: "bigorg/framework", daysAgo: 6 },
      { type: "PullRequestReviewEvent", repo: "bigorg/runtime", daysAgo: 15 },
    ],
  },

  /** Substantial projects in four languages: POLYGLOT MAXXER. */
  truePolyglot: {
    login: "fourstack",
    accountCreatedDaysAgo: 2_900,
    repos: [
      { name: "engine", sizeKb: 2_400, language: "Rust", createdDaysAgo: 1_600, pushedDaysAgo: 11 },
      {
        name: "pipeline",
        sizeKb: 1_500,
        language: "Python",
        createdDaysAgo: 1_300,
        pushedDaysAgo: 24,
      },
      { name: "service", sizeKb: 1_200, language: "Go", createdDaysAgo: 1_100, pushedDaysAgo: 38 },
      {
        name: "console",
        sizeKb: 950,
        language: "TypeScript",
        createdDaysAgo: 900,
        pushedDaysAgo: 52,
      },
    ],
    trees: {
      engine: RUST_TREE,
      pipeline: PYTHON_TREE,
      service: GO_TREE,
      console: WELL_TOOLED_TREE,
    },
    languages: {
      engine: { Rust: 120_000 },
      pipeline: { Python: 90_000 },
      service: { Go: 80_000 },
      console: { TypeScript: 70_000 },
    },
    // No releases on purpose: this fixture exists to prove breadth-with-substance is
    // recognised on its own, without a shipping signal doing the work.
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 22 }, (_value, index) => ({
      type: "PushEvent",
      repo: "fourstack/engine",
      daysAgo: index * 3,
    })),
  },

  /** Substantial projects abandoned past the one-year threshold: REPO GRAVEYARD. */
  repoGraveyard: {
    login: "necropolis",
    accountCreatedDaysAgo: 3_200,
    repos: [
      { name: "ghost-one", sizeKb: 900, createdDaysAgo: 2_400, pushedDaysAgo: 900 },
      { name: "ghost-two", sizeKb: 780, createdDaysAgo: 2_200, pushedDaysAgo: 860 },
      { name: "ghost-three", sizeKb: 660, createdDaysAgo: 2_000, pushedDaysAgo: 820 },
      { name: "ghost-four", sizeKb: 540, createdDaysAgo: 1_800, pushedDaysAgo: 780 },
      { name: "still-here", sizeKb: 460, createdDaysAgo: 700, pushedDaysAgo: 40 },
    ],
    trees: {
      "ghost-one": WELL_TOOLED_TREE,
      "ghost-two": WELL_TOOLED_TREE,
      "still-here": BARE_TREE,
    },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 5 }, (_value, index) => ({
      type: "PushEvent",
      repo: "necropolis/still-here",
      daysAgo: 40 + index * 8,
    })),
  },

  /** Mostly forks, little original substance: FORKLIFT OPERATOR. */
  forkCollector: {
    login: "forkliftcertified",
    accountCreatedDaysAgo: 1_200,
    repos: [
      ...Array.from({ length: 9 }, (_value, index) => ({
        name: `fork-${String(index)}`,
        sizeKb: 400,
        fork: true,
        createdDaysAgo: 500 - index * 20,
        pushedDaysAgo: 120 + index * 10,
      })),
      { name: "own-thing", sizeKb: 180, createdDaysAgo: 400, pushedDaysAgo: 30 },
      { name: "own-notes", sizeKb: 40, createdDaysAgo: 380, pushedDaysAgo: 90 },
    ],
    trees: { "own-thing": BARE_TREE, "own-notes": BARE_TREE },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 7 }, (_value, index) => ({
      type: "PushEvent",
      repo: "forkliftcertified/own-thing",
      daysAgo: index * 8,
    })),
  },

  /** Documentation everywhere and nothing published: README CEO. */
  readmeCeo: {
    login: "docsdriven",
    accountCreatedDaysAgo: 800,
    repos: [
      { name: "the-platform", sizeKb: 260, createdDaysAgo: 500, pushedDaysAgo: 9 },
      { name: "the-protocol", sizeKb: 190, createdDaysAgo: 420, pushedDaysAgo: 22 },
      { name: "the-standard", sizeKb: 150, createdDaysAgo: 360, pushedDaysAgo: 44 },
    ],
    trees: {
      "the-platform": DOCS_HEAVY_TREE,
      "the-protocol": DOCS_HEAVY_TREE,
      "the-standard": DOCS_HEAVY_TREE,
    },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 12 }, (_value, index) => ({
      type: "PushEvent",
      repo: "docsdriven/the-platform",
      daysAgo: index * 6,
    })),
  },

  /** Legible messages, high repair rate: FIX-LOOP ENJOYER without COMMIT CHAOS. */
  fixLooper: {
    login: "loopdeloop",
    accountCreatedDaysAgo: 1_400,
    repos: [
      { name: "service", sizeKb: 800, createdDaysAgo: 800, pushedDaysAgo: 6 },
      { name: "worker", sizeKb: 520, createdDaysAgo: 700, pushedDaysAgo: 18 },
      { name: "gateway", sizeKb: 380, createdDaysAgo: 620, pushedDaysAgo: 40 },
    ],
    trees: { service: TEST_HEAVY_TREE, worker: TEST_HEAVY_TREE, gateway: BARE_TREE },
    releases: { service: 2 },
    commitMessages: REPAIR_MESSAGES,
    events: Array.from({ length: 18 }, (_value, index) => ({
      type: "PushEvent",
      repo: "loopdeloop/service",
      daysAgo: index * 4,
    })),
  },

  /** Balanced, recent, legible, no standout dimension: REPO GENERALIST. */
  balancedBuilder: {
    login: "steadyhands",
    accountCreatedDaysAgo: 1_500,
    repos: [
      { name: "app", sizeKb: 620, createdDaysAgo: 700, pushedDaysAgo: 10 },
      { name: "shared", sizeKb: 340, createdDaysAgo: 640, pushedDaysAgo: 30 },
    ],
    trees: { app: SETUP_COMPLETE_TREE, shared: SETUP_COMPLETE_TREE },
    releases: { app: 1 },
    // Deliberately below the 20-message floor so no commit-style specialist can win.
    commitMessages: GOOD_MESSAGES.slice(0, 8),
    events: Array.from({ length: 11 }, (_value, index) => ({
      type: "PushEvent",
      repo: "steadyhands/app",
      daysAgo: index * 7,
    })),
  },

  /** A real workspace with strong structure: MONOREPO MAXXER. */
  monorepoOperator: {
    login: "workspaceenjoyer",
    accountCreatedDaysAgo: 1_700,
    repos: [
      { name: "platform", sizeKb: 3_100, createdDaysAgo: 1_000, pushedDaysAgo: 5 },
      { name: "sdk", sizeKb: 1_400, createdDaysAgo: 860, pushedDaysAgo: 16 },
    ],
    trees: { platform: MONOREPO_TREE, sdk: MONOREPO_TREE },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 15 }, (_value, index) => ({
      type: "PushEvent",
      repo: "workspaceenjoyer/platform",
      daysAgo: index * 5,
    })),
  },

  /** Five languages, none of them at project scale: FRAMEWORK TOURIST. */
  frameworkTourist: {
    login: "ecosystemhopper",
    accountCreatedDaysAgo: 900,
    repos: [
      {
        name: "try-svelte",
        sizeKb: 14,
        language: "Svelte",
        createdDaysAgo: 300,
        pushedDaysAgo: 290,
      },
      {
        name: "try-elixir",
        sizeKb: 12,
        language: "Elixir",
        createdDaysAgo: 260,
        pushedDaysAgo: 250,
      },
      { name: "try-rust", sizeKb: 10, language: "Rust", createdDaysAgo: 220, pushedDaysAgo: 214 },
      { name: "try-go", sizeKb: 9, language: "Go", createdDaysAgo: 180, pushedDaysAgo: 175 },
      { name: "try-zig", sizeKb: 8, language: "Zig", createdDaysAgo: 140, pushedDaysAgo: 136 },
      { name: "notes", sizeKb: 6, language: null, createdDaysAgo: 100, pushedDaysAgo: 30 },
    ],
    trees: { "try-svelte": BARE_TREE, "try-elixir": BARE_TREE, "try-rust": BARE_TREE },
    languages: {
      "try-svelte": { Svelte: 4_000 },
      "try-elixir": { Elixir: 3_000 },
      "try-rust": { Rust: 2_000 },
    },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 6 }, (_value, index) => ({
      type: "PushEvent",
      repo: "ecosystemhopper/try-zig",
      daysAgo: index * 20,
    })),
  },

  /** Five archived-as-finished projects, one current, no releases: ARCHIVE PALADIN. */
  archiveDiscipline: {
    login: "curator",
    accountCreatedDaysAgo: 3_400,
    repos: [
      { name: "done-one", sizeKb: 900, archived: true, createdDaysAgo: 2_600, pushedDaysAgo: 700 },
      { name: "done-two", sizeKb: 760, archived: true, createdDaysAgo: 2_400, pushedDaysAgo: 660 },
      {
        name: "done-three",
        sizeKb: 640,
        archived: true,
        createdDaysAgo: 2_200,
        pushedDaysAgo: 620,
      },
      { name: "done-four", sizeKb: 520, archived: true, createdDaysAgo: 2_000, pushedDaysAgo: 580 },
      { name: "done-five", sizeKb: 480, archived: true, createdDaysAgo: 1_800, pushedDaysAgo: 540 },
      { name: "in-progress", sizeKb: 420, createdDaysAgo: 500, pushedDaysAgo: 14 },
    ],
    trees: {
      "done-one": TEST_HEAVY_TREE,
      "done-two": TEST_HEAVY_TREE,
      "in-progress": TEST_HEAVY_TREE,
    },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 9 }, (_value, index) => ({
      type: "PushEvent",
      repo: "curator/in-progress",
      daysAgo: 14 + index * 7,
    })),
  },

  /** Long-lived projects with high active-week coverage and no releases: SUSTAINED GRINDER. */
  sustainedGrinder: {
    login: "longhauler",
    accountCreatedDaysAgo: 3_000,
    repos: [
      { name: "kernel", sizeKb: 1_900, createdDaysAgo: 2_200, pushedDaysAgo: 4 },
      { name: "runtime", sizeKb: 1_400, createdDaysAgo: 1_900, pushedDaysAgo: 12 },
      { name: "tools", sizeKb: 900, createdDaysAgo: 1_600, pushedDaysAgo: 26 },
      { name: "docs-site", sizeKb: 320, createdDaysAgo: 1_200, pushedDaysAgo: 48 },
    ],
    trees: {
      kernel: SETUP_COMPLETE_TREE,
      runtime: SETUP_COMPLETE_TREE,
      tools: SETUP_COMPLETE_TREE,
    },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 30 }, (_value, index) => ({
      type: "PushEvent",
      repo: "longhauler/kernel",
      daysAgo: index * 3,
    })),
  },

  /** Many small repositories with legible commits: SIDEQUEST COLLECTOR without chaos. */
  sidequestCollector: {
    login: "questlog",
    accountCreatedDaysAgo: 1_600,
    repos: [
      { name: "main-thing", sizeKb: 520, createdDaysAgo: 700, pushedDaysAgo: 15 },
      ...Array.from({ length: 11 }, (_value, index) => ({
        name: `spike-${String(index)}`,
        sizeKb: 7,
        createdDaysAgo: 500 - index * 25,
        pushedDaysAgo: 480 - index * 25,
      })),
    ],
    trees: { "main-thing": TEST_HEAVY_TREE, "spike-0": BARE_TREE, "spike-1": BARE_TREE },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 8 }, (_value, index) => ({
      type: "PushEvent",
      repo: "questlog/main-thing",
      daysAgo: index * 8,
    })),
  },

  /** One dominant but thin repository: SINGLE POINT OF AURA, not the Final Boss gate. */
  oneRepoThin: {
    login: "solocarry",
    accountCreatedDaysAgo: 1_000,
    repos: [
      { name: "the-thing", sizeKb: 900, createdDaysAgo: 300, pushedDaysAgo: 18 },
      { name: "scratch", sizeKb: 9, createdDaysAgo: 260, pushedDaysAgo: 200 },
    ],
    trees: { "the-thing": BARE_TREE, scratch: BARE_TREE },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 7 }, (_value, index) => ({
      type: "PushEvent",
      repo: "solocarry/the-thing",
      daysAgo: index * 9,
    })),
  },

  /** Strong layout and tooling, real output, only token tests: STRUCTURE MERCHANT. */
  structureMerchant: {
    login: "blueprintpilled",
    accountCreatedDaysAgo: 1_900,
    repos: [
      { name: "framework", sizeKb: 1_600, createdDaysAgo: 1_100, pushedDaysAgo: 9 },
      { name: "adapters", sizeKb: 900, createdDaysAgo: 950, pushedDaysAgo: 23 },
      { name: "examples", sizeKb: 540, createdDaysAgo: 800, pushedDaysAgo: 41 },
    ],
    trees: {
      framework: STRUCTURED_TREE,
      adapters: STRUCTURED_TREE,
      examples: STRUCTURED_TREE,
    },
    releases: { framework: 3, adapters: 1 },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 13 }, (_value, index) => ({
      type: "PushEvent",
      repo: "blueprintpilled/framework",
      daysAgo: index * 6,
    })),
  },

  /** High cadence with legible commits and real projects: COMMIT GOBLIN. */
  commitGrinder: {
    login: "greengraph",
    accountCreatedDaysAgo: 1_300,
    repos: [
      { name: "daily", sizeKb: 700, createdDaysAgo: 600, pushedDaysAgo: 1 },
      { name: "sketches", sizeKb: 260, createdDaysAgo: 500, pushedDaysAgo: 4 },
    ],
    trees: { daily: SETUP_COMPLETE_TREE, sketches: BARE_TREE },
    commitMessages: GOOD_MESSAGES,
    events: Array.from({ length: 90 }, (_value, index) => ({
      type: "PushEvent",
      repo: "greengraph/daily",
      daysAgo: Math.floor(index * 0.9),
    })),
  },
} as const satisfies Record<string, PersonaSpec>;

export type PersonaName = keyof typeof PERSONAS;
