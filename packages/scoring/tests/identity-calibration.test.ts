import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  calibrationRow,
  checkCalibration,
  renderCalibrationReport,
  type CalibrationExpectation,
  type CalibrationRow,
} from "../src/identity/calibrate.js";
import type { ProfileScorecard } from "../src/fast-scan/types.js";
import type { AuraClass } from "../src/identity/types.js";

import { PERSONAS, scorecardFor, type PersonaName } from "./helpers.js";

/**
 * Every active Mogsona and every active Aura Leak must be reachable through a fixture
 * (ADR 0008 D5). `alternates` records assignments that would also be defensible, so a
 * threshold nudge does not fail the suite for a still-honest answer.
 */
/** Terse constructor so the expectation table reads as a table. */
const E = (
  fixture: string,
  mogsona: string,
  alternates: readonly string[],
  auraLeak: string | null,
  auraClass: readonly [AuraClass, AuraClass],
  evidenceMetrics: readonly string[],
  minimumConfidence: number,
): CalibrationExpectation => ({
  fixture,
  mogsona,
  alternates,
  auraLeak,
  auraClass,
  evidenceMetrics,
  minimumConfidence,
});

const EXPECTATIONS: readonly CalibrationExpectation[] = [
  E(
    "strongMaintainer",
    "ship_goblin",
    [],
    null,
    ["rare", "mythic"],
    ["ship.breadth.released", "ship.substance.substantialProjects"],
    55,
  ),
  E(
    "releaseHeavy",
    "release_goblin",
    [],
    null,
    ["distinctive", "rare"],
    ["ship.breadth.released"],
    50,
  ),
  E("ciHeavy", "ci_enjoyer", [], "yaml_engineer", ["standard", "rare"], ["craft.tooling.ci"], 40),
  E(
    "testHeavy",
    "test_priest",
    [],
    "release_avoider",
    ["distinctive", "rare"],
    ["craft.testing.exists"],
    50,
  ),
  E(
    "ossContributor",
    "oss_landlord",
    [],
    "release_avoider",
    ["standard", "rare"],
    ["ship.breadth.external"],
    40,
  ),
  E(
    "oneRepoHighImpact",
    "one_repo_final_boss",
    [],
    null,
    ["distinctive", "rare"],
    ["ship.substance.substantialProjects"],
    40,
  ),
  E(
    "oneRepoThin",
    "main_branch_menace",
    ["repo_generalist", "stealth_builder"],
    "single_point_of_aura",
    ["unrated", "distinctive"],
    [],
    0,
  ),
  E(
    "truePolyglot",
    "polyglot_maxxer",
    [],
    "release_avoider",
    ["distinctive", "rare"],
    ["ship.substance.substantialProjects"],
    50,
  ),
  E(
    "manyTinyRepos",
    "stealth_builder",
    ["repo_generalist"],
    "commit_chaos",
    ["unrated", "standard"],
    [],
    0,
  ),
  E(
    "sidequestCollector",
    "one_repo_final_boss",
    ["repo_generalist", "stealth_builder"],
    "sidequest_collector",
    ["standard", "rare"],
    [],
    0,
  ),
  E(
    "repoGraveyard",
    "test_priest",
    ["repo_generalist", "stealth_builder"],
    "repo_graveyard",
    ["unrated", "rare"],
    [],
    0,
  ),
  E(
    "forkCollector",
    "repo_generalist",
    ["stealth_builder"],
    "forklift_operator",
    ["unrated", "distinctive"],
    [],
    0,
  ),
  E(
    "readmeCeo",
    "main_branch_menace",
    ["repo_generalist", "stealth_builder"],
    "readme_ceo",
    ["unrated", "distinctive"],
    [],
    0,
  ),
  E(
    "fixLooper",
    "test_priest",
    ["repo_generalist", "stealth_builder"],
    "fix_loop_enjoyer",
    ["unrated", "rare"],
    [],
    0,
  ),
  E(
    "archiveDiscipline",
    "archive_paladin",
    [],
    "release_avoider",
    ["standard", "rare"],
    ["craft.hygiene.abandonment"],
    40,
  ),
  E(
    "archivedPortfolio",
    "ship_goblin",
    ["archive_paladin", "repo_dad"],
    null,
    ["standard", "rare"],
    [],
    40,
  ),
  E("lowPublicEvidence", "stealth_builder", [], null, ["unrated", "unrated"], [], 0),
  E(
    "balancedBuilder",
    "repo_generalist",
    ["main_branch_menace"],
    null,
    ["standard", "distinctive"],
    [],
    40,
  ),
  E(
    "structureMerchant",
    "structure_merchant",
    [],
    null,
    ["distinctive", "rare"],
    ["craft.hygiene.organization"],
    45,
  ),
  E(
    "highActivityLowImpact",
    "repo_generalist",
    ["stealth_builder"],
    "commit_chaos",
    ["unrated", "standard"],
    [],
    0,
  ),
  E(
    "monorepoOperator",
    "monorepo_maxxer",
    [],
    "localhost_millionaire",
    ["distinctive", "rare"],
    ["craft.hygiene.organization"],
    45,
  ),
  E(
    "frameworkTourist",
    "stealth_builder",
    ["repo_generalist"],
    "framework_tourist",
    ["unrated", "standard"],
    [],
    0,
  ),
  E(
    "sustainedGrinder",
    "sustained_grinder",
    ["structure_merchant"],
    "release_avoider",
    ["distinctive", "rare"],
    ["ship.substance.sustainedWork"],
    45,
  ),
  E(
    "commitGrinder",
    "commit_goblin",
    ["main_branch_menace"],
    "code_hermit",
    ["distinctive", "rare"],
    ["ship.frequency.activeWeeks"],
    40,
  ),
  E(
    "unsupportedLanguages",
    "ci_enjoyer",
    ["test_priest", "ship_goblin", "repo_generalist"],
    "code_hermit",
    ["standard", "rare"],
    [],
    40,
  ),
  E(
    "partialTreeFailure",
    "main_branch_menace",
    ["repo_generalist", "stealth_builder"],
    null,
    ["unrated", "distinctive"],
    [],
    0,
  ),
];

const FIXTURES = EXPECTATIONS.map((entry) => entry.fixture as PersonaName);

const REPORT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/calibration/identity-calibration.txt",
);

async function buildRows(): Promise<{
  readonly rows: readonly CalibrationRow[];
  readonly cards: ReadonlyMap<string, ProfileScorecard>;
}> {
  const cards = new Map<string, ProfileScorecard>();
  const rows: CalibrationRow[] = [];
  for (const fixture of FIXTURES) {
    const card = await scorecardFor(fixture);
    cards.set(fixture, card);
    rows.push(calibrationRow(fixture, card));
  }
  return { rows, cards };
}

describe("identity calibration", () => {
  it("assigns the expected Mogsona and Aura Leak for every fixture", async () => {
    const { rows, cards } = await buildRows();
    const report = renderCalibrationReport(rows);

    // `pnpm identity:calibrate` sets this, reads the artefact back and prints it. The
    // default suite never writes, so `pnpm test` leaves the working tree alone.
    if (process.env["GITMOG_IDENTITY_REPORT"] === "1") {
      mkdirSync(dirname(REPORT_PATH), { recursive: true });
      writeFileSync(REPORT_PATH, `${report}\n`, "utf8");
    }

    const findings = checkCalibration(rows, EXPECTATIONS, cards);
    expect(findings.map((finding) => `${finding.fixture}: ${finding.issue}`)).toEqual([]);
  });

  it("reaches every active Mogsona and Aura Leak through a fixture", async () => {
    const { rows } = await buildRows();
    const assignedMogsonas = new Set(rows.map((row) => row.identity.mogsona.id));
    const assignedLeaks = new Set(
      rows.map((row) => row.identity.auraLeak?.id).filter((id): id is string => id !== undefined),
    );

    const { MOGSONA_DEFINITIONS } = await import("../src/identity/mogsona-catalog.js");
    const { AURA_LEAK_DEFINITIONS } = await import("../src/identity/aura-leak-catalog.js");

    const unreachableMogsonas = MOGSONA_DEFINITIONS.filter(
      (definition) => !assignedMogsonas.has(definition.id),
    ).map((definition) => definition.id);
    const unreachableLeaks = AURA_LEAK_DEFINITIONS.filter(
      (definition) => !assignedLeaks.has(definition.id),
    ).map((definition) => definition.id);

    expect({ unreachableMogsonas, unreachableLeaks }).toEqual({
      unreachableMogsonas: [],
      unreachableLeaks: [],
    });
  });

  it("is stable: the same fixture assigns the same identity twice", async () => {
    const first = await scorecardFor("strongMaintainer");
    const second = await scorecardFor("strongMaintainer");
    expect(JSON.stringify(first.mogsona)).toBe(JSON.stringify(second.mogsona));
    expect(JSON.stringify(first.auraLeak)).toBe(JSON.stringify(second.auraLeak));
  });

  it("names every persona used by the calibration set", () => {
    for (const fixture of FIXTURES) {
      expect(PERSONAS[fixture]).toBeDefined();
    }
  });
});
