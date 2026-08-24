/**
 * A minimal battle payload shaped like the API response. The CLI and the shared
 * components are rendering clients of that schema, so their tests need the shape, not
 * a real scan.
 *
 * The return type is inferred rather than imported: this package must not depend on
 * `@gitmog/scoring`, which would close a dependency cycle through `@gitmog/github`.
 * Every consumer annotates the result as `BattleResult`, so schema drift still fails
 * the type check — at the call site, which is where it matters.
 */
const line = (text: string, templateId: string) => ({
  text,
  templateId,
  atomId: "tests_gap",
  evidenceIds: ["craft.testing.exists:ratio"],
});

const evidence = (username: string) => [
  {
    id: "craft.testing.exists:ratio",
    category: "craft.testing",
    metric: "craft.testing.exists",
    polarity: "positive" as const,
    title: `${username} tests 3 of 3 inspected repositories`,
    detail: "At least three test files in each inspected tree.",
    value: "3/3",
    sourceUrl: `https://github.com/${username}`,
  },
  {
    id: "craft.hygiene.abandonment:count",
    category: "craft.hygiene",
    metric: "craft.hygiene.abandonment",
    polarity: "negative" as const,
    title: `${username} has 2 abandoned substantial projects`,
    detail: "Substantial, original, not archived, untouched for a year.",
    value: 2,
    sourceUrl: `https://github.com/${username}?tab=repositories`,
  },
];

const category = (id: string, memeLabel: string, score: number) => ({
  id,
  dimension: id.startsWith("ship") ? ("ship" as const) : ("craft" as const),
  memeLabel,
  subtitle: "Tests, test breadth, tests wired into CI",
  scorecardSection: "CRAFT B — Testing",
  weight: 10,
  measuredWeight: 8,
  earned: (score / 100) * 8,
  score,
  metrics: [],
});

const card = (username: string, overallScore: number, grade: string) => ({
  username,
  displayName: username,
  avatarUrl: `https://avatars.githubusercontent.com/u/1?v=4`,
  profileUrl: `https://github.com/${username}`,
  scoringVersion: "0.1.0-fast-scan",
  scanType: "fast" as const,
  overallScore,
  grade,
  categoryScores: { "craft.testing": 80, "ship.frequency": 60 },
  categories: [
    category("craft.testing", "CODE AURA", 80),
    category("ship.frequency", "GRINDSET", 60),
  ],
  metrics: [],
  confidence: {
    grade: "good" as const,
    score: 70,
    summary: "Good — public score evidence, 3 of 4 eligible repositories inspected.",
    analyzedRepositories: 3,
    eligibleRepositories: 4,
    totalRepositories: 6,
    treeCoverage: 1,
    measuredWeight: 52,
    limitations: [
      "Public score: 52 of the scorecard's 100 points were measurable. Code DNA is versioned separately.",
    ],
  },
  evidence: evidence(username),
  positiveEvidence: evidence(username).slice(0, 1),
  negativeEvidence: evidence(username).slice(1, 2),
  diagnostics: {
    publicRepositories: 6,
    eligibleRepositories: 4,
    substantialRepositories: 3,
    archivedRepositories: 1,
    forkedRepositories: 2,
    abandonedSubstantialRepositories: 2,
    repositoriesWithoutTests: 0,
    repositoriesWithoutCi: 1,
    repositoriesInspected: 3,
    observedPushes: 40,
    commitSampleSize: 60,
    annualizedCommitEstimate: 160,
    activeWeeksObserved: 9,
    activeWeeksWindow: 12,
    daysSinceLastPublicPush: 2,
    medianCommitMessageLength: 38,
    lowEffortCommitMessageRate: 0.05,
    repairCommitRate: 0.1,
    revertRate: 0,
    externalRepositoriesTouched: 2,
    mergedPullRequests: 2,
    releaseCount: 9,
    largestSourceFileBytes: 42_000,
    languagesObserved: ["TypeScript"],
    unsupportedLanguages: [],
    monorepoRepositories: 0,
    releaseRepositories: 2,
    sustainedRepositories: 2,
    substantialLanguages: ["TypeScript"],
    dominantRepositoryShare: 0.55,
  },
  mogsona: {
    version: "1.0.0-mogsona",
    id: "ship_goblin",
    name: "SHIP GOBLIN",
    auraClass: "distinctive" as const,
    signalScore: 82,
    confidence: 70,
    summary: "Turns public work into maintained, released software.",
    evidenceIds: ["craft.testing.exists:ratio"],
    qualifyingSignals: ["9 published releases across 2 inspected projects"],
  },
  auraLeak:
    username === "bob"
      ? {
          version: "1.0.0-aura-leak",
          id: "repo_graveyard",
          name: "REPO GRAVEYARD",
          severity: "critical" as const,
          evidenceIds: ["craft.hygiene.abandonment:count"],
          qualifyingSignals: ["2 abandoned substantial projects"],
        }
      : null,
  snapshotKey: `snapshot-${username}`,
  referenceDate: "2026-08-13",
});

export function battleFixture() {
  const left = card("alice", 78, "A−");
  const right = card("bob", 64, "B");
  return {
    battleKey: "fixture-battle-key",
    battlePath: "/battle/alice-vs-bob",
    scoringVersion: "0.1.0-fast-scan",
    presentationVersion: "1.0.0-mogsona+1.0.0-aura-leak+1.0.0-narrative",
    mogsonaVersion: "1.0.0-mogsona",
    auraLeakVersion: "1.0.0-aura-leak",
    memeEngineVersion: "1.0.0-narrative",
    scanType: "fast" as const,
    roast: "spicy" as const,
    left,
    right,
    winner: "left" as const,
    margin: 14,
    verdictClass: "clean-mog" as const,
    verdictLabel: "CLEAN MOG",
    headline: "ALICE MOGS BOB",
    rounds: [
      {
        categoryId: "craft.testing",
        memeLabel: "TEST AURA",
        subtitle: "Tests, test breadth, tests wired into CI",
        leftScore: 80,
        rightScore: 30,
        leftEarned: 6.4,
        rightEarned: 2.4,
        winner: "left" as const,
        margin: 50,
        line: line("alice brought tests. bob brought confidence.", "fin.tests.confidence"),
        leftEvidenceId: "craft.testing.exists:ratio",
        rightEvidenceId: null,
      },
    ],
    narrative: {
      version: "1.0.0-narrative",
      themeId: "shipping",
      dominantAtomId: "release_gap",
      supportingAtomIds: ["tests_gap"],
      matchupLine: line("One side has releases. The other has lore.", "mat.ship.lore"),
    },
    identity: {
      left: {
        mogsonaLine: line(
          "Ships first. Explains the sleep schedule later.",
          "mogsona.ship_goblin.spicy",
        ),
        auraLeakLine: null,
      },
      right: {
        mogsonaLine: line(
          "Ships first. Explains the sleep schedule later.",
          "mogsona.ship_goblin.spicy",
        ),
        auraLeakLine: line(
          "This repo graveyard has zoning permits.",
          "auraLeak.repo_graveyard.spicy",
        ),
      },
    },
    finishingMove: line("alice ships versions. bob ships intentions.", "fin.release.intentions"),
    battleSummary: [line("52 of 100 scorecard points were measurable.", "sum.basis")],
    strengths: {
      left: line("100% of the inspected work is tested.", "str.tests"),
      right: line("Keeps 3 substantial projects current.", "str.maintenance"),
    },
    weaknesses: {
      left: null,
      right: line("2 abandoned side quests sitting in the repo graveyard.", "wk.abandoned"),
    },
    shareCaption: "alice mogged bob 78–64 on GitHub.",
    cardFinisher: "alice ships versions. bob ships intentions.",
    challenge: {
      canonical: "npx -y gitmog alice bob",
      runItBack: "npx -y gitmog bob alice",
      nextVictim: "npx -y gitmog alice <handle>",
      shareReceipt: "npx -y gitmog alice bob --share x",
    },
    evidenceDiff: null,
    createdFromSnapshotKeys: ["snapshot-alice", "snapshot-bob"] as [string, string],
  };
}
