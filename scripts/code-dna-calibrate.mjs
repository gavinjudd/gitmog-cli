import { captureNodeCli, resolveWorkspacePnpmCli } from "./lib/package-manager.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.some((arg) => arg !== "--json")) {
  process.stderr.write("Usage: node scripts/code-dna-calibrate.mjs [--json]\n");
  process.exit(2);
}
const asJson = args.includes("--json");

let pnpmCli;
try {
  pnpmCli = resolveWorkspacePnpmCli();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}

const built = captureNodeCli("pnpm", pnpmCli, ["--filter", "@gitmog/personality...", "build"], {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
});
if (built.code !== 0) {
  process.stderr.write(built.stdout ?? "");
  process.stderr.write(built.stderr ?? "");
  process.exit(built.code);
}

const { AXIS_FORMULAS, CODE_AXIS_ENGINE_VERSION, CODE_AXIS_IDS, CODE_DNA_IDS } =
  await import("../packages/personality/dist/index.js");
const { runDeterministicCalibration } = await import("../packages/personality/dist/calibration.js");

const results = runDeterministicCalibration();
const reached = [
  ...new Set(
    results.flatMap((result) =>
      result.labelCandidates
        .filter((candidate) => candidate.eligible)
        .map((candidate) => candidate.id),
    ),
  ),
].sort();
const report = {
  axisEngineVersion: CODE_AXIS_ENGINE_VERSION,
  formulas: Object.fromEntries(
    CODE_AXIS_IDS.map((id) => [
      id,
      {
        baseline: AXIS_FORMULAS[id].baseline,
        terms: AXIS_FORMULAS[id].terms,
      },
    ]),
  ),
  fixtures: results.map((result) => ({
    id: result.fixture,
    pass: result.valid,
    confidence: result.confidence,
    identity: result.derivedLabelId ?? "INCONCLUSIVE",
    axes: Object.fromEntries(
      CODE_AXIS_IDS.map((id) => [
        id,
        {
          score: result.axes?.[id].score ?? null,
          confidence: result.axes?.[id].confidence ?? null,
        },
      ]),
    ),
    checks: {
      axes: result.axesInBand,
      confidence: result.confidencePass,
      identity: result.identityPass,
      incompatibility: result.incompatibilityPass,
      features: result.featureSupportPass,
      coverage: result.coveragePass,
      receipts: result.labelCoherent,
    },
  })),
  reachedIdentities: reached,
  missingIdentities: CODE_DNA_IDS.filter((id) => !reached.includes(id)),
  passed:
    results.every((result) => result.valid) && CODE_DNA_IDS.every((id) => reached.includes(id)),
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const pad = (value, width) =>
    value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
  process.stdout.write(`GIT MOG — DETERMINISTIC CODE DNA CALIBRATION\n\n`);
  process.stdout.write(`Axis engine: ${report.axisEngineVersion}\n`);
  process.stdout.write("External prose calls: 0\n\n");
  process.stdout.write(
    `${pad("FIXTURE", 28)}${pad("CONF", 7)}${pad("IDENTITY", 24)}AXES score/conf\n`,
  );
  process.stdout.write(`${"-".repeat(110)}\n`);
  for (const entry of report.fixtures) {
    const axes = CODE_AXIS_IDS.map(
      (id) => `${id}=${String(entry.axes[id].score)}/${String(entry.axes[id].confidence)}`,
    ).join(" ");
    process.stdout.write(
      `${pad(entry.id, 28)}${pad(String(entry.confidence), 7)}${pad(entry.identity, 24)}${axes} ${entry.pass ? "PASS" : "FAIL"}\n`,
    );
  }
  process.stdout.write(
    `\nFixtures: ${String(report.fixtures.filter((entry) => entry.pass).length)}/${String(report.fixtures.length)} PASS\n`,
  );
  process.stdout.write(
    `Identity reachability: ${String(reached.length)}/${String(CODE_DNA_IDS.length)}\n`,
  );
  process.stdout.write(`Result: ${report.passed ? "PASS" : "FAIL"}\n`);
}

if (!report.passed) process.exitCode = 1;
