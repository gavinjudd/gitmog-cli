#!/usr/bin/env node
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import {
  reconcileBattleRequestAccounting,
  stableQualityResults,
} from "./lib/request-accounting.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(
  readFileSync(resolve(root, "packages/distribution/package.json"), "utf8"),
);
const packageVersion = packageManifest.version;
if (
  typeof packageVersion !== "string" ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(packageVersion)
) {
  throw new Error("The distribution package version is missing or malformed.");
}

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
const summarize = (name, durations, referenceBudgetMs, extra = {}) => ({
  name,
  samples: durations.length,
  p50Ms: rounded(percentile(durations, 0.5)),
  p95Ms: rounded(percentile(durations, 0.95)),
  timing: {
    referenceBudgetMs,
    enforced: false,
    reason: "Hosted-runner timing is informational; deterministic request accounting is gated.",
  },
  ...extra,
});
const measureAsync = async (name, referenceBudgetMs, operation) => {
  const durations = [];
  for (let index = 0; index < samples + warmups; index += 1) {
    const started = performance.now();
    await operation(index);
    const duration = performance.now() - started;
    if (index >= warmups) durations.push(duration);
  }
  return summarize(name, durations, referenceBudgetMs);
};
const measureSync = (name, referenceBudgetMs, operation) => {
  const durations = [];
  for (let index = 0; index < samples + warmups; index += 1) {
    const started = performance.now();
    operation(index);
    const duration = performance.now() - started;
    if (index >= warmups) durations.push(duration);
  }
  return summarize(name, durations, referenceBudgetMs);
};

const counterFor = () => ({ calls: 0, allowanceReads: 0, byUserAgent: {} });
const routedFixture = (counter) => {
  const left = createFixtureFetch(PERSONAS.strongMaintainer);
  const right = createFixtureFetch(PERSONAS.manyTinyRepos);
  return (input, init) => {
    counter.calls += 1;
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    for (const [name, value] of new Headers(init?.headers).entries()) headers.set(name, value);
    const userAgent = headers.get("user-agent") ?? "unclassified";
    counter.byUserAgent[userAgent] = (counter.byUserAgent[userAgent] ?? 0) + 1;
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
  allowanceRemaining = authenticated ? 5_000 : 60,
} = {}) => {
  const counter = counterFor();
  return {
    counter,
    context: {
      invokedAs: "gitmog",
      version: packageVersion,
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
                  remaining: allowanceRemaining,
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
const runFixtureBattle = async ({ arguments: extraArguments = [], ...options } = {}) => {
  const fixture = fixtureContext(options);
  const result = await run(
    ["node", "gitmog", "strongmaintainer", "sidequester", "--json", ...extraArguments],
    fixture.context,
  );
  if (result.exitCode !== 0) throw new Error(`Fixture battle failed: ${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  const accounting = reconcileBattleRequestAccounting({
    payload,
    observedFetches: fixture.counter.calls,
    observedByUserAgent: fixture.counter.byUserAgent,
    allowanceReads: fixture.counter.allowanceReads,
  });
  return { fixture, result, payload, accounting };
};

const metrics = [];
const evidence = { requestScenarios: {} };
const recordScenario = (name, accounting) => {
  const previous = evidence.requestScenarios[name];
  if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(accounting)) {
    throw new Error(`${name} request accounting changed across benchmark samples.`);
  }
  evidence.requestScenarios[name] = accounting;
};
const copyTemplate = (template, name, index) => {
  const directory = join(scratch, `${name}-${String(index)}`);
  cpSync(template, directory, { recursive: true });
  return directory;
};

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
        version: packageVersion,
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

  const baseline = await runFixtureBattle();
  const canonicalBattle = JSON.stringify(baseline.payload.battle);
  const stableQuality = JSON.stringify(stableQualityResults(baseline.payload));
  const assertStableResult = (execution, name) => {
    if (JSON.stringify(execution.payload.battle) !== canonicalBattle) {
      throw new Error(`${name} changed canonical battle bytes.`);
    }
    if (JSON.stringify(stableQualityResults(execution.payload)) !== stableQuality) {
      throw new Error(`${name} changed Quality Preview findings or result identity.`);
    }
  };

  metrics.push(
    await measureAsync("cold quality-enabled battle", 1_500, async () => {
      const execution = await runFixtureBattle();
      assertStableResult(execution, "Cold execution");
      if (execution.accounting.qualityRequests.total <= 0) {
        throw new Error("Cold Quality Preview made no source or attribution requests.");
      }
      recordScenario("cold", execution.accounting);
    }),
  );

  metrics.push(
    await measureAsync("quality-disabled battle", 1_500, async () => {
      const execution = await runFixtureBattle({ arguments: ["--no-quality"] });
      if (JSON.stringify(execution.payload.battle) !== canonicalBattle) {
        throw new Error("Disabling Quality Preview changed canonical battle bytes.");
      }
      if (execution.payload.qualityPreview !== undefined) {
        throw new Error("The disabled Quality Preview remained in public JSON.");
      }
      recordScenario("qualityDisabled", execution.accounting);
    }),
  );

  metrics.push(
    await measureAsync("insufficient quality battle", 1_500, async () => {
      const execution = await runFixtureBattle({
        preflight: true,
        allowanceRemaining: 32,
      });
      if (JSON.stringify(execution.payload.battle) !== canonicalBattle) {
        throw new Error("Insufficient Quality Preview changed canonical battle bytes.");
      }
      const statuses = [
        execution.payload.qualityPreview?.left?.status,
        execution.payload.qualityPreview?.right?.status,
      ];
      if (!statuses.every((status) => status === "insufficient")) {
        throw new Error("The insufficient-quality scenario did not fail closed.");
      }
      if (execution.accounting.qualityRequests.total !== 0) {
        throw new Error("Insufficient Quality Preview made an unplanned request.");
      }
      recordScenario("insufficientQuality", execution.accounting);
    }),
  );

  const snapshotTemplate = join(scratch, "snapshot-template");
  await runFixtureBattle({ cacheDirectory: snapshotTemplate });
  rmSync(join(snapshotTemplate, "analysis"), { recursive: true, force: true });
  rmSync(join(snapshotTemplate, "features"), { recursive: true, force: true });
  rmSync(join(snapshotTemplate, "quality"), { recursive: true, force: true });
  let snapshotRun = 0;
  metrics.push(
    await measureAsync("snapshot-warm battle", 750, async () => {
      const directory = copyTemplate(snapshotTemplate, "snapshot-warm", snapshotRun);
      snapshotRun += 1;
      const execution = await runFixtureBattle({ cacheDirectory: directory });
      assertStableResult(execution, "Snapshot-warm execution");
      if (
        execution.accounting.canonicalRequests.metadata !== 0 ||
        execution.accounting.canonicalRequests.source <= 0 ||
        execution.accounting.qualityRequests.source <= 0
      ) {
        throw new Error("Snapshot-warm request lanes were not reported independently.");
      }
      recordScenario("snapshotWarm", execution.accounting);
      rmSync(directory, { recursive: true, force: true });
    }),
  );

  const canonicalWarmTemplate = join(scratch, "canonical-warm-template");
  await runFixtureBattle({ cacheDirectory: canonicalWarmTemplate });
  rmSync(join(canonicalWarmTemplate, "quality"), { recursive: true, force: true });
  let canonicalWarmRun = 0;
  metrics.push(
    await measureAsync("derived/source-cache-warm battle", 500, async () => {
      const directory = copyTemplate(canonicalWarmTemplate, "canonical-warm", canonicalWarmRun);
      canonicalWarmRun += 1;
      const execution = await runFixtureBattle({ cacheDirectory: directory });
      assertStableResult(execution, "Derived/source-cache-warm execution");
      if (
        execution.accounting.canonicalRequests.total !== 0 ||
        execution.accounting.qualityRequests.source <= 0
      ) {
        throw new Error("Canonical cache hits were conflated with Quality Preview requests.");
      }
      recordScenario("derivedSourceWarm", execution.accounting);
      rmSync(directory, { recursive: true, force: true });
    }),
  );

  const qualityWarmTemplate = join(scratch, "quality-warm-template");
  await runFixtureBattle({ cacheDirectory: qualityWarmTemplate });
  rmSync(join(qualityWarmTemplate, "analysis"), { recursive: true, force: true });
  rmSync(join(qualityWarmTemplate, "features"), { recursive: true, force: true });
  let qualityWarmRun = 0;
  metrics.push(
    await measureAsync("whole-quality-result-cache battle", 750, async () => {
      const directory = copyTemplate(qualityWarmTemplate, "quality-warm", qualityWarmRun);
      qualityWarmRun += 1;
      const execution = await runFixtureBattle({ cacheDirectory: directory });
      assertStableResult(execution, "Whole-quality-result-cache execution");
      if (
        execution.accounting.canonicalRequests.source <= 0 ||
        execution.accounting.qualityRequests.total !== 0 ||
        execution.accounting.cacheHits.wholeResult !== 2
      ) {
        throw new Error("Whole-result cache telemetry was not current-invocation truthful.");
      }
      recordScenario("wholeQualityResultWarm", execution.accounting);
      rmSync(directory, { recursive: true, force: true });
    }),
  );

  const fullyWarmTemplate = join(scratch, "fully-warm-template");
  await runFixtureBattle({ cacheDirectory: fullyWarmTemplate });
  let fullyWarmRun = 0;
  metrics.push(
    await measureAsync("fully-warm battle", 500, async () => {
      const directory = copyTemplate(fullyWarmTemplate, "fully-warm", fullyWarmRun);
      fullyWarmRun += 1;
      const execution = await runFixtureBattle({ cacheDirectory: directory });
      assertStableResult(execution, "Fully-warm execution");
      if (execution.accounting.totalObservedFetches !== 0) {
        throw new Error("Fully-warm fixture battle made an HTTP request.");
      }
      recordScenario("fullyWarm", execution.accounting);
      rmSync(directory, { recursive: true, force: true });
    }),
  );

  let refreshRun = 0;
  metrics.push(
    await measureAsync("refresh battle", 1_500, async () => {
      const directory = copyTemplate(fullyWarmTemplate, "refresh", refreshRun);
      refreshRun += 1;
      const execution = await runFixtureBattle({
        cacheDirectory: directory,
        arguments: ["--refresh"],
      });
      assertStableResult(execution, "Refresh execution");
      if (
        execution.accounting.canonicalRequests.total <= 0 ||
        execution.accounting.qualityRequests.source <= 0 ||
        execution.accounting.cacheHits.wholeResult !== 0
      ) {
        throw new Error("Refresh did not bypass persistent cache reads.");
      }
      recordScenario("refresh", execution.accounting);
      rmSync(directory, { recursive: true, force: true });
    }),
  );

  let noCacheRun = 0;
  metrics.push(
    await measureAsync("no-cache battle", 1_500, async () => {
      const directory = join(scratch, `no-cache-${String(noCacheRun)}`);
      noCacheRun += 1;
      const execution = await runFixtureBattle({
        cacheDirectory: directory,
        arguments: ["--no-cache"],
      });
      assertStableResult(execution, "No-cache execution");
      if (existsSync(directory)) throw new Error("--no-cache wrote persistent state.");
      recordScenario("noCache", execution.accounting);
    }),
  );

  const refreshProofDirectory = copyTemplate(fullyWarmTemplate, "refresh-proof", 0);
  const refreshed = await runFixtureBattle({
    cacheDirectory: refreshProofDirectory,
    arguments: ["--refresh"],
  });
  const afterRefresh = await runFixtureBattle({ cacheDirectory: refreshProofDirectory });
  assertStableResult(refreshed, "Refresh replacement");
  assertStableResult(afterRefresh, "Post-refresh warm execution");
  if (afterRefresh.accounting.totalObservedFetches !== 0) {
    throw new Error("Refresh did not replace reusable stable cache state.");
  }
  evidence.refreshReplacementVerified = true;

  const anonymous = await runFixtureBattle({ preflight: true });
  const authenticated = await runFixtureBattle({ authenticated: true, preflight: true });
  if (anonymous.accounting.allowanceReads !== 1 || authenticated.accounting.allowanceReads !== 1) {
    throw new Error("Preflight allowance reads were not counted exactly once.");
  }
  if (
    JSON.stringify(anonymous.payload.battle) !== canonicalBattle ||
    JSON.stringify(authenticated.payload.battle) !== canonicalBattle
  ) {
    throw new Error("Authentication changed canonical fixture output.");
  }
  evidence.preflight = {
    anonymous: anonymous.accounting,
    authenticated: authenticated.accounting,
  };
  evidence.authenticationCanonicalInvariant = true;

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
    fetchImpl: routedFixture(counterFor()),
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
        version: packageVersion,
        format: "html",
      });
      renderBattleExport({
        battle: renderedResult.battle,
        source: renderedResult.sourceAnalysis,
        story: renderedResult.story,
        version: packageVersion,
        format: "svg",
      });
    }),
  );

  evidence.helpFetches = helpCalls;
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

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "2.0.0-cli-request-accounting",
        packageVersion,
        platform: `${process.platform}-${process.arch}`,
        node: process.version,
        mode: check ? "required-request-accounting-gate" : "measurement",
        samples,
        metrics,
        evidence,
        timingGate: {
          enforced: false,
          reason: "Wall-clock p50/p95 values are recorded without gating hosted-runner variance.",
        },
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
