#!/usr/bin/env node
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { runBattle } from "../packages/battle/dist/index.js";
import { renderBattle, renderBattleExport, run } from "../packages/cli/dist/index.js";
import { collectProfileSnapshot } from "../packages/github/dist/index.js";
import { buildBattle, scoreProfileFastScan } from "../packages/scoring/dist/index.js";
import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
} from "../packages/test-fixtures/src/github-personas.ts";

import { captureNodeCli, resolveNpmEntrypoints } from "./lib/package-manager.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const npxIndex = process.argv.indexOf("--include-npx");
const npxPackage = npxIndex < 0 ? null : (process.argv[npxIndex + 1] ?? null);
const samples = check ? 15 : 25;
const warmups = 3;
const scratch = mkdtempSync(join(tmpdir(), "gitmog-benchmark-"));

const percentile = (values, percentage) => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * percentage) - 1)] ?? 0;
};
const rounded = (value) => Math.round(value * 100) / 100;
const summarize = (name, durations, budgetMs, extra = {}) => ({
  name,
  samples: durations.length,
  p50Ms: rounded(percentile(durations, 0.5)),
  p95Ms: rounded(percentile(durations, 0.95)),
  budgetMs,
  ...extra,
});
const measureAsync = async (name, budgetMs, operation) => {
  const durations = [];
  for (let index = 0; index < samples + warmups; index += 1) {
    const started = performance.now();
    await operation(index);
    const duration = performance.now() - started;
    if (index >= warmups) durations.push(duration);
  }
  return summarize(name, durations, budgetMs);
};
const measureSync = (name, budgetMs, operation) => {
  const durations = [];
  for (let index = 0; index < samples + warmups; index += 1) {
    const started = performance.now();
    operation(index);
    const duration = performance.now() - started;
    if (index >= warmups) durations.push(duration);
  }
  return summarize(name, durations, budgetMs);
};

const routedFixture = (counter) => {
  const left = createFixtureFetch(PERSONAS.strongMaintainer);
  const right = createFixtureFetch(PERSONAS.manyTinyRepos);
  return (input, init) => {
    counter.calls += 1;
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return href.toLowerCase().includes(PERSONAS.strongMaintainer.login)
      ? left(input, init)
      : right(input, init);
  };
};
const fixtureContext = ({
  cacheDirectory = null,
  authenticated = false,
  preflight = false,
} = {}) => {
  const counter = { calls: 0, allowanceReads: 0 };
  return {
    counter,
    context: {
      invokedAs: "gitmog",
      version: "0.2.2",
      env: {
        NO_COLOR: "1",
        ...(cacheDirectory === null ? {} : { GITMOG_CACHE_DIR: cacheDirectory }),
        ...(authenticated ? { GITHUB_TOKEN: "fixture_auth_sentinel" } : {}),
      },
      fetchImpl: routedFixture(counter),
      now: () => FIXTURE_NOW_MS,
      useFilesystem: cacheDirectory !== null,
      skipBudgetPreflight: !preflight,
      ...(preflight
        ? {
            readAllowance: ({ token }) => {
              counter.allowanceReads += 1;
              return Promise.resolve({
                ok: true,
                allowance: {
                  authenticated: token !== undefined,
                  limit: token === undefined ? 60 : 5_000,
                  remaining: token === undefined ? 60 : 5_000,
                  resetAt: "2026-08-23T22:00:00.000Z",
                  rateLimitClass: "none",
                  retryAfterSeconds: null,
                  source: "endpoint",
                },
              });
            },
          }
        : {}),
    },
  };
};
const runFixtureBattle = async (options = {}) => {
  const fixture = fixtureContext(options);
  const result = await run(
    ["node", "gitmog", "strongmaintainer", "sidequester", "--json"],
    fixture.context,
  );
  if (result.exitCode !== 0) throw new Error(`Fixture battle failed: ${result.stderr}`);
  return { fixture, result, payload: JSON.parse(result.stdout) };
};

const metrics = [];
const evidence = {};

try {
  const installedBin = resolve(root, "packages", "distribution", "bin", "gitmog.mjs");
  metrics.push(
    measureSync("installed-bin startup", 2_000, () => {
      const result = captureNodeCli("gitmog", installedBin, ["--help"], {
        cwd: scratch,
        env: { ...process.env, GITHUB_TOKEN: "", GH_TOKEN: "", NO_COLOR: "1" },
      });
      if (result.code !== 0 || !result.stdout.includes("npx -y gitmog <left> <right>")) {
        throw new Error("Installed-bin help failed.");
      }
    }),
  );

  let helpCalls = 0;
  metrics.push(
    await measureAsync("help startup", 100, async () => {
      const result = await run(["node", "gitmog", "--help"], {
        invokedAs: "gitmog",
        version: "0.2.2",
        env: { NO_COLOR: "1" },
        fetchImpl: () => {
          helpCalls += 1;
          return Promise.resolve(new Response("{}"));
        },
        useFilesystem: false,
      });
      if (result.exitCode !== 0) throw new Error("Help benchmark failed.");
    }),
  );
  if (helpCalls !== 0) throw new Error("Help benchmark reached the network.");

  metrics.push(
    await measureAsync("fixture profile", 750, async () => {
      const fixture = fixtureContext();
      const result = await run(["node", "gitmog", "strongmaintainer", "--json"], fixture.context);
      if (result.exitCode !== 0) throw new Error("Fixture profile benchmark failed.");
    }),
  );

  const coldCalls = [];
  metrics.push(
    await measureAsync("cold fixture battle", 1_500, async () => {
      const execution = await runFixtureBattle();
      coldCalls.push(execution.fixture.counter.calls);
      if (
        execution.payload.sourceAnalysis.requestBudget.total !== execution.fixture.counter.calls
      ) {
        throw new Error("Cold request plan did not match observed calls.");
      }
    }),
  );

  const snapshotTemplate = join(scratch, "snapshot-template");
  await runFixtureBattle({ cacheDirectory: snapshotTemplate });
  rmSync(join(snapshotTemplate, "analysis"), { recursive: true, force: true });
  rmSync(join(snapshotTemplate, "features"), { recursive: true, force: true });
  const snapshotCalls = [];
  let snapshotRun = 0;
  metrics.push(
    await measureAsync("warm snapshot cache", 750, async () => {
      const directory = join(scratch, `snapshot-run-${String(snapshotRun)}`);
      snapshotRun += 1;
      cpSync(snapshotTemplate, directory, { recursive: true });
      const execution = await runFixtureBattle({ cacheDirectory: directory });
      snapshotCalls.push(execution.fixture.counter.calls);
      rmSync(directory, { recursive: true, force: true });
    }),
  );

  const fullyWarm = join(scratch, "fully-warm");
  await runFixtureBattle({ cacheDirectory: fullyWarm });
  const warmCalls = [];
  metrics.push(
    await measureAsync("warm derived/source cache", 500, async () => {
      const execution = await runFixtureBattle({ cacheDirectory: fullyWarm });
      warmCalls.push(execution.fixture.counter.calls);
      if (execution.fixture.counter.calls !== 0) {
        throw new Error("Fully warm fixture battle made a network call.");
      }
    }),
  );

  let anonymousCanonical = "";
  let authenticatedCanonical = "";
  metrics.push(
    await measureAsync("anonymous preflight battle", 1_500, async () => {
      const execution = await runFixtureBattle({ preflight: true });
      if (execution.fixture.counter.allowanceReads !== 1) {
        throw new Error("Anonymous preflight did not read allowance exactly once.");
      }
      anonymousCanonical = execution.result.stdout;
    }),
  );
  metrics.push(
    await measureAsync("authenticated preflight battle", 1_500, async () => {
      const execution = await runFixtureBattle({ authenticated: true, preflight: true });
      if (execution.fixture.counter.allowanceReads !== 1) {
        throw new Error("Authenticated preflight did not read allowance exactly once.");
      }
      authenticatedCanonical = execution.result.stdout;
    }),
  );
  if (anonymousCanonical !== authenticatedCanonical) {
    throw new Error("Authentication changed canonical fixture output.");
  }

  const leftFetch = createFixtureFetch(PERSONAS.strongMaintainer);
  const rightFetch = createFixtureFetch(PERSONAS.manyTinyRepos);
  const [leftCollected, rightCollected] = await Promise.all([
    collectProfileSnapshot(PERSONAS.strongMaintainer.login, {
      fetchImpl: leftFetch,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    }),
    collectProfileSnapshot(PERSONAS.manyTinyRepos.login, {
      fetchImpl: rightFetch,
      cache: null,
      now: () => FIXTURE_NOW_MS,
    }),
  ]);
  if (!leftCollected.ok || !rightCollected.ok) throw new Error("Scoring fixtures failed.");
  metrics.push(
    measureSync("result computation", 100, () => {
      buildBattle(
        scoreProfileFastScan(leftCollected.snapshot),
        scoreProfileFastScan(rightCollected.snapshot),
        { roast: "spicy" },
      );
    }),
  );

  const renderedResult = await runBattle({
    left: PERSONAS.strongMaintainer.login,
    right: PERSONAS.manyTinyRepos.login,
    fetchImpl: routedFixture({ calls: 0 }),
    cache: null,
    now: () => FIXTURE_NOW_MS,
  });
  if (!renderedResult.ok) throw new Error("Render fixture failed.");
  metrics.push(
    measureSync("terminal rendering", 100, () => {
      renderBattle(renderedResult.battle, renderedResult.sourceAnalysis, renderedResult.story);
    }),
  );
  metrics.push(
    measureSync("export generation", 150, () => {
      renderBattleExport({
        battle: renderedResult.battle,
        source: renderedResult.sourceAnalysis,
        story: renderedResult.story,
        version: "0.2.2",
        format: "html",
      });
      renderBattleExport({
        battle: renderedResult.battle,
        source: renderedResult.sourceAnalysis,
        story: renderedResult.story,
        version: "0.2.2",
        format: "svg",
      });
    }),
  );

  const cold = metrics.find((metric) => metric.name === "cold fixture battle");
  metrics.push({ ...cold, name: "total first-result wall time" });
  evidence.requests = {
    coldP50: percentile(coldCalls, 0.5),
    snapshotWarmP50: percentile(snapshotCalls, 0.5),
    fullyWarmP50: percentile(warmCalls, 0.5),
    help: helpCalls,
  };
  evidence.authenticationInvariant = true;
  evidence.npxPackageResolution =
    npxPackage === null
      ? { status: "not-run", reason: "informational; pass --include-npx <package-spec>" }
      : (() => {
          const { npmCli } = resolveNpmEntrypoints();
          const metric = measureSync("npx package resolution", 30_000, () => {
            const result = captureNodeCli(
              "npm",
              npmCli,
              ["exec", "--yes", "--package", npxPackage, "--", "gitmog", "--help"],
              { cwd: scratch, env: { ...process.env, GITHUB_TOKEN: "", GH_TOKEN: "" } },
            );
            if (result.code !== 0) throw new Error("npx package-resolution benchmark failed.");
          });
          metrics.push(metric);
          return { status: "measured", package: npxPackage };
        })();

  if (check) {
    const exceeded = metrics.filter((metric) => metric.p95Ms > metric.budgetMs);
    if (exceeded.length > 0) {
      throw new Error(
        `Benchmark budget exceeded: ${exceeded.map((metric) => `${metric.name} ${String(metric.p95Ms)}>${String(metric.budgetMs)}ms`).join(", ")}`,
      );
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "1.0.0-cli-benchmark",
        platform: `${process.platform}-${process.arch}`,
        node: process.version,
        mode: check ? "required-fixture-gate" : "measurement",
        samples,
        metrics,
        evidence,
        liveNetwork: {
          status: "not-run",
          reason: "Live latency is bounded acceptance evidence, not a required CI benchmark.",
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
