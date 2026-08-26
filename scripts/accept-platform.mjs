#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import { assertBrowserOpenBundlePolicy } from "../packages/distribution/browser-open-policy.mjs";
import { captureNodeCli, resolveNpmEntrypoints } from "./lib/package-manager.mjs";
import { canonicalizePackageHelpInvocation } from "./lib/package-acceptance.mjs";

const ESCAPE = String.fromCodePoint(27);
const EXPECTED_CANONICAL_JSON_SHA256 =
  "ed5b10d16ce02f72e6335a997cf1409f71a3377c8d481f0754bad31f6178c08d";
const EXPECTED_CANONICAL_BATTLE_SHA256 =
  "36361adb2e14d3a89cf43b473940ec8247be950e47116b0ef03c7ad58b66cf12";
const PRIVATE_PROGRESS_COLLISION = new RegExp(
  `Reviewing code quality(?:${ESCAPE}\\[[0-9;?]*[A-Za-z])*PRIVATE REPOS`,
  "u",
);
const removedThirdToken = ["ultra", "think"].join("");
const removedFlags = Object.freeze([
  `--${["ora", "cle"].join("")}`,
  `--${removedThirdToken}`,
  `--${removedThirdToken}-${["re", "mix"].join("")}`,
  `--${removedThirdToken}-${["mo", "del"].join("")}`,
  "--yes",
  "--no-pull",
]);
const unsafeCacheKeys = new Set([
  "source",
  "content",
  "rawsource",
  "excerpt",
  "credential",
  "token",
  "prompt",
  "messages",
  "reasoning",
  "hiddenreasoning",
  "authorization",
  "headers",
  "cookie",
  "constructor",
  "prototype",
  "__proto__",
]);
const privateContextConfig = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../config/private-context-app.json"), "utf8"),
);
const interactionVersions = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../config/interaction-versions.json"), "utf8"),
);

const hostedBrowserCommandContract = (platform) => {
  if (platform === "darwin") {
    return {
      executable: "/usr/bin/open",
      arguments: ["<validated-github-url>"],
      guiOpened: false,
    };
  }
  if (platform === "win32") {
    return {
      executable: String.raw`C:\Windows\System32\rundll32.exe`,
      arguments: ["url.dll,FileProtocolHandler", "<validated-github-url>"],
      guiOpened: false,
    };
  }
  return {
    executable: "/usr/bin/xdg-open",
    arguments: ["<validated-github-url>"],
    condition: "executable-present-and-graphical-session",
    guiOpened: false,
  };
};

const humanTaxonomyPhrases = Object.freeze([
  "AURA LEAK",
  "README CEO",
  "SIDEQUEST COLLECTOR",
  "FRAMEWORK TOURIST",
  "RELEASE AVOIDER",
  "FORKLIFT OPERATOR",
  "FIX-LOOP ENJOYER",
  "COMMIT CHAOS",
  "LOCALHOST MILLIONAIRE",
  "CODE HERMIT",
  "YAML ENGINEER",
  "REPO GRAVEYARD",
  "SINGLE POINT OF AURA",
]);

function assertTaxonomyFree(value, surface) {
  const normalized = value.toUpperCase();
  for (const phrase of humanTaxonomyPhrases) {
    if (normalized.includes(phrase)) fail(`${surface} exposed internal taxonomy: ${phrase}`);
  }
}

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const options = { tarball: "", left: "octocat", right: "defunkt", fixtureNetwork: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--tarball") options.tarball = argv[++index] ?? "";
    else if (token === "--left") options.left = argv[++index] ?? "";
    else if (token === "--right") options.right = argv[++index] ?? "";
    else if (token === "--fixture-network") options.fixtureNetwork = true;
    else fail(`Unknown option: ${String(token)}`);
  }
  if (options.tarball === "") fail("Pass --tarball with a locally built .tgz path.");
  options.tarball = isAbsolute(options.tarball)
    ? options.tarball
    : resolve(process.cwd(), options.tarball);
  if (!existsSync(options.tarball) || !options.tarball.endsWith(".tgz")) {
    fail(`Packed artifact not found: ${options.tarball}`);
  }
  if (options.left === "" || options.right === "") fail("Both handles are required.");
  return options;
}

function runCli(entrypoint, args, { cwd, env, expected = 0, timeout = 240_000 }) {
  const result = captureNodeCli(basename(entrypoint), entrypoint, args, {
    cwd,
    env,
    timeout,
    maxBuffer: 24 * 1024 * 1024,
  });
  if (result.code !== expected) {
    fail(
      `${basename(entrypoint)} ${args.join(" ")} exited ${String(result.code)}; ` +
        `expected ${String(expected)}.\n${result.stderr}${result.stdout}`,
    );
  }
  return result;
}

function parseJson(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(`${label} did not emit JSON only.`);
  }
}

function compactRenderedText(value) {
  return value
    .replace(/[╔╗╚╝╠╣═║┌┐└┘├┤─│]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function withoutRequestBudgets(value) {
  if (Array.isArray(value)) return value.map(withoutRequestBudgets);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "requestBudget" && key !== "requestTelemetry")
      .map(([key, nested]) => [key, withoutRequestBudgets(nested)]),
  );
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function assertCacheSafe(directory) {
  const files = walk(directory).filter((path) => path.endsWith(".json"));
  const visit = (value, path) => {
    if (Array.isArray(value)) return value.forEach((entry) => visit(entry, path));
    if (typeof value !== "object" || value === null) return;
    for (const [key, nested] of Object.entries(value)) {
      if (unsafeCacheKeys.has(key.toLowerCase())) {
        fail(`Unsafe cache key ${key} found in ${path}.`);
      }
      visit(nested, path);
    }
  };
  for (const path of files) visit(JSON.parse(readFileSync(path, "utf8")), path);
  return files.length;
}

function directoryFingerprint(directory) {
  const hash = createHash("sha256");
  for (const path of walk(directory).toSorted()) {
    hash.update(path.slice(directory.length));
    hash.update(readFileSync(path));
  }
  return hash.digest("hex");
}

function fixturePreloadSource() {
  return String.raw`
import { appendFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

const mode = process.env.GITMOG_FIXTURE_MODE ?? "default";
const phase = process.env.GITMOG_FIXTURE_PHASE ?? "success";
const variant = process.env.GITMOG_FIXTURE_BLOB_VARIANT ?? "a";
const reportPath = process.env.GITMOG_FIXTURE_REPORT ?? "";
const privateAppId = Number(process.env.GITMOG_FIXTURE_APP_ID ?? "0");
const fixtureNowMs = Date.parse("2026-08-25T00:00:00.000Z");
Date.now = () => fixtureNowMs;
const calls = [];
let blobCalls = 0;
let privateEndpointAuthorized = 0;
let privateTokenReachedPublicEndpoint = 0;
let publicTokenReachedPrivateEndpoint = 0;
let deviceRequestFields = [];
let tokenRequestFields = [];
const shaFor = (value) => createHash("sha1").update(value).digest("hex");

const response = (body, status = 200, remaining = 50) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-limit": "60",
      "x-ratelimit-remaining": String(remaining),
      "x-ratelimit-reset": "1800000000",
    },
  });

const pathsFor = (repository) => {
  if (mode === "transient") {
    return repository === "alpha" ? ["src/one.ts", "src/three.ts"] : ["src/two.ts"];
  }
  if (mode === "oversized") {
    return [
      "src/oversized-0.ts",
      "src/oversized-1.ts",
      "src/oversized-2.ts",
      "src/oversized-3.ts",
      "index.ts",
    ];
  }
  if (mode === "unicode") return ["src/caf\u00e9.ts", "src/cafe\u0301.ts"];
  if (mode === "changed-blob") return ["src/identity.ts"];
  if (mode === "fallback") {
    if (repository === "alpha") return ["src/bad.ts", "index.ts"];
    return ["src/good-b.ts", "other.ts"];
  }
  if (mode === "one-slot") return repository === "repo-000"
    ? ["src/one.ts", "src/two.ts", "src/three.ts"]
    : ["README.md"];
  if (mode === "rate-oversized") return ["src/first.ts", "src/second.ts"];
  return ["src/main.ts"];
};

const repositoryNames = mode === "scope"
  ? ["alpha", "beta", "gamma", ...Array.from({ length: 97 }, (_, index) => "fork-" + String(index).padStart(3, "0"))]
  : mode === "transient"
  ? ["alpha", "beta"]
  : mode === "fallback"
    ? ["alpha", "beta"]
  : mode === "one-slot"
    ? Array.from({ length: 100 }, (_, index) => "repo-" + String(index).padStart(3, "0"))
    : ["repo"];

if (mode === "private-context") {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  if (process.env.GITMOG_FIXTURE_TTY !== "0") {
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
    const columns = Number(process.env.GITMOG_FIXTURE_COLUMNS ?? "80");
    Object.defineProperty(process.stdout, "columns", { configurable: true, value: columns });
    Object.defineProperty(process.stderr, "columns", { configurable: true, value: columns });
  }
}

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const href = request.url;
  const url = new URL(href);
  calls.push(url.pathname + url.search);
  const authorization = request.headers.get("authorization") ?? "";
  const isPrivateEndpoint =
    url.pathname === "/user" ||
    url.pathname.startsWith("/user/installations") ||
    url.pathname.includes("/private-marker-repository/");
  if (mode === "private-context" && isPrivateEndpoint) {
    if (authorization === "Bearer synthetic_private_token_never_rendered") {
      privateEndpointAuthorized += 1;
    } else if (authorization !== "") {
      publicTokenReachedPrivateEndpoint += 1;
    }
  } else if (authorization === "Bearer synthetic_private_token_never_rendered") {
    privateTokenReachedPublicEndpoint += 1;
  }
  if (mode === "timeout" && url.pathname !== "/rate_limit") {
    const error = new Error("synthetic timeout");
    error.name = "TimeoutError";
    throw error;
  }
  if (phase === "fail-all") return response({ message: "fixture fetch forbidden" }, 500);

  if (mode === "private-context" && url.origin === "https://github.com") {
    if (url.pathname === "/login/device/code") {
      deviceRequestFields = [...new URLSearchParams(await request.clone().text()).keys()].sort();
      return response({
        device_code: "synthetic-device-code-never-rendered",
        user_code: "SAFE-CODE",
        verification_uri: "https://github.com/login/device",
        expires_in: 600,
        interval: 1,
      });
    }
    if (url.pathname === "/login/oauth/access_token") {
      tokenRequestFields = [...new URLSearchParams(await request.clone().text()).keys()].sort();
      return response({
        access_token: "synthetic_private_token_never_rendered",
        token_type: "bearer",
        scope: "",
        expires_in: 600,
        refresh_token: "synthetic_refresh_token_never_rendered",
      });
    }
  }

  if (mode === "private-context" && url.pathname === "/user") {
    return response({ login: "FixtureLeft" });
  }
  if (mode === "private-context" && url.pathname === "/user/installations") {
    return response({
      total_count: 1,
      installations: [{
        id: 77,
        app_id: privateAppId,
        repository_selection: "selected",
        permissions: { metadata: "read", contents: "read" },
      }],
    });
  }
  if (mode === "private-context" && url.pathname === "/user/installations/77/repositories") {
    return response({
      total_count: 1,
      repositories: [{
        id: 990077,
        name: "private-marker-repository",
        full_name: "FixtureLeft/private-marker-repository",
        owner: { login: "FixtureLeft", type: "User" },
        private: true,
        visibility: "private",
        archived: false,
        disabled: false,
        fork: false,
        is_template: false,
        mirror_url: null,
        size: 400,
        stargazers_count: 0,
        forks_count: 0,
        open_issues_count: 0,
        language: "TypeScript",
        topics: [],
        homepage: null,
        license: { spdx_id: "MIT" },
        default_branch: "main",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2026-08-20T00:00:00.000Z",
        pushed_at: "2026-08-20T00:00:00.000Z",
        permissions: { admin: true, maintain: true, push: true, pull: true },
      }],
    });
  }

  if (url.pathname === "/rate_limit") {
    return response({
      resources: {
        core: {
          limit: 60,
          remaining: 50,
          reset: 1800000000,
          used: 10,
        },
      },
    });
  }

  const userMatch = /^\/users\/([^/]+)$/.exec(url.pathname);
  if (userMatch) {
    const login = decodeURIComponent(userMatch[1]);
    if (mode === "rate-limit") return response({ message: "API rate limit exceeded" }, 403, 0);
    return response({
      login,
      id: login.length * 1009,
      name: login,
      avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
      html_url: "https://github.com/" + login,
      bio: null,
      type: "User",
      public_repos: repositoryNames.length,
      followers: 1,
      created_at: "2020-01-01T00:00:00.000Z",
    });
  }

  const repoListMatch = /^\/users\/([^/]+)\/repos$/.exec(url.pathname);
  if (repoListMatch) {
    const login = decodeURIComponent(repoListMatch[1]);
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageNames = (mode === "one-slot" || mode === "scope") && page > 1 ? [] : repositoryNames;
    return response(pageNames.map((name, index) => ({
      id: login.length * 10000 + index + 1,
      name,
      full_name: login + "/" + name,
      owner: { login },
      html_url: "https://github.com/" + login + "/" + name,
      description: "fixture " + name,
      fork: mode === "scope" && index >= 3,
      archived: false,
      disabled: false,
      is_template: false,
      mirror_url: null,
      size: 100,
      stargazers_count: 0,
      forks_count: 0,
      open_issues_count: 0,
      language: "TypeScript",
      topics: [],
      homepage: null,
      license: { spdx_id: "MIT" },
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2026-08-20T00:00:00.000Z",
      pushed_at: "2026-08-20T00:00:00.000Z",
      default_branch: "main",
    })));
  }

  if (/^\/users\/[^/]+\/events\/public$/.test(url.pathname)) {
    const page = Number(url.searchParams.get("page") ?? "1");
    if (mode !== "one-slot" || page > 1) return response([]);
    const login = decodeURIComponent(url.pathname.split("/")[2] ?? "fixture");
    return response(Array.from({ length: 100 }, (_, index) => ({
      id: String(index),
      type: "PushEvent",
      actor: { login },
      repo: { name: login + "/repo-000" },
      payload: { push_id: index, ref: "refs/heads/main", head: shaFor("head"), before: shaFor("before") },
      public: true,
      created_at: "2026-08-20T00:00:00.000Z",
    })));
  }

  const repositoryMatch = /^\/repos\/([^/]+)\/([^/]+)\/(.+)$/.exec(url.pathname);
  if (!repositoryMatch) return response({ message: "Not Found" }, 404);
  const login = decodeURIComponent(repositoryMatch[1]);
  const repository = decodeURIComponent(repositoryMatch[2]);
  const endpoint = repositoryMatch[3];
  if (mode === "private-context" && repository === "private-marker-repository") {
    const privateTreeSha = shaFor("private-marker-tree");
    const privateBlobSha = shaFor("private-marker-blob");
    if (endpoint === "commits/main") {
      return response({ sha: shaFor("private-marker-commit"), commit: { tree: { sha: privateTreeSha } } });
    }
    if (endpoint === "git/trees/" + privateTreeSha) {
      return response({
        sha: privateTreeSha,
        truncated: false,
        tree: [{
          path: "src/private-marker-path.ts",
          mode: "100644",
          type: "blob",
          sha: privateBlobSha,
          size: 4000,
        }],
      });
    }
    if (endpoint === "git/blobs/" + privateBlobSha) {
      blobCalls += 1;
      const source = "export function privateMarkerSource(value: string) { return value.trim(); }\n".repeat(24);
      return response({ sha: privateBlobSha, encoding: "base64", content: Buffer.from(source).toString("base64") });
    }
    if (endpoint === "releases") return response([{ id: 1, tag_name: "v1.0.0" }]);
    if (endpoint === "commits" && url.searchParams.has("author")) {
      return response([{ sha: shaFor("private-marker-attribution"), author: { login: "FixtureLeft" } }]);
    }
  }
  if (endpoint === "languages") return response({ TypeScript: 40000 });
  if (endpoint === "releases") return response([]);
  if (endpoint === "commits") {
    return response([{
      sha: shaFor(login + "/" + repository + "/commit-1"),
      commit: {
        message: "Add deterministic fixture coverage",
        author: { name: login, date: "2026-08-20T00:00:00.000Z" },
      },
      author: { login },
      parents: [{ sha: shaFor("parent") }],
    }]);
  }
  if (endpoint.startsWith("git/trees/")) {
    const treeSha = shaFor(mode === "changed-blob" ? "tree-" + variant : login + "/" + repository + "/tree");
    const sharedBlob = shaFor(login + "/" + repository + "/shared-blob");
    return response({
      sha: treeSha,
      truncated: false,
      tree: pathsFor(repository).map((path, index) => ({
        path,
        mode: "100644",
        type: "blob",
        sha: mode === "changed-blob"
          ? shaFor("blob-" + variant)
          : mode === "one-slot"
            ? sharedBlob
            : shaFor(login + "/" + repository + "/blob-" + index),
        size: mode === "oversized" && index < 4 ? 13001 : 4000,
      })),
    });
  }
  if (endpoint.startsWith("git/blobs/")) {
    blobCalls += 1;
    if (mode === "fallback" && blobCalls === 1) {
      return response({
        sha: endpoint.slice("git/blobs/".length),
        encoding: "base64",
        content: Buffer.from([0, 1, 2]).toString("base64"),
      });
    }
    if (mode === "rate-oversized" && blobCalls === 1) {
      return response({ message: "x".repeat(3 * 1024 * 1024) }, 403, 0);
    }
    if (mode === "transient" && phase === "rate-limit" && blobCalls === 2) {
      return response({ message: "API rate limit exceeded" }, 403, 0);
    }
    const source = (
      "export function measured" + String(blobCalls) + "(value: string) {\n" +
      "  if (value.length === 0) throw new Error('value');\n" +
      "  return value.trim();\n" +
      "}\n"
    ).repeat(24) + (mode === "changed-blob" ? "// " + variant + "\n" : "");
    return response({
      sha: endpoint.slice("git/blobs/".length),
      encoding: "base64",
      content: Buffer.from(source, "utf8").toString("base64"),
    });
  }
  return response({ message: "Not Found" }, 404);
};

process.on("exit", () => {
  if (reportPath !== "") {
    appendFileSync(reportPath, JSON.stringify({
      mode,
      phase,
      calls,
      blobCalls,
      privateEndpointAuthorized,
      privateTokenReachedPublicEndpoint,
      publicTokenReachedPrivateEndpoint,
      deviceRequestFields,
      tokenRequestFields,
    }) + "\n", "utf8");
  }
});
`;
}

function assertBalancedAnsi(value) {
  const sgr = new RegExp(`${ESCAPE}\\[([0-9;]*)m`, "g");
  const matches = [...value.matchAll(sgr)];
  const opens = matches.filter((match) => match[1] !== "0").length;
  const resets = matches.filter((match) => match[1] === "0").length;
  if (opens === 0 || opens !== resets) fail("Packed colored output has unbalanced ANSI SGR.");
  if (value.replace(sgr, "").includes(ESCAPE)) fail("Packed colored output has a partial escape.");
  for (const line of value.split("\n").filter((entry) => /^[╔╠╚║]/.test(entry))) {
    if (Array.from(line.replace(sgr, "")).length !== 74) {
      fail("Packed fight-card line has the wrong visible width.");
    }
    let active = false;
    for (const match of line.matchAll(sgr)) active = match[1] !== "0";
    if (active) fail("Packed fight-card style crossed a line boundary.");
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const scratch = mkdtempSync(join(tmpdir(), "gitmog packed acceptance "));
  const installDirectory = scratch;
  const cacheDirectory = join(scratch, "cache");
  const npmCacheDirectory = join(scratch, "npm-cache");
  const { npmCli, npxCli } = resolveNpmEntrypoints();
  const environment = {
    ...process.env,
    GITHUB_TOKEN: "",
    GITMOG_NO_BROWSER: "1",
    GITMOG_CACHE_DIR: cacheDirectory,
    npm_config_cache: npmCacheDirectory,
    NPM_CONFIG_CACHE: npmCacheDirectory,
    NO_COLOR: "1",
  };
  const report = {
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    tarball: {
      name: basename(options.tarball),
      bytes: statSync(options.tarball).size,
      sha256: createHash("sha256")
        .update(readFileSync(options.tarball))
        .digest("hex")
        .toUpperCase(),
    },
    checks: [],
  };
  const record = (name, detail = "passed") => report.checks.push({ name, detail });
  let publicCommandEnvironment = environment;
  const npx = (binary, args, expected = 0, env = publicCommandEnvironment) =>
    runCli(npxCli, ["--no-install", binary, ...args], {
      cwd: installDirectory,
      env,
      expected,
    });

  try {
    runCli(npmCli, ["init", "--yes"], { cwd: scratch, env: environment });
    runCli(npmCli, ["install", "--ignore-scripts", "--no-audit", "--no-fund", options.tarball], {
      cwd: scratch,
      env: environment,
    });
    record("packed-install");
    const installedManifest = JSON.parse(
      readFileSync(join(scratch, "node_modules", "gitmog", "package.json"), "utf8"),
    );
    if (Object.keys(installedManifest.dependencies ?? {}).length !== 0) {
      fail("Packed Git Mog acquired runtime dependencies.");
    }
    record("zero-runtime-dependencies");

    const installedBinary = join(scratch, "node_modules", "gitmog", "bin", "gitmog.mjs");
    const installedBundlePath = join(scratch, "node_modules", "gitmog", "dist", "gitmog.mjs");
    const installedParserPath = join(
      scratch,
      "node_modules",
      "gitmog",
      "dist",
      "parsers",
      "quality-worker.mjs",
    );
    const installedBuild = JSON.parse(
      readFileSync(join(scratch, "node_modules", "gitmog", "dist", "build.json"), "utf8"),
    );
    if (
      !existsSync(installedParserPath) ||
      JSON.stringify(installedBuild.parserAssets) !== JSON.stringify(["parsers/quality-worker.mjs"])
    ) {
      fail("Packed parser asset allowlist is incomplete.");
    }
    const parserMarker = "PACKED_RAW_SOURCE_MUST_NOT_RETURN";
    const parserResult = await new Promise((resolveResult, rejectResult) => {
      const worker = new Worker(pathToFileURL(installedParserPath), {
        resourceLimits: {
          maxOldGenerationSizeMb: 96,
          maxYoungGenerationSizeMb: 16,
          stackSizeMb: 4,
        },
        stdout: true,
        stderr: true,
      });
      worker.stdout.resume();
      worker.stderr.resume();
      const timer = setTimeout(() => {
        void worker.terminate();
        rejectResult(
          new Error("Packed parser worker did not complete within its acceptance bound."),
        );
      }, 5_000);
      timer.unref();
      worker.once("error", () => {
        clearTimeout(timer);
        rejectResult(new Error("Packed parser worker failed without exposing parser input."));
      });
      worker.on("message", (message) => {
        if (message?.type === "ready") {
          worker.postMessage({
            type: "parse",
            id: 1,
            path: "synthetic.ts",
            source: `export const value: string = "${parserMarker}";`,
          });
        } else if (message?.type === "result" && message.id === 1) {
          clearTimeout(timer);
          void worker.terminate();
          resolveResult(message.result);
        }
      });
    });
    const parserRecord =
      typeof parserResult === "object" && parserResult !== null
        ? /** @type {Record<string, unknown>} */ (parserResult)
        : null;
    if (
      parserRecord === null ||
      parserRecord.ok !== true ||
      JSON.stringify(parserRecord).includes(parserMarker)
    ) {
      fail("Packed parser worker did not return safe derived TypeScript AST features.");
    }
    record("parser-asset-smoke", "TypeScript AST; resource-limited worker; source-free result");
    const installedBundle = readFileSync(installedBundlePath, "utf8");
    assertBrowserOpenBundlePolicy(installedBundle, readFileSync(installedParserPath, "utf8"));
    if (JSON.stringify(installedBuild.interaction) !== JSON.stringify(interactionVersions)) {
      fail("Packed browser and interaction versions differ from the reviewed contract.");
    }
    report.browserCapability = {
      version: installedBuild.interaction.browserCapability,
      destinations: [
        "https://github.com/login/device",
        "https://github.com/apps/git-mog-private-context/installations/new",
        "https://github.com/settings/installations/<numeric-id>",
      ],
      commandContract: hostedBrowserCommandContract(process.platform),
      evidence: "packed-command-construction-only",
    };
    record(
      "packed-browser-command-contract",
      `${process.platform} mapping present; hosted lane does not claim a visible GUI open`,
    );
    const installedReadme = readFileSync(
      join(scratch, "node_modules", "gitmog", "README.md"),
      "utf8",
    );
    if (
      !installedBundle.includes("2.0.0-source-opportunity-scope") ||
      !installedBundle.includes("6.1.0-failure-fallback-opportunities") ||
      !installedBundle.includes("1.2.0-cache-invariant-support") ||
      !installedBundle.includes("2.0.0-default-full-profile-snapshot") ||
      !installedBundle.includes("default-full-snapshot:2") ||
      !installedBundle.includes("1.0.0-coverage-aware") ||
      !installedBundle.includes("1.0.0-self-contained")
    ) {
      fail("Packed bundle omitted a current source-analysis or snapshot-cache version.");
    }
    for (const command of ["npx -y gitmog torvalds gvanrossum", "npx -y gitmog karpathy geohot"]) {
      if (installedBundle.split(command).length !== 2) {
        fail(`Packed bundle did not contain exactly one onboarding command: ${command}`);
      }
    }
    if (
      installedBundle.includes("5.0.0-raw-path-blob-receipts") ||
      installedBundle.includes("6.0.0-cache-invariant-opportunities") ||
      installedBundle.includes("1.1.0-stable-cache-raw-receipts") ||
      installedBundle.includes("fast-scan:1") ||
      installedBundle.includes("4.0.0-reused-tree-features") ||
      installedBundle.includes("1.0.0-default-bounded-analysis")
    ) {
      fail("Packed bundle retained an obsolete source-analysis cache or receipt version.");
    }
    if (
      /[A-Za-z]:\\Users\\|\/Users\/[^/]+\/|\/home\/[^/]+\//.test(installedBundle) ||
      installedBundle.includes(ESCAPE) ||
      installedBundle.includes("export function measured") ||
      /\bmodels?\b/iu.test(`${installedBundle}\n${installedReadme}`)
    ) {
      fail("Packed bundle contains a machine path, raw ANSI, fixture source, or model term.");
    }
    record(
      "packed-bundle-audit",
      "current schemas; no machine paths, raw ANSI, fixture source, or model term",
    );

    const fixturePreload = join(scratch, "fixture-preload.mjs");
    writeFileSync(fixturePreload, fixturePreloadSource(), "utf8");
    if (options.fixtureNetwork) {
      publicCommandEnvironment = {
        ...environment,
        GITMOG_FIXTURE_MODE: "transient",
        GITMOG_FIXTURE_PHASE: "success",
        NODE_OPTIONS: `--import=${pathToFileURL(fixturePreload).href}`,
      };
      record("network-mode", "deterministic GitHub fixture");
    } else {
      record("network-mode", "live public GitHub");
    }
    let fixtureSequence = 0;
    const runFixture = (
      mode,
      args,
      {
        cacheDirectory: fixtureCache,
        phase = "success",
        variant = "a",
        color = false,
        authenticated = false,
        columns = 80,
        tty = true,
        expected = 0,
      } = {},
    ) => {
      fixtureSequence += 1;
      const reportPath = join(scratch, `fixture-report-${String(fixtureSequence)}.jsonl`);
      const fixtureEnvironment = {
        ...environment,
        GITHUB_TOKEN: authenticated ? "fixture-auth-scope-sentinel" : "",
        GITMOG_CACHE_DIR: fixtureCache ?? join(scratch, `fixture-cache-${String(fixtureSequence)}`),
        GITMOG_FIXTURE_MODE: mode,
        GITMOG_FIXTURE_PHASE: phase,
        GITMOG_FIXTURE_BLOB_VARIANT: variant,
        GITMOG_FIXTURE_REPORT: reportPath,
        GITMOG_FIXTURE_APP_ID: privateContextConfig.appId,
        GITMOG_FIXTURE_COLUMNS: String(columns),
        GITMOG_FIXTURE_TTY: tty ? "1" : "0",
        NODE_OPTIONS: `--import=${pathToFileURL(fixturePreload).href}`,
      };
      if (color) delete fixtureEnvironment.NO_COLOR;
      const result = runCli(installedBinary, args, {
        cwd: scratch,
        env: fixtureEnvironment,
        expected,
      });
      const reports = existsSync(reportPath)
        ? readFileSync(reportPath, "utf8")
            .trim()
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [];
      return { result, report: reports.at(-1) ?? { calls: [], blobCalls: 0 } };
    };

    const fixtureHelpRuns = [[], ["help"], ["--help"], ["-h"]].map((args) =>
      runFixture("default", args),
    );
    const [fixtureHelp] = fixtureHelpRuns;
    if (
      fixtureHelpRuns.some(
        (run) => run.report.calls.length !== 0 || run.result.stdout !== fixtureHelp.result.stdout,
      )
    ) {
      fail("Packed bare/help commands differed or reached GitHub.");
    }
    for (const command of ["npx -y gitmog torvalds gvanrossum", "npx -y gitmog karpathy geohot"]) {
      if (!fixtureHelp.result.stdout.includes(command)) {
        fail(`Packed help omitted onboarding command: ${command}`);
      }
    }
    if (
      fixtureHelp.result.stdout.indexOf("npx -y gitmog <left> <right>") >
        fixtureHelp.result.stdout.indexOf("TRY IT") ||
      fixtureHelp.result.stdout.split(/\r?\n/).some((line) => line.length > 80)
    ) {
      fail("Packed help reordered primary grammar, exceeded 80 columns, or lost the disclaimer.");
    }
    const fixtureAdvancedHelp = runFixture("default", ["--help-all"]);
    if (
      fixtureAdvancedHelp.report.calls.length !== 0 ||
      !fixtureAdvancedHelp.result.stdout.includes("--json") ||
      !fixtureAdvancedHelp.result.stdout.includes("--sign-in") ||
      !fixtureAdvancedHelp.result.stdout.includes("--no-open") ||
      !fixtureAdvancedHelp.result.stdout.includes("--cache-info") ||
      !fixtureAdvancedHelp.result.stdout.includes("--clear-cache")
    ) {
      fail("Packed advanced help reached GitHub or omitted advanced controls.");
    }
    const fixtureLocalCache = join(scratch, "fixture-local-cache");
    const fixtureCacheInfo = runFixture("default", ["--cache-info", "--json"], {
      cacheDirectory: fixtureLocalCache,
    });
    const cacheInfo = parseJson(fixtureCacheInfo.result, "fixture-cache-info");
    if (
      fixtureCacheInfo.report.calls.length !== 0 ||
      cacheInfo.cache?.action !== "info" ||
      cacheInfo.cache?.maximumBytes !== 25 * 1024 * 1024 ||
      cacheInfo.cache?.rawSourceStored !== false ||
      cacheInfo.cache?.npmCacheControlled !== false
    ) {
      fail("Packed cache info reached GitHub or returned the wrong local contract.");
    }
    for (let index = 0; index < 2; index += 1) {
      const fixtureClearCache = runFixture("default", ["--clear-cache", "--json"], {
        cacheDirectory: fixtureLocalCache,
      });
      const cleared = parseJson(fixtureClearCache.result, `fixture-clear-cache-${String(index)}`);
      if (
        fixtureClearCache.report.calls.length !== 0 ||
        cleared.cache?.action !== "clear" ||
        cleared.cache?.bytesRemoved !== 0 ||
        cleared.cache?.filesRemoved !== 0
      ) {
        fail("Packed clear cache was not zero-call and idempotent for an empty root.");
      }
    }
    record(
      "fixture-cache-commands",
      "info and idempotent clear are JSON-only, zero-call, 25 MiB, raw-source-free",
    );

    const privateCache = join(scratch, "fixture-private-context-cache");
    const privateNpmFingerprintBefore = directoryFingerprint(npmCacheDirectory);
    const publicBaseline = runFixture(
      "private-context",
      ["fixtureleft", "fixtureright", "--public-only", "--json"],
      { cacheDirectory: privateCache },
    );
    const publicBaselinePayload = parseJson(
      publicBaseline.result,
      "private-context-public-baseline",
    );
    const privateCacheFingerprintBefore = directoryFingerprint(privateCache);
    const privateMixed = runFixture(
      "private-context",
      ["fixtureleft", "fixtureright", "--private-context", "--json", "--no-cache"],
      { cacheDirectory: privateCache },
    );
    const privateMixedPayload = parseJson(privateMixed.result, "private-context-mixed-json");
    const privateCacheFingerprintAfter = directoryFingerprint(privateCache);
    const privateNpmFingerprintAfter = directoryFingerprint(npmCacheDirectory);
    const publicOnlyObject = (value) => {
      const {
        evidenceMode: _evidenceMode,
        privateContext: _privateContext,
        privateContextError: _privateContextError,
        ...publicValue
      } = value;
      return publicValue;
    };
    if (
      publicBaselinePayload.evidenceMode !== "public-only" ||
      privateMixedPayload.evidenceMode !== "public-with-private-context" ||
      privateMixedPayload.privateContext?.scoreInfluence !== 0 ||
      privateMixedPayload.privateContext?.publicWinnerInfluence !== 0 ||
      privateMixedPayload.privateContext?.persisted !== false ||
      privateMixedPayload.privateContext?.maintainedCodebase?.scope !== "selected-sample" ||
      privateMixedPayload.privateContext?.maintainedCodebase?.classification !== "informational" ||
      privateMixedPayload.privateContext?.maintainedCodebase?.scoreInfluence !== 0 ||
      privateMixedPayload.privateContext?.maintainedCodebase?.publicWinnerInfluence !== 0 ||
      privateMixedPayload.privateContext?.maintainedCodebase?.persisted !== false ||
      JSON.stringify(publicOnlyObject(privateMixedPayload)) !==
        JSON.stringify(publicOnlyObject(publicBaselinePayload))
    ) {
      fail("Packed Private Context changed the canonical public result.");
    }
    if (
      privateCacheFingerprintBefore !== privateCacheFingerprintAfter ||
      privateNpmFingerprintBefore !== privateNpmFingerprintAfter
    ) {
      fail("Packed Private Context changed a persistent Git Mog or npm cache.");
    }
    if (
      privateMixed.report.privateEndpointAuthorized < 7 ||
      privateMixed.report.privateTokenReachedPublicEndpoint !== 0 ||
      privateMixed.report.publicTokenReachedPrivateEndpoint !== 0 ||
      JSON.stringify(privateMixed.report.deviceRequestFields) !== JSON.stringify(["client_id"]) ||
      JSON.stringify(privateMixed.report.tokenRequestFields) !==
        JSON.stringify(["client_id", "device_code", "grant_type"])
    ) {
      fail("Packed Private Context crossed its token or device-flow boundary.");
    }
    const privateMarkers = [
      "private-marker-repository",
      "private-marker-path",
      "privateMarkerSource",
      "990077",
      "synthetic_private_token_never_rendered",
      "synthetic_refresh_token_never_rendered",
      "synthetic-device-code-never-rendered",
    ];
    const assertPrivateSurfaceSafe = (value, label) => {
      for (const marker of privateMarkers) {
        if (value.includes(marker)) fail(`${label} exposed a private fixture marker.`);
      }
    };
    assertPrivateSurfaceSafe(privateMixed.result.stdout, "Mixed JSON");
    assertPrivateSurfaceSafe(privateMixed.result.stderr, "Mixed JSON instructions");
    if (!privateMixed.result.stderr.includes("PRIVATE REPOS")) {
      fail("Packed Private Context omitted its separate permission explanation.");
    }
    if (privateMixed.result.stderr.includes("Reviewing code qualityPRIVATE REPOS")) {
      fail("Packed Private Context authorization collided with transient progress.");
    }
    record(
      "private-context-canonical-invariance",
      "byte-identical public object; score, winner, rounds, verdict, coverage, evidence, and battle key isolated",
    );
    record(
      "private-context-auth-boundary",
      "client ID only; exact polling fields; private token excluded from public endpoints",
    );
    record("private-context-cache-invariance", "Git Mog and npm cache fingerprints unchanged");

    const privateSurfaceCases = [
      ["terminal", []],
      ["details", ["--details"]],
      ["receipts", ["--receipts"]],
      ["card", ["--card"]],
      ["share-plain", ["--share", "plain"]],
      ["share-x", ["--share", "x"]],
      ["share-discord", ["--share", "discord"]],
      ["share-linkedin", ["--share", "linkedin"]],
      ["color", ["--color", "always"]],
      ["no-color", ["--color", "never"]],
      ["no-motion", ["--no-motion"]],
      ["piped", []],
      ["width-60", []],
      ["width-80", []],
      ["width-100", []],
    ];
    for (const [label, flags] of privateSurfaceCases) {
      const surface = runFixture(
        "private-context",
        ["fixtureleft", "fixtureright", "--private-context", "--no-cache", ...flags],
        {
          color: label === "color",
          columns: label === "width-60" ? 60 : label === "width-100" ? 100 : 80,
          tty: label !== "piped",
        },
      );
      assertPrivateSurfaceSafe(surface.result.stdout, `Mixed ${label}`);
      assertPrivateSurfaceSafe(surface.result.stderr, `Mixed ${label} instructions`);
      const required =
        label === "card"
          ? ["MIXED CONTEXT", "WINNER STILL USES PUBLIC REPOS ONLY"]
          : label.startsWith("share-")
            ? ["Mixed context:", "Private repos did not change the winner."]
            : ["PRIVATE CONTEXT", "winner still uses public repos only"];
      const compact = compactRenderedText(surface.result.stdout);
      for (const text of required) {
        if (!compact.includes(text)) {
          fail(`Mixed ${label} omitted required disclosure: ${text}`);
        }
      }
      if (!compact.includes("Code sample:")) {
        fail(`Mixed ${label} omitted selected-sample scope.`);
      }
      if (label !== "details" && /previewScore: \d+/.test(compact)) {
        fail(`Mixed ${label} exposed a numeric private preview score.`);
      }
      if (label === "details") {
        for (const text of [
          "previewScore:",
          "selected-sample",
          "informational",
          "scoreInfluence: 0",
          "publicWinnerInfluence: 0",
          "persisted: false",
        ]) {
          if (!compact.includes(text)) fail(`Mixed details omitted private score label: ${text}`);
        }
      }
      if (label === "receipts") {
        const privateStart = surface.result.stdout.indexOf("PRIVATE AGGREGATES");
        if (privateStart < 0) fail("Mixed receipts omitted PRIVATE AGGREGATES.");
        const privateBlock = surface.result.stdout.slice(privateStart);
        const markerIds = [...surface.result.stdout.matchAll(/\[(P\d+)\]/g)].map(
          (match) => match[1],
        );
        if (markerIds.length === 0) fail("Mixed receipts omitted private aggregate markers.");
        for (const marker of markerIds) {
          if (!privateBlock.includes(`[${marker}]`)) {
            fail(`Visible private marker ${marker} has no rendered aggregate.`);
          }
        }
      } else if (/\[P\d+\]/.test(surface.result.stdout)) {
        fail(`Mixed ${label} exposed an unresolved private marker.`);
      }
      if (PRIVATE_PROGRESS_COLLISION.test(surface.result.stderr)) {
        fail(`Mixed ${label} collided transient progress with Private Context authorization.`);
      }
    }
    const privateProfile = runFixture("private-context", [
      "fixtureleft",
      "--private-context",
      "--json",
      "--no-cache",
    ]);
    const privateProfilePayload = parseJson(privateProfile.result, "private-context-profile-json");
    if (
      privateProfilePayload.evidenceMode !== "public-with-private-context" ||
      privateProfilePayload.privateContext?.subject !== "FixtureLeft"
    ) {
      fail("Packed Private Context profile mode omitted its aggregate result.");
    }
    assertPrivateSurfaceSafe(privateProfile.result.stdout, "Mixed profile JSON");
    const privateHtml = join(scratch, "private exports with spaces", "battle.html");
    const privateSvg = join(scratch, "private exports with spaces", "battle.svg");
    for (const [format, destination] of [
      ["HTML", privateHtml],
      ["SVG", privateSvg],
    ]) {
      const exported = runFixture("private-context", [
        "fixtureleft",
        "fixtureright",
        "--private-context",
        "--no-cache",
        "--export",
        destination,
      ]);
      const bytes = readFileSync(destination, "utf8");
      assertPrivateSurfaceSafe(exported.result.stdout, `Mixed ${format} export report`);
      assertPrivateSurfaceSafe(exported.result.stderr, `Mixed ${format} export instructions`);
      assertPrivateSurfaceSafe(bytes, `Mixed ${format} export`);
      if (!bytes.includes("MIXED CONTEXT") || !bytes.includes("PUBLIC WINNER")) {
        fail(`Mixed ${format} export omitted its disclosure panel.`);
      }
    }
    record(
      "private-context-output-matrix",
      "profile, terminal, details, receipts, card, four shares, 60/80/100 columns, color, no-color, no-motion, piped, HTML, and SVG disclosed and source-free",
    );

    for (const [left, right] of [
      ["torvalds", "gvanrossum"],
      ["karpathy", "geohot"],
    ]) {
      const example = runFixture("default", [left, right, "--json"]);
      const payload = parseJson(example.result, `fixture-famous-${left}-${right}`);
      if (
        payload.battle?.left?.username !== left ||
        payload.battle?.right?.username !== right ||
        example.report.calls.length === 0
      ) {
        fail(`Packed famous matchup did not use ordinary two-handle analysis: ${left} ${right}`);
      }
    }
    record(
      "famous-matchup-onboarding",
      "two exact commands; generic grammar first; all help forms zero-call; ordinary fixture battles",
    );

    const canonicalScopePayload = (value) => {
      const { qualityPreview: _qualityPreview, ...canonical } = value;
      return JSON.stringify(withoutRequestBudgets(canonical));
    };
    const sourceScopeStatus = (value) => ({
      status: value.sourceAnalysis?.status,
      cacheDisposition: value.sourceAnalysis?.cacheDisposition,
      sampleIds: value.sourceAnalysis?.samples?.map((sample) => sample.sampleId) ?? [],
      sampleKey: value.sourceAnalysis?.sampleKey,
    });
    const runScope = (fixtureCache, authenticated, { phase = "success", flags = [] } = {}) => {
      const execution = runFixture("scope", ["fixturescope", "--json", ...flags], {
        cacheDirectory: fixtureCache,
        authenticated,
        phase,
      });
      return {
        ...execution,
        payload: parseJson(execution.result, `fixture-scope-${authenticated ? "high" : "low"}`),
      };
    };

    const lowFirstCache = join(scratch, "fixture-scope-low-first-cache");
    const lowFirst = runScope(lowFirstCache, false);
    const lowReused = runScope(lowFirstCache, false, { phase: "fail-all" });
    const highAfterLow = runScope(lowFirstCache, true);
    const highReusedAfterLow = runScope(lowFirstCache, true, { phase: "fail-all" });

    const highFirstCache = join(scratch, "fixture-scope-high-first-cache");
    const highFirst = runScope(highFirstCache, true);
    const highReused = runScope(highFirstCache, true, { phase: "fail-all" });
    const lowAfterHigh = runScope(highFirstCache, false);
    const lowReusedAfterHigh = runScope(highFirstCache, false, { phase: "fail-all" });

    const lowRuns = [lowFirst, lowAfterHigh];
    const highRuns = [highAfterLow, highFirst];
    if (
      lowRuns.some(
        (run) =>
          run.payload.requestBudget?.cap !== 16 ||
          sourceScopeStatus(run.payload).status !== "partial" ||
          sourceScopeStatus(run.payload).cacheDisposition !== "stable" ||
          sourceScopeStatus(run.payload).sampleIds.length !== 2,
      ) ||
      highRuns.some(
        (run) =>
          run.payload.requestBudget?.cap !== 16 ||
          sourceScopeStatus(run.payload).status !== "partial" ||
          sourceScopeStatus(run.payload).cacheDisposition !== "stable" ||
          sourceScopeStatus(run.payload).sampleIds.length !== 2,
      ) ||
      JSON.stringify(lowRuns.map((run) => run.report.blobCalls)) !== JSON.stringify([2, 0]) ||
      JSON.stringify(highRuns.map((run) => run.report.blobCalls)) !== JSON.stringify([0, 2]) ||
      walk(join(lowFirstCache, "analysis")).length !== 1 ||
      walk(join(highFirstCache, "analysis")).length !== 1
    ) {
      fail(
        `Packed authentication-invariant source scopes did not resolve to stable 2/PARTIAL results: ${JSON.stringify(
          {
            low: lowRuns.map((run) => ({
              blobCalls: run.report.blobCalls,
              cap: run.payload.requestBudget?.cap,
              source: sourceScopeStatus(run.payload),
            })),
            high: highRuns.map((run) => ({
              blobCalls: run.report.blobCalls,
              cap: run.payload.requestBudget?.cap,
              source: sourceScopeStatus(run.payload),
            })),
          },
        )}`,
      );
    }
    for (const reused of [lowReused, highReusedAfterLow, highReused, lowReusedAfterHigh]) {
      if (reused.report.calls.length !== 0) {
        fail("Packed same-scope warm reuse reached GitHub.");
      }
    }
    if (
      canonicalScopePayload(lowFirst.payload) !== canonicalScopePayload(lowAfterHigh.payload) ||
      canonicalScopePayload(lowFirst.payload) !== canonicalScopePayload(highFirst.payload) ||
      canonicalScopePayload(highAfterLow.payload) !== canonicalScopePayload(highFirst.payload) ||
      canonicalScopePayload(lowFirst.payload) !== canonicalScopePayload(lowReused.payload) ||
      canonicalScopePayload(lowAfterHigh.payload) !==
        canonicalScopePayload(lowReusedAfterHigh.payload) ||
      canonicalScopePayload(highAfterLow.payload) !==
        canonicalScopePayload(highReusedAfterLow.payload) ||
      canonicalScopePayload(highFirst.payload) !== canonicalScopePayload(highReused.payload)
    ) {
      fail("Packed logical source scope changed with population order or warm cache state.");
    }

    const lowFingerprintBeforeNoCache = directoryFingerprint(lowFirstCache);
    const lowNoCache = runScope(lowFirstCache, false, { flags: ["--no-cache"] });
    if (
      lowNoCache.report.blobCalls !== 2 ||
      directoryFingerprint(lowFirstCache) !== lowFingerprintBeforeNoCache ||
      canonicalScopePayload(lowNoCache.payload) !== canonicalScopePayload(lowFirst.payload)
    ) {
      fail("Packed low-scope --no-cache changed canonical bytes or persistent state.");
    }
    const highFingerprintBeforeNoCache = directoryFingerprint(lowFirstCache);
    const highNoCache = runScope(lowFirstCache, true, { flags: ["--no-cache"] });
    if (
      highNoCache.report.blobCalls !== 2 ||
      directoryFingerprint(lowFirstCache) !== highFingerprintBeforeNoCache ||
      canonicalScopePayload(highNoCache.payload) !== canonicalScopePayload(highAfterLow.payload)
    ) {
      fail("Packed high-scope --no-cache changed canonical bytes or persistent state.");
    }

    const lowRefresh = runScope(lowFirstCache, false, { flags: ["--refresh"] });
    const highRefresh = runScope(lowFirstCache, true, { flags: ["--refresh"] });
    if (
      lowRefresh.report.blobCalls !== 2 ||
      highRefresh.report.blobCalls !== 2 ||
      canonicalScopePayload(lowRefresh.payload) !== canonicalScopePayload(lowFirst.payload) ||
      canonicalScopePayload(highRefresh.payload) !== canonicalScopePayload(highAfterLow.payload)
    ) {
      fail("Packed scoped refresh did not recompute and replace byte-identical stable results.");
    }
    const scopeSecurityBytes = [...walk(lowFirstCache), ...walk(highFirstCache)]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const scopeOutputs = [lowFirst, lowAfterHigh, highAfterLow, highFirst]
      .map((run) => run.result.stdout + run.result.stderr)
      .join("\n");
    if (
      scopeSecurityBytes.includes("fixture-auth-scope-sentinel") ||
      scopeOutputs.includes("fixture-auth-scope-sentinel")
    ) {
      fail("Packed scope cache or output persisted the fixture authentication sentinel.");
    }
    record(
      "fixture-code-dna-scope-isolation",
      "anonymous/authenticated both orders; warm; refresh; no-cache; stable PARTIAL; auth sentinel absent",
    );

    const invariantCache = join(scratch, "fixture-invariant-cache");
    const invariantCold = runFixture("one-slot", ["fixtureinvariant", "--json"], {
      cacheDirectory: invariantCache,
    });
    const coldPayload = parseJson(invariantCold.result, "fixture-invariant-cold");
    rmSync(join(invariantCache, "analysis"), { recursive: true, force: true });
    const invariantWarm = runFixture("one-slot", ["fixtureinvariant", "--json"], {
      cacheDirectory: invariantCache,
    });
    const warmPayload = parseJson(invariantWarm.result, "fixture-invariant-warm");
    rmSync(join(invariantCache, "analysis"), { recursive: true, force: true });
    const invariantWarmer = runFixture("one-slot", ["fixtureinvariant", "--json"], {
      cacheDirectory: invariantCache,
    });
    const warmerPayload = parseJson(invariantWarmer.result, "fixture-invariant-warmer");
    const invariantSamples = (payload) =>
      payload.sourceAnalysis?.samples?.map((sample) => `${sample.sampleId}:${sample.path}`) ?? [];
    if (
      invariantCold.report.blobCalls !== 1 ||
      invariantWarm.report.blobCalls !== 0 ||
      invariantWarmer.report.blobCalls !== 0 ||
      invariantSamples(coldPayload).length !== 3 ||
      JSON.stringify(invariantSamples(coldPayload)) !==
        JSON.stringify(invariantSamples(warmPayload)) ||
      JSON.stringify(invariantSamples(coldPayload)) !==
        JSON.stringify(invariantSamples(warmerPayload)) ||
      JSON.stringify(withoutRequestBudgets(coldPayload)) !==
        JSON.stringify(withoutRequestBudgets(warmPayload)) ||
      JSON.stringify(withoutRequestBudgets(coldPayload)) !==
        JSON.stringify(withoutRequestBudgets(warmerPayload))
    ) {
      fail("Packed cold/warm/warmer source selection changed with derived-cache state.");
    }
    record(
      "fixture-cache-invariant-selection",
      "three path receipts from one blob; HTTP calls 1/0/0; canonical bytes identical",
    );

    const noCacheBefore = directoryFingerprint(invariantCache);
    const noCacheFixture = runFixture("one-slot", ["fixtureinvariant", "--json", "--no-cache"], {
      cacheDirectory: invariantCache,
    });
    if (
      noCacheFixture.report.blobCalls !== 1 ||
      directoryFingerprint(invariantCache) !== noCacheBefore ||
      JSON.stringify(
        withoutRequestBudgets(parseJson(noCacheFixture.result, "fixture-no-cache")),
      ) !== JSON.stringify(withoutRequestBudgets(coldPayload))
    ) {
      fail("Packed --no-cache read or wrote persistent state, or changed canonical analysis.");
    }
    record("fixture-no-cache-policy", "no persistent read/write; canonical analysis unchanged");

    const rateFixture = runFixture("rate-oversized", ["fixtureratelimit", "--json", "--no-cache"]);
    const ratePayload = parseJson(rateFixture.result, "fixture-rate-oversized");
    if (
      rateFixture.report.blobCalls !== 1 ||
      ratePayload.sourceAnalysis?.sourceFailureReason !== "rate-limited" ||
      JSON.stringify(ratePayload.sourceAnalysis).includes('"oversized"')
    ) {
      fail(
        "Packed oversized rate-limit body masked rate-limit classification or sampling continued.",
      );
    }
    record("fixture-rate-limit-before-body", "one blob call; rate-limited; no oversized mask");

    const humanRate = runFixture(
      "rate-limit",
      ["fixtureratelimit", "fixtureopponent", "--no-cache"],
      { expected: 1 },
    );
    if (
      humanRate.result.stdout !== "" ||
      !humanRate.result.stderr.includes("GITHUB LIMIT REACHED") ||
      !humanRate.result.stderr.includes("@fixtureratelimit vs @fixtureopponent") ||
      !humanRate.result.stderr.includes("Retry after ") ||
      !humanRate.result.stderr.includes("--sign-in") ||
      humanRate.result.stderr.includes("No score was fabricated") ||
      humanRate.result.stderr.includes("public receipt machine") ||
      humanRate.report.calls.length !== 3
    ) {
      fail(
        `Packed human rate-limit battle was misclassified, duplicated, or lost its handles: ${JSON.stringify(
          {
            stdout: humanRate.result.stdout,
            stderr: humanRate.result.stderr,
            calls: humanRate.report.calls,
          },
        )}`,
      );
    }
    const humanTimeout = runFixture(
      "timeout",
      ["fixturetimeout", "fixtureopponent", "--no-cache"],
      { expected: 1 },
    );
    if (
      humanTimeout.result.stdout !== "" ||
      !humanTimeout.result.stderr.includes("GITHUB TIMED OUT") ||
      !humanTimeout.result.stderr.includes("@fixturetimeout vs @fixtureopponent") ||
      !humanTimeout.result.stderr.includes("Retry the battle.") ||
      humanTimeout.result.stderr.includes("RATE LIMIT") ||
      humanTimeout.report.calls.length !== 3
    ) {
      fail("Packed human timeout battle was misclassified, duplicated, or lost its handles.");
    }
    const timeoutJson = runFixture(
      "timeout",
      ["fixturetimeout", "fixtureopponent", "--json", "--no-cache"],
      { expected: 1 },
    );
    if (
      timeoutJson.result.stderr !== "" ||
      parseJson(timeoutJson.result, "fixture-timeout-json").error?.code !== "timeout"
    ) {
      fail("Packed timeout JSON mixed human stderr or returned the wrong classification.");
    }
    record(
      "fixture-human-failures",
      "rate limit and timeout distinct; both handles; reset metadata; JSON-only timeout",
    );

    const fallbackFixture = runFixture("fallback", ["fixturefallback", "--json", "--no-cache"]);
    const fallbackPayload = parseJson(fallbackFixture.result, "fixture-failed-read-backup");
    if (
      fallbackFixture.report.blobCalls !== 4 ||
      fallbackPayload.sourceAnalysis?.samples?.length !== 3 ||
      !fallbackPayload.sourceAnalysis.samples.some((sample) => sample.path === "index.ts") ||
      !fallbackPayload.sourceAnalysis.sourceFailureReasons?.includes("non-text")
    ) {
      fail("Packed failed source read did not promote the bounded backup candidate.");
    }
    record("fixture-failed-read-backup", "first read rejected; fourth candidate completed 3/3");

    const invalidPresentationCases = [
      ["--caption", "--share", "bogus"],
      ["--caption", "--share", "plain"],
      ["--card", "--share", "x"],
      ["--card", "--caption"],
      ["--card", "--json"],
      ["--share", "x", "--json"],
      ["--card", "--details"],
      ["--share", "x", "--details"],
      ["--json", "--details"],
    ];
    for (const flags of invalidPresentationCases) {
      const invalidPresentation = runFixture("default", ["fixtureleft", "fixtureright", ...flags], {
        expected: 2,
      });
      if (invalidPresentation.report.calls.length !== 0) {
        fail(`Packed presentation conflict reached GitHub: ${flags.join(" ")}`);
      }
      if (flags.includes("--json")) {
        const error = parseJson(invalidPresentation.result, `fixture-${flags.join("-")}`);
        if (error.error?.code !== "usage" || error.error?.retryable !== false) {
          fail(`Packed JSON presentation conflict returned the wrong contract: ${flags.join(" ")}`);
        }
      } else if (!invalidPresentation.result.stderr.includes("INVALID USAGE")) {
        fail(`Packed presentation conflict omitted human usage: ${flags.join(" ")}`);
      }
    }
    record("fixture-presentation-validation", "nine conflicts exit 2 before any GitHub call");

    for (const args of [
      ["fixtureduplicate", "FixtureDuplicate"],
      ["fixtureduplicate", "FixtureDuplicate", "--json"],
    ]) {
      const duplicate = runFixture("default", args, { expected: 2 });
      if (duplicate.report.calls.length !== 0) fail("Packed same-handle usage reached GitHub.");
      if (args.includes("--json")) {
        const error = parseJson(duplicate.result, "fixture-same-handle-json");
        if (error.error?.code !== "usage" || error.error?.retryable !== false) {
          fail("Packed same-handle JSON returned the wrong error contract.");
        }
      } else if (!duplicate.result.stderr.includes("INVALID USAGE")) {
        fail("Packed same-handle usage omitted human usage output.");
      }
    }
    record("fixture-same-handle-usage", "direct and JSON exit 2 with zero calls");

    for (const opponent of ["help", "auth", "setup", "doctor", "cache", "login", "battle"]) {
      const validOpponent = runFixture("default", ["alice", opponent, "--json"]);
      if (
        validOpponent.report.calls.length === 0 ||
        parseJson(validOpponent.result, `fixture-opponent-${opponent}`).battle === undefined
      ) {
        fail(`Packed valid opponent handle ${opponent} did not run a battle.`);
      }
    }
    record(
      "fixture-reserved-handle-opponents",
      "help, auth, setup, doctor, cache, login, and battle run as ordinary opponents",
    );

    for (const args of [
      ["battle", "alice", "bob"],
      ["battle", "alice", "bob", "--json"],
    ]) {
      const thirdPositional = runFixture("default", args, { expected: 2 });
      if (thirdPositional.report.calls.length !== 0) {
        fail("Packed third positional grammar reached GitHub.");
      }
    }
    record("fixture-third-positional", "human and JSON exit 2 with zero calls");

    const schemaCache = join(scratch, "fixture-schema-cache");
    runFixture("default", ["fixtureschema", "--json"], { cacheDirectory: schemaCache });
    const snapshotFiles = walk(join(schemaCache, "snapshots"));
    if (snapshotFiles.length !== 1)
      fail("Packed valid snapshot fixture did not persist one envelope.");
    writeFileSync(snapshotFiles[0], JSON.stringify({ snapshotKey: "old-schema" }), "utf8");
    const recollectedSchema = runFixture("default", ["fixtureschema", "--json"], {
      cacheDirectory: schemaCache,
    });
    if (recollectedSchema.report.calls.length === 0) {
      fail("Packed old snapshot schema was accepted without recollection.");
    }
    const replacementEnvelope = JSON.parse(readFileSync(snapshotFiles[0], "utf8"));
    if (
      replacementEnvelope.schemaVersion !== "2.0.0-default-full-profile-snapshot" ||
      replacementEnvelope.cacheKeyVersion !== "default-full-snapshot:2" ||
      typeof replacementEnvelope.checksum !== "string" ||
      replacementEnvelope.snapshot?.inspections?.[0]?.treeSha === undefined ||
      replacementEnvelope.snapshot?.inspections?.[0]?.tree?.[0]?.sha === undefined
    ) {
      fail("Packed recollection did not replace the old object with the exact snapshot envelope.");
    }
    const validRoundTrip = runFixture("default", ["fixtureschema", "--json"], {
      cacheDirectory: schemaCache,
      phase: "fail-all",
    });
    if (validRoundTrip.report.calls.length !== 0) {
      fail("Packed valid snapshot round-trip attempted GitHub collection.");
    }
    record(
      "fixture-snapshot-schema",
      "old object recollected; exact v2 envelope reused with zero calls",
    );

    const receiptCache = join(scratch, "fixture-receipt-cache");
    const receiptJson = parseJson(
      runFixture("transient", ["fixtureleft", "fixtureright", "--json"], {
        cacheDirectory: receiptCache,
      }).result,
      "fixture-receipt-json",
    );
    if (
      receiptJson.story?.basis !== "source" ||
      receiptJson.story?.finisher?.sampleIds?.length < 1
    ) {
      fail("Packed receipt fixture did not produce a source-backed finisher.");
    }
    const storyFinisherText = compactRenderedText(receiptJson.story.finisher.text);
    const receiptSurfaces = [
      [
        "card",
        runFixture("transient", ["fixtureleft", "fixtureright", "--card"], {
          cacheDirectory: receiptCache,
        }).result.stdout,
      ],
      [
        "plain",
        runFixture("transient", ["fixtureleft", "fixtureright", "--share", "plain"], {
          cacheDirectory: receiptCache,
        }).result.stdout,
      ],
      [
        "x",
        runFixture("transient", ["fixtureleft", "fixtureright", "--share", "x"], {
          cacheDirectory: receiptCache,
        }).result.stdout,
      ],
      [
        "discord",
        runFixture("transient", ["fixtureleft", "fixtureright", "--share", "discord"], {
          cacheDirectory: receiptCache,
        }).result.stdout,
      ],
      [
        "linkedin",
        runFixture("transient", ["fixtureleft", "fixtureright", "--share", "linkedin"], {
          cacheDirectory: receiptCache,
        }).result.stdout,
      ],
    ];
    for (const [surface, output] of receiptSurfaces) {
      const compact = compactRenderedText(output);
      const storyVisible = compact.includes(storyFinisherText);
      if (surface === "card") {
        if (!storyVisible || !output.includes("[1]")) {
          fail("Packed card omitted its supported source finisher or compact marker.");
        }
      } else if (["plain", "discord"].includes(surface) && !storyVisible) {
        fail(`Packed ${surface} suppressed a source finisher whose complete support fits.`);
      }
      if (storyVisible) {
        if (!output.includes("[1]")) fail(`Packed ${surface} detached its compact support marker.`);
        for (const sampleId of receiptJson.story.finisher.sampleIds) {
          if (output.includes(sampleId)) fail(`Packed ${surface} exposed source ID ${sampleId}.`);
        }
      }
    }
    record(
      "fixture-source-receipt-closure",
      "card and shares use compact support or suppress atomically",
    );

    const transientCache = join(scratch, "fixture-transient-cache");
    const transientFirst = runFixture("transient", ["fixturepartial", "--json"], {
      cacheDirectory: transientCache,
      phase: "rate-limit",
    });
    const transientPayload = parseJson(transientFirst.result, "fixture-transient-partial");
    if (
      transientPayload.sourceAnalysis?.status !== "partial" ||
      transientPayload.sourceAnalysis?.cacheDisposition !== "transient" ||
      !transientPayload.sourceAnalysis?.sourceFailureReasons?.includes("rate-limited") ||
      walk(join(transientCache, "analysis")).length !== 0
    ) {
      fail("Packed transient partial was persisted or lost structured provenance.");
    }
    const successfulRetry = runFixture("transient", ["fixturepartial", "--json"], {
      cacheDirectory: transientCache,
    });
    const successfulPayload = parseJson(successfulRetry.result, "fixture-transient-retry");
    if (
      successfulPayload.sourceAnalysis?.status !== "ready" ||
      successfulPayload.sourceAnalysis?.cacheDisposition !== "stable" ||
      successfulRetry.report.blobCalls < 1 ||
      walk(join(transientCache, "analysis")).length !== 1
    ) {
      fail("Packed retry did not recompute, stabilize, and persist READY analysis.");
    }
    record("fixture-transient-cache-retry", "partial not cached; READY retry persisted");

    const refreshedFixture = runFixture("transient", ["fixturepartial", "--json", "--refresh"], {
      cacheDirectory: transientCache,
    });
    if (
      refreshedFixture.report.blobCalls < 1 ||
      !refreshedFixture.report.calls.some((path) => path.startsWith("/users/fixturepartial"))
    ) {
      fail("Packed --refresh reused a snapshot, whole-profile analysis, or derived-feature read.");
    }
    const afterRefresh = runFixture("transient", ["fixturepartial", "--json"], {
      cacheDirectory: transientCache,
      phase: "fail-all",
    });
    if (
      afterRefresh.report.calls.length !== 0 ||
      JSON.stringify(
        withoutRequestBudgets(parseJson(afterRefresh.result, "fixture-refresh-hit")),
      ) !==
        JSON.stringify(
          withoutRequestBudgets(parseJson(refreshedFixture.result, "fixture-refresh-write")),
        )
    ) {
      fail("Packed --refresh did not write the stable replacement for the next command.");
    }
    const failedRefresh = runFixture("transient", ["fixturepartial", "--json", "--refresh"], {
      cacheDirectory: transientCache,
      phase: "fail-all",
      expected: 1,
    });
    if (failedRefresh.report.calls.length !== 1) {
      fail("Packed failed refresh did not stop at the upstream profile failure.");
    }
    const afterFailedRefresh = runFixture("transient", ["fixturepartial", "--json"], {
      cacheDirectory: transientCache,
      phase: "fail-all",
    });
    if (
      afterFailedRefresh.report.calls.length !== 0 ||
      JSON.stringify(
        withoutRequestBudgets(parseJson(afterFailedRefresh.result, "fixture-failed-refresh-hit")),
      ) !==
        JSON.stringify(
          withoutRequestBudgets(parseJson(refreshedFixture.result, "fixture-refresh-write")),
        )
    ) {
      fail("Packed failed refresh damaged the previous stable cache entries.");
    }
    record(
      "fixture-refresh-analysis-cache",
      "bypassed every persistent read, wrote stable replacement, preserved it on failure",
    );

    const oversizedFixture = parseJson(
      runFixture("oversized", ["fixtureoversized", "--json", "--no-cache"]).result,
      "fixture-oversized-fifth",
    );
    if (
      oversizedFixture.sourceAnalysis?.samples?.length !== 1 ||
      oversizedFixture.sourceAnalysis.samples[0]?.path !== "index.ts" ||
      oversizedFixture.requestBudget?.source !== 1 ||
      !oversizedFixture.sourceAnalysis.sourceFailureReasons?.includes("oversized")
    ) {
      fail("Packed metadata-oversized candidates hid or consumed the valid fifth sample.");
    }
    record("fixture-oversized-fifth", "four metadata rejects, one valid blob call");

    const unicodeFixture = parseJson(
      runFixture("unicode", ["fixtureunicode", "--json", "--no-cache"]).result,
      "fixture-unicode-paths",
    );
    const unicodeIds =
      unicodeFixture.sourceAnalysis?.samples?.map((sample) => sample.sampleId) ?? [];
    if (unicodeIds.length !== 2 || new Set(unicodeIds).size !== 2) {
      fail("Packed NFC/NFD source paths collided in receipt identity.");
    }
    record("fixture-unicode-receipts", unicodeIds.join(", "));

    const changedA = parseJson(
      runFixture("changed-blob", ["fixturechanged", "--json", "--no-cache"], { variant: "a" })
        .result,
      "fixture-changed-blob-a",
    );
    const changedB = parseJson(
      runFixture("changed-blob", ["fixturechanged", "--json", "--no-cache"], { variant: "b" })
        .result,
      "fixture-changed-blob-b",
    );
    if (
      changedA.sourceAnalysis?.samples?.[0]?.sampleId === undefined ||
      changedA.sourceAnalysis.samples[0].sampleId ===
        changedB.sourceAnalysis?.samples?.[0]?.sampleId
    ) {
      fail("Packed changed blob SHA did not change the source receipt ID.");
    }
    record("fixture-changed-blob-receipt");

    const maximumLeft = "a".repeat(39);
    const maximumRight = "b".repeat(39);
    const cleanCardFixture = runFixture(
      "color",
      [maximumLeft, maximumRight, "--card", "--color", "always"],
      { color: true },
    );
    if (cleanCardFixture.result.stdout.includes(`${ESCAPE}[`)) {
      fail("Packed copy-oriented card emitted ANSI under forced color.");
    }
    const coloredFixture = runFixture("color", [maximumLeft, maximumRight, "--color", "always"], {
      color: true,
    });
    assertBalancedAnsi(coloredFixture.result.stdout);
    record(
      "fixture-maximum-colored-handles",
      "copy-clean card; balanced SGR and 74-column human lines",
    );

    const version = npx("gitmog", ["--version"]).stdout;
    const help = npx("gitmog", ["help"]).stdout;
    const alternateHelp = npx("git-mog", ["help"]).stdout;
    if (
      version === "" ||
      canonicalizePackageHelpInvocation(help) !== canonicalizePackageHelpInvocation(alternateHelp)
    ) {
      fail("Binary names do not share one help path.");
    }
    if (!help.includes("npx -y gitmog <left> <right>")) fail("Primary usage is missing.");
    record("both-binary-names", version);

    const invalid = npx("gitmog", [options.left, options.right, removedThirdToken], 2);
    if (!invalid.stderr.includes("Current usage"))
      fail("Invalid grammar did not show current usage.");
    for (const flag of removedFlags) npx("gitmog", [options.left, options.right, flag], 2);
    record(
      "removed-grammar",
      `third positional and ${String(removedFlags.length)} removed options exit 2`,
    );

    // The two-profile result is deliberately the first networked command. Its budget
    // evidence therefore describes a genuinely cold battle rather than a battle that
    // inherited one warmed profile from the one-handle acceptance below.
    const args = [options.left, options.right, "--json"];
    const firstResult = npx("gitmog", args);
    const first = parseJson(firstResult, "direct-battle");
    report.canonicalJsonSha256 = createHash("sha256").update(firstResult.stdout).digest("hex");
    report.canonicalBattleSha256 = createHash("sha256")
      .update(JSON.stringify(first.battle))
      .digest("hex");
    if (
      report.canonicalJsonSha256 !== EXPECTED_CANONICAL_JSON_SHA256 ||
      report.canonicalBattleSha256 !== EXPECTED_CANONICAL_BATTLE_SHA256
    ) {
      fail("Packed public fixture changed the v0.4.1 canonical JSON or battle bytes.");
    }
    record(
      "canonical-v0.4.1-invariance",
      "JSON and battle SHA-256 match the published v0.4.1 fixture",
    );
    if (!first.battle || !first.presentationVerdict || !first.sourceAnalysis || !first.story) {
      fail("Battle JSON does not contain the complete contract.");
    }
    const leftCoverage = first.battle.left?.confidence?.measuredWeight;
    const rightCoverage = first.battle.right?.confidence?.measuredWeight;
    const minimumCoverage = Math.min(leftCoverage, rightCoverage);
    const coverageDifference = Math.abs(leftCoverage - rightCoverage);
    if (
      first.presentationVerdict.version !== "1.0.0-coverage-aware" ||
      first.presentationVerdict.minimumCoverage !== minimumCoverage ||
      first.presentationVerdict.coverageDifference !== coverageDifference ||
      (minimumCoverage < 50 && first.presentationVerdict.band !== "limited") ||
      (coverageDifference > 30 && first.presentationVerdict.band !== "limited") ||
      (first.presentationVerdict.band !== "full-strength" &&
        /NUCLEAR|CATASTROPHIC/u.test(first.presentationVerdict.label))
    ) {
      fail("Battle JSON returned an invalid coverage-aware presentation verdict.");
    }
    if (first.battle.rounds?.length !== first.battle.left?.categories?.length) {
      fail("Battle JSON omitted a canonical category round.");
    }
    if (
      !first.battle.rounds.some((round) => round.leftScore === null || round.rightScore === null)
    ) {
      fail("Battle JSON omitted explicit null-score rounds.");
    }
    if (first.sourceAnalysis.requestBudget.total > 32) fail("Battle exceeded 32 requests.");
    record("direct-battle", `${String(first.sourceAnalysis.requestBudget.total)}/32 requests`);
    const alternateBattle = parseJson(npx("git-mog", args), "alternate-bin-battle");
    if (
      JSON.stringify(withoutRequestBudgets(alternateBattle)) !==
      JSON.stringify(withoutRequestBudgets(first))
    ) {
      fail("The git-mog binary produced different canonical analysis from gitmog.");
    }
    record("alternate-bin-battle", "gitmog and git-mog canonical analysis identical");
    record(
      "json-contract",
      `canonical ${first.battle.verdictLabel}; presentation ${first.presentationVerdict.label}`,
    );
    report.publicBattle = {
      left: options.left,
      right: options.right,
      scores: {
        left: first.battle.left.overallScore,
        right: first.battle.right.overallScore,
      },
      winner: first.battle.winner,
      sourceStatus: first.sourceAnalysis.status,
      requestBudget: first.sourceAnalysis.requestBudget,
      planId: first.story.planId,
    };

    const terminal = npx("gitmog", [options.left, options.right]);
    for (const handle of ["torvalds", "gvanrossum", "karpathy", "geohot"]) {
      if (terminal.stdout.includes(handle)) {
        fail(`Completed battle output injected unrelated onboarding handle: ${handle}`);
      }
    }
    for (const expected of [
      "GIT MOG",
      "Coverage:",
      "THE FIGHT",
      "THE READ",
      "RECEIPTS",
      "More: --details",
    ]) {
      if (!terminal.stdout.includes(expected)) {
        fail(`Default battle output omitted ${expected}.`);
      }
    }
    if (!terminal.stdout.includes("WINS") && !terminal.stdout.includes("◆ TIE")) {
      fail("Default battle omitted its winner or tie state.");
    }
    assertTaxonomyFree(terminal.stdout, "Default battle");
    if (terminal.stdout.toUpperCase().includes("CODE DNA")) {
      fail("Default battle exposed a Code DNA label.");
    }
    const compactTerminal = compactRenderedText(terminal.stdout);
    const compactFinisher = compactRenderedText(first.battle.finishingMove.text);
    if (!compactTerminal.includes(compactFinisher)) fail("Default battle omitted its finisher.");
    if (terminal.stdout.includes("RAW RECEIPTS")) {
      fail("Default battle expanded every receipt without --receipts.");
    }
    for (const banned of [
      "PUBLIC EVIDENCE · DETERMINISTIC · NOTHING EXECUTED",
      "PUBLIC RECEIPTS LOCKED",
      "REAL REPOS RANKED",
      "THE MOG CALCULATED",
      "score remains honest",
      "ROAST LOADED",
      "every line backed by receipts",
      "SOURCE PASS",
      "Trust:",
      "Deterministic public-GitHub analysis. No LLM. Target code never executed.",
      "No score was fabricated",
      "public receipt machine",
      "Code DNA describes only the files sampled",
      "exact collection limits",
      "qualifying commits per year, estimated",
      "annualized qualifying commits",
      "sustained original project",
      "source opportunity",
      "classifier",
    ]) {
      if (terminal.stdout.includes(banned)) fail(`Default battle retained banned copy: ${banned}`);
    }
    if (/(?:craft|ship)\.[A-Za-z0-9_.-]+:[A-Za-z0-9_-]+|\bs[0-9a-f]{8,}\b/u.test(terminal.stdout)) {
      fail("Default battle exposed an internal evidence ID.");
    }
    if (terminal.stdout.trim().split("\n").length > 30) {
      fail("Default 80-column battle exceeded 30 visible lines.");
    }
    record("battle-terminal");
    report.representativeTerminal = terminal.stdout;

    const repeatResult = npx("gitmog", args);
    const repeat = parseJson(repeatResult, "repeated-battle");
    if (
      JSON.stringify(withoutRequestBudgets(repeat)) !== JSON.stringify(withoutRequestBudgets(first))
    ) {
      fail("Repeated battle changed canonical analysis bytes.");
    }
    if (
      repeat.sourceAnalysis?.requestBudget?.left?.metadata !== 0 ||
      repeat.sourceAnalysis?.requestBudget?.left?.source !== 0 ||
      repeat.sourceAnalysis?.requestBudget?.left?.total !== 0 ||
      repeat.sourceAnalysis?.requestBudget?.right?.metadata !== 0 ||
      repeat.sourceAnalysis?.requestBudget?.right?.source !== 0 ||
      repeat.sourceAnalysis?.requestBudget?.right?.total !== 0 ||
      repeat.sourceAnalysis?.requestBudget?.total !== 0
    ) {
      fail("Repeated battle reported historical calls instead of current zero-call telemetry.");
    }
    record("fixture-warm-request-telemetry", "zero current calls reported as 0/32");
    record("repeated-battle-cache", "identical canonical analysis; zero current calls");

    const reversed = parseJson(
      npx("gitmog", [options.right, options.left, "--json"]),
      "reversed-battle",
    );
    if (
      JSON.stringify(reversed.sourceAnalysis.left.codeDna) !==
        JSON.stringify(first.sourceAnalysis.right.codeDna) ||
      JSON.stringify(reversed.sourceAnalysis.right.codeDna) !==
        JSON.stringify(first.sourceAnalysis.left.codeDna)
    ) {
      fail("Reversed battle did not reuse profile analyses.");
    }
    if (reversed.story.finisher.text === first.story.finisher.text) {
      fail("Reversed battle reused directional copy.");
    }
    record("reversed-battle-reuse");

    const profile = parseJson(npx("gitmog", [options.left, "--json"]), "profile-analysis");
    if (profile.profile?.username?.toLowerCase() !== options.left.toLowerCase()) {
      fail("Profile analysis returned the wrong handle.");
    }
    if (!profile.sourceAnalysis?.status) fail("Profile source analysis is missing.");
    record("profile-analysis", profile.sourceAnalysis.status);
    const profileTerminal = npx("gitmog", [options.left]);
    for (const expected of [
      "GIT MOG",
      "Score:",
      "Coverage:",
      "THE READ",
      "RECEIPTS",
      "Next: gitmog",
    ]) {
      if (!profileTerminal.stdout.includes(expected)) {
        fail(`Default profile output omitted ${expected}.`);
      }
    }
    assertTaxonomyFree(profileTerminal.stdout, "Default profile");
    if (profileTerminal.stdout.toUpperCase().includes("CODE DNA")) {
      fail("Default profile exposed a Code DNA label.");
    }
    if (
      /(?:craft|ship)\.[A-Za-z0-9_.-]+:[A-Za-z0-9_-]+|\bs[0-9a-f]{8,}\b/u.test(
        profileTerminal.stdout,
      )
    ) {
      fail("Default profile exposed an internal evidence ID.");
    }
    if (profileTerminal.stdout.trim().split("\n").length > 16) {
      fail("Default profile exceeded 16 visible lines.");
    }
    record("profile-terminal");

    const details = npx("gitmog", [options.left, options.right, "--details"]);
    for (const expected of [
      "ALL SCORED ROUNDS",
      "THE READ",
      "Direct ↔ Abstract",
      "Vibe ↔ Ritual",
      "Compact ↔ Ceremonial",
      "Application ↔ Systems",
    ]) {
      if (!details.stdout.includes(expected)) fail(`Details output omitted ${expected}.`);
    }
    assertTaxonomyFree(details.stdout, "Details");
    if (details.stdout.includes("RAW RECEIPTS")) fail("--details expanded raw receipts.");
    record("details");

    const card = npx("gitmog", [options.left, options.right, "--card"]);
    for (const expected of ["SCORE", "COVERAGE", "» ", "[1] "]) {
      if (!card.stdout.includes(expected)) fail(`Card omitted ${expected}.`);
    }
    assertTaxonomyFree(card.stdout, "Card");
    if (card.stdout.toUpperCase().includes("CODE DNA")) {
      fail("Card exposed a Code DNA label.");
    }
    if (!card.stdout.includes("WINS") && !card.stdout.includes("◆ TIE")) {
      fail("Card omitted its winner or tie state.");
    }
    if (/(?:craft|ship)\.[A-Za-z0-9_.-]+:[A-Za-z0-9_-]+|\bs[0-9a-f]{8,}\b/u.test(card.stdout)) {
      fail("Card exposed an internal support ID.");
    }
    record("card");
    report.representativeCard = card.stdout;
    for (const preset of ["plain", "x", "discord", "linkedin"]) {
      const share = npx("gitmog", [options.left, options.right, "--share", preset]);
      for (const expected of ["SCORE", "COVERAGE"]) {
        if (!share.stdout.includes(expected)) fail(`${preset} share omitted ${expected}.`);
      }
      assertTaxonomyFree(share.stdout, `${preset} share`);
      if (share.stdout.toUpperCase().includes("CODE DNA")) {
        fail(`${preset} share exposed a Code DNA label.`);
      }
      if (share.stdout.includes("NORMALIZED") || share.stdout.includes("MEASURED")) {
        fail(`${preset} share retained audit-heavy score labels.`);
      }
      if (!share.stdout.includes(`npx -y gitmog ${options.left} ${options.right}`)) {
        fail(`${preset} share omitted the canonical command.`);
      }
      if (preset === "x" && share.stdout.trim().length > 280)
        fail("X share exceeded 280 characters.");
      if (preset === "discord" && share.stdout.trim().length > 2_000) {
        fail("Discord share exceeded 2,000 characters.");
      }
    }
    record("share", "plain, x, discord, linkedin");
    const htmlExport = join(scratch, "exports with spaces", "battle.html");
    const svgExport = join(scratch, "exports with spaces", "battle.svg");
    const canonicalExportRoot = join(realpathSync(scratch), "exports with spaces");
    const htmlResult = npx("gitmog", [options.left, options.right, "--export", htmlExport]);
    if (
      !htmlResult.stdout.includes(join(canonicalExportRoot, "battle.html")) ||
      !existsSync(htmlExport)
    ) {
      fail("HTML export did not report and create the requested absolute path.");
    }
    const htmlBytes = readFileSync(htmlExport, "utf8");
    if (
      !htmlBytes.includes("Content-Security-Policy") ||
      !htmlBytes.includes("Three decisive comparisons") ||
      /<script|<iframe|https?:\/\//iu.test(htmlBytes)
    ) {
      fail("HTML export was not self-contained, semantic, or network-free.");
    }
    const svgMetadata = parseJson(
      npx("gitmog", [options.left, options.right, "--export", svgExport, "--json"]),
      "svg-export",
    );
    const svgBytes = readFileSync(svgExport, "utf8");
    if (
      svgMetadata.export?.format !== "svg" ||
      svgMetadata.export?.path !== join(canonicalExportRoot, "battle.svg") ||
      svgMetadata.export?.bytes !== Buffer.byteLength(svgBytes) ||
      !/^[a-f0-9]{64}$/u.test(svgMetadata.export?.sha256 ?? "") ||
      !svgBytes.includes('role="img"') ||
      /<script|<foreignObject|href=|url\s*\(/iu.test(svgBytes)
    ) {
      fail("SVG export omitted metadata, accessibility, or self-contained safety.");
    }
    npx("gitmog", [options.left, options.right, "--export", svgExport], 2);
    if (readFileSync(svgExport, "utf8") !== svgBytes) {
      fail("Existing export destination was overwritten.");
    }
    record(
      "battle-export",
      `${String(Buffer.byteLength(htmlBytes))} HTML bytes; ${String(Buffer.byteLength(svgBytes))} SVG bytes; atomic no-overwrite`,
    );
    const receipts = npx("gitmog", [options.left, options.right, "--receipts"]);
    for (const expected of ["ALL SCORED ROUNDS", "RAW RECEIPTS", "SOURCE SAMPLES", "VERSIONS"]) {
      if (!receipts.stdout.includes(expected)) fail(`Full receipts omitted ${expected}.`);
    }
    record("receipts");

    for (const roast of ["clean", "unhinged"]) {
      const roasted = npx("gitmog", [options.left, options.right, "--roast", roast]);
      const flag = ` --roast ${roast}`;
      const champion = first.battle.winner === "right" ? options.right : options.left;
      const loser = champion === options.left ? options.right : options.left;
      for (const expected of [
        `Rematch: gitmog ${champion} ${loser}${flag}`,
        `Next: gitmog ${champion} <handle>${flag}`,
        "More: --details · --receipts · --share x",
      ]) {
        if (!roasted.stdout.includes(expected)) {
          fail(`${roast} output did not reproduce authoritative challenge command: ${expected}`);
        }
      }
    }
    record("challenge-roast-modes", "clean and unhinged preserve ordering and flags");

    for (const [name, arguments_, code, expectedError] of [
      ["invalid-handle-json", ["not a handle", "--json"], 2, "usage"],
      ["usage-json", ["--json"], 2, "usage"],
    ]) {
      const failure = npx("gitmog", arguments_, code);
      if (failure.stderr !== "") fail(`${name} mixed human stderr into JSON.`);
      const parsedFailure = parseJson(failure, name);
      if (parsedFailure.error?.code !== expectedError) fail(`${name} returned the wrong code.`);
    }
    record("json-errors", "local input and usage errors exit 2; JSON-only");

    const ansiEnvironment = { ...publicCommandEnvironment };
    delete ansiEnvironment.NO_COLOR;
    const colored = npx(
      "gitmog",
      [options.left, options.right, "--color", "always"],
      0,
      ansiEnvironment,
    );
    if (!colored.stdout.includes(`${ESCAPE}[`)) fail("Forced color emitted no ANSI.");
    assertBalancedAnsi(colored.stdout);
    const copyCard = npx(
      "gitmog",
      [options.left, options.right, "--card", "--color", "always"],
      0,
      ansiEnvironment,
    );
    if (copyCard.stdout.includes(`${ESCAPE}[`)) fail("Forced color contaminated card output.");
    if (firstResult.stdout.includes(`${ESCAPE}[`)) fail("JSON leaked ANSI.");
    record("ansi-behavior", "balanced human color; JSON and card byte-clean");
    record("exit-codes", "success=0 usage=2");

    const safeCacheFiles = assertCacheSafe(cacheDirectory);
    const cacheFiles = walk(cacheDirectory);
    report.cache = {
      bytes: cacheFiles.reduce((total, path) => total + statSync(path).size, 0),
      files: cacheFiles.length,
      jsonFiles: safeCacheFiles,
      maximumBytes: 25 * 1024 * 1024,
      rawSourceStored: false,
      npmCacheControlled: false,
    };
    record("cache-no-source-persistence", `${String(safeCacheFiles)} JSON files`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
