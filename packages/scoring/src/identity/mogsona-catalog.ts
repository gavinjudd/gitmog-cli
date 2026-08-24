import { inverseRamp, leads, ramp, weighted } from "./signals.js";
import type { IdentitySignals, MogsonaDefinition } from "./types.js";

/**
 * The Mogsona catalog.
 *
 * Every definition here is positive or neutral, declares the metrics it needs, and
 * names the evidence that justifies it (ADR 0008 D4). A definition with no reachable
 * calibration fixture fails `pnpm test`, which is what stops the catalog from growing
 * labels nothing can trigger.
 *
 * Broad identities (`ship_goblin`, `repo_dad`, `repo_generalist`) read many dimensions
 * and need no lead. Specialist identities require their own dimension to exceed the
 * profile's measured baseline, so a uniformly strong profile does not collect every
 * specialist label at once (ADR 0008 D5).
 *
 * No signal function reads a star, a fork or a follower count. There is no field in
 * `IdentitySignals` that carries one.
 */

const define = (definition: MogsonaDefinition): MogsonaDefinition => definition;

const never = (): boolean => false;

/** Fast-scan confidence is capped at 70 (ADR 0004 D8), so these sit near the ceiling. */
const CONFIDENCE_SPECIALIST = 44;
const CONFIDENCE_BROAD = 40;
const CONFIDENCE_FALLBACK = 0;

const LEAD = 0.08;

const recencyDays = (signals: IdentitySignals): number => signals.daysSinceLastPush ?? 3_650;

const cadence = (signals: IdentitySignals): number =>
  ramp(signals.activeWeeksObserved, 3, Math.max(6, signals.activeWeeksWindow - 1));

const verificationStack = (signals: IdentitySignals): number =>
  weighted([
    [2, signals.testsExist],
    [1, signals.testBreadth],
    [2, signals.testWorkflow],
  ]);

const toolingStack = (signals: IdentitySignals): number =>
  weighted([
    [2, signals.ci],
    [1, signals.lint],
    [1, signals.typing],
    [1, signals.build],
    [1, signals.automation],
  ]);

export const MOGSONA_DEFINITIONS: readonly MogsonaDefinition[] = Object.freeze([
  define({
    id: "ship_goblin",
    name: "SHIP GOBLIN",
    motif: "shipping-gap",
    polarity: "positive",
    requiredMetrics: ["ship.breadth.released", "ship.substance.substantialProjects"],
    evidenceMetrics: [
      "ship.breadth.released",
      "ship.substance.substantialProjects",
      "ship.substance.sustainedWork",
      "ship.frequency.recency",
    ],
    minimumEvidence: 2,
    minimumSignal: 0.55,
    minimumConfidence: CONFIDENCE_BROAD,
    specificity: 1.0,
    maximumClass: "mythic",
    mythicGate: (s) =>
      s.releaseCount >= 12 &&
      s.releaseRepositoryCount >= 3 &&
      s.substantialCount >= 4 &&
      s.sustainedCount >= 3 &&
      recencyDays(s) <= 21,
    blocks: (s) => s.releaseCount < 3 || s.substantialCount < 2 || recencyDays(s) > 120,
    signal: (s) =>
      weighted([
        [3, ramp(s.releaseCount, 2, 14)],
        [2, ramp(s.substantialCount, 2, 5)],
        [2, s.recency],
        [2, ramp(s.sustainedCount, 1, 4)],
        [1, s.released],
      ]),
    qualifying: (s) => [
      `${String(s.releaseCount)} published releases across ${String(s.releaseRepositoryCount)} inspected projects`,
      `${String(s.substantialCount)} substantial original projects`,
      `last public push ${String(Math.round(recencyDays(s)))} days ago`,
    ],
    summary: "Turns public work into maintained, released software.",
    copy: {
      clean: "Consistently turns public work into maintained releases.",
      spicy: "Ships first. Explains the sleep schedule later.",
      unhinged: "The releases tab has seen more action than most roadmaps.",
    },
  }),

  define({
    id: "release_goblin",
    name: "RELEASE GOBLIN",
    motif: "release-cadence",
    polarity: "positive",
    requiredMetrics: ["ship.breadth.released"],
    evidenceMetrics: ["ship.breadth.released", "craft.hygiene.releases"],
    minimumEvidence: 2,
    minimumSignal: 0.5,
    minimumConfidence: CONFIDENCE_SPECIALIST,
    specificity: 0.95,
    maximumClass: "rare",
    mythicGate: never,
    blocks: (s) => s.releaseRepositoryCount < 2 || s.releaseCount < 6 || s.inspectedCount < 2,
    signal: (s) =>
      weighted([
        [3, ramp(s.releaseCount, 5, 26)],
        [2, ramp(s.releaseDensity, 1, 6)],
        [2, ramp(s.releaseRepositoryCount, 1, 3)],
        [1, s.releaseHygiene],
      ]),
    qualifying: (s) => [
      `${String(s.releaseCount)} releases, ${s.releaseDensity.toFixed(1)} per substantial project`,
      `releases on ${String(s.releaseRepositoryCount)} inspected repositories`,
    ],
    summary: "Version numbers arrive on a schedule other people can plan around.",
    copy: {
      clean: "Publishes versioned releases across more than one project.",
      spicy: "Tags releases like it costs nothing. It does not.",
      unhinged: "Somewhere a changelog is being maintained voluntarily.",
    },
  }),

  define({
    id: "ci_enjoyer",
    name: "CI ENJOYER",
    motif: "ci-robots",
    polarity: "positive",
    requiredMetrics: ["craft.tooling.ci"],
    evidenceMetrics: ["craft.tooling.ci", "craft.tooling.automation", "craft.testing.workflow"],
    minimumEvidence: 2,
    minimumSignal: 0.6,
    minimumConfidence: CONFIDENCE_SPECIALIST,
    specificity: 0.78,
    maximumClass: "rare",
    mythicGate: never,
    blocks: (s) =>
      s.ciCount < 2 ||
      s.inspectedCount < 2 ||
      (s.ci ?? 0) < 0.6 ||
      !leads(toolingStack(s), s, LEAD),
    signal: (s) =>
      weighted([
        [3, s.ci],
        [2, ramp(s.ciCount, 1, 3)],
        [2, toolingStack(s)],
        [1, s.automation],
      ]),
    qualifying: (s) => [
      `CI configured in ${String(s.ciCount)} of ${String(s.inspectedCount)} inspected repositories`,
      "linting, typing, build and automation coverage above this profile's own baseline",
    ],
    summary: "Refuses to merge anything a machine has not checked first.",
    copy: {
      clean: "Continuous integration is configured across the inspected work.",
      spicy: "The robots are on payroll here.",
      unhinged: "Will not merge until a machine has finished shouting.",
    },
  }),

  define({
    id: "test_priest",
    name: "TEST PRIEST",
    motif: "verification-stack",
    polarity: "positive",
    requiredMetrics: ["craft.testing.exists"],
    evidenceMetrics: [
      "craft.testing.exists",
      "craft.testing.breadth",
      "craft.testing.workflow",
      "craft.tooling.ci",
    ],
    minimumEvidence: 2,
    minimumSignal: 0.6,
    minimumConfidence: CONFIDENCE_SPECIALIST,
    specificity: 0.82,
    maximumClass: "rare",
    mythicGate: never,
    blocks: (s) =>
      s.testedCount < 2 ||
      s.inspectedCount < 2 ||
      (s.testsExist ?? 0) < 0.6 ||
      ((s.testWorkflow ?? 0) < 0.5 && (s.ci ?? 0) < 0.5) ||
      !leads(verificationStack(s), s, LEAD),
    signal: (s) =>
      weighted([
        [3, s.testsExist],
        [2, s.testBreadth],
        [2, s.testWorkflow],
        [1, s.ci],
      ]),
    qualifying: (s) => [
      `tests in ${String(s.testedCount)} of ${String(s.inspectedCount)} inspected repositories`,
      "tests paired with continuous integration in the same trees",
    ],
    summary: "Verification is a habit rather than an afterthought.",
    copy: {
      clean: "Tests exist across the inspected work and run under CI.",
      spicy: "Writes tests voluntarily. Unprompted. For fun.",
      unhinged: "Has a test suite and is not afraid to run it in public.",
    },
  }),

  define({
    id: "oss_landlord",
    name: "OSS LANDLORD",
    motif: "other-peoples-repos",
    polarity: "positive",
    requiredMetrics: ["ship.breadth.external"],
    evidenceMetrics: [
      "ship.breadth.external",
      "ship.breadth.continuity",
      "ship.substance.substantialProjects",
    ],
    minimumEvidence: 2,
    minimumSignal: 0.5,
    minimumConfidence: CONFIDENCE_SPECIALIST,
    specificity: 0.91,
    maximumClass: "rare",
    mythicGate: never,
    blocks: (s) =>
      s.externalRepositoryCount < 2 ||
      s.mergedPullRequests < 1 ||
      s.substantialCount < 1 ||
      !leads(s.externalWork, s, LEAD),
    signal: (s) =>
      weighted([
        [3, ramp(s.externalRepositoryCount, 1, 6)],
        [2, ramp(s.mergedPullRequests, 1, 6)],
        [2, s.externalWork],
        [1, s.continuity],
      ]),
    qualifying: (s) => [
      `${String(s.externalRepositoryCount)} repositories touched outside their own account`,
      `${String(s.mergedPullRequests)} merged public pull requests observed`,
    ],
    summary: "Owns projects and still shows up in other people's repositories.",
    copy: {
      clean: "Contributes across repositories they do not own while maintaining their own.",
      spicy: "Owns property and still fixes other people's plumbing.",
      unhinged: "Genuinely dangerous in a codebase that is not theirs.",
    },
  }),

  define({
    id: "repo_dad",
    name: "REPO DAD",
    motif: "lights-still-on",
    polarity: "positive",
    requiredMetrics: ["ship.breadth.continuity", "craft.hygiene.documentation"],
    evidenceMetrics: [
      "ship.breadth.continuity",
      "craft.hygiene.documentation",
      "craft.hygiene.abandonment",
      "craft.hygiene.dependencies",
      "craft.hygiene.organization",
    ],
    minimumEvidence: 2,
    minimumSignal: 0.6,
    minimumConfidence: CONFIDENCE_BROAD,
    specificity: 0.96,
    maximumClass: "rare",
    mythicGate: never,
    // Release hygiene is part of repository hygiene: a maintainer who never ships a
    // version of anything intended for distribution is README CEO, not REPO DAD.
    blocks: (s) =>
      s.substantialCount < 3 ||
      (s.continuity ?? 0) < 0.8 ||
      (s.documentation ?? 0) < 0.7 ||
      (s.releaseHygiene ?? 0) < 0.34 ||
      s.abandonedCount > 1,
    signal: (s) =>
      weighted([
        [3, s.continuity],
        [2, s.documentation],
        [2, s.abandonment],
        [1, s.dependencies],
        [1, s.organization],
        [1, inverseRamp(s.abandonmentDensity, 0, 0.4)],
      ]),
    qualifying: (s) => [
      `${String(s.substantialCount)} substantial projects, ${String(s.abandonedCount)} abandoned`,
      "documentation, dependency and layout hygiene all measured positive",
    ],
    summary: "Keeps the projects alive and the documentation honest.",
    copy: {
      clean: "Maintains what they publish and documents it for other people.",
      spicy: "The repository has adult supervision.",
      unhinged: "Every project here has a bedtime and a README.",
    },
  }),

  define({
    id: "one_repo_final_boss",
    name: "ONE-REPO FINAL BOSS",
    motif: "one-repo-carry",
    polarity: "positive",
    requiredMetrics: ["ship.substance.substantialProjects"],
    evidenceMetrics: [
      "ship.substance.substantialProjects",
      "ship.substance.sustainedWork",
      "ship.breadth.released",
    ],
    minimumEvidence: 2,
    minimumSignal: 0.55,
    minimumConfidence: CONFIDENCE_SPECIALIST,
    specificity: 0.92,
    maximumClass: "rare",
    mythicGate: never,
    // The gate is on the repository being strong, never on the rest of the profile
    // being empty: a thin profile with one thin repository is STEALTH BUILDER.
    blocks: (s) =>
      s.substantialCount > 2 ||
      s.dominantRepositoryShare < 0.7 ||
      s.inspectedCount < 1 ||
      (s.sustainedWork ?? 0) < 0.4 ||
      (s.releaseCount < 2 && (s.testsExist ?? 0) < 0.6),
    signal: (s) =>
      weighted([
        [3, ramp(s.dominantRepositoryShare, 0.7, 0.97)],
        [2, s.sustainedWork],
        [2, ramp(s.releaseCount, 1, 12)],
        [1, verificationStack(s)],
        [1, s.recency],
      ]),
    qualifying: (s) => [
      `one repository carries ${String(Math.round(s.dominantRepositoryShare * 100))}% of the substantial public bytes`,
      `that project sustains work and publishes ${String(s.releaseCount)} releases`,
    ],
    summary: "One project, carried properly. Depth instead of breadth.",
    copy: {
      clean: "One substantial project, maintained with real care.",
      spicy: "One repo. It is load-bearing and it holds.",
      unhinged: "The entire bloodline is one repository and it never misses.",
    },
  }),

  define({
    id: "polyglot_maxxer",
    name: "POLYGLOT MAXXER",
    motif: "polyglot",
    polarity: "positive",
    requiredMetrics: ["ship.substance.substantialProjects"],
    evidenceMetrics: ["ship.substance.substantialProjects", "ship.substance.sustainedWork"],
    minimumEvidence: 2,
    minimumSignal: 0.55,
    minimumConfidence: CONFIDENCE_SPECIALIST,
    specificity: 0.93,
    maximumClass: "rare",
    mythicGate: never,
    // Breadth must appear across substantial repositories. A pile of tiny tutorial
    // repositories in four languages is FRAMEWORK TOURIST, not this.
    blocks: (s) =>
      s.substantialLanguageCount < 4 || s.substantialCount < 3 || s.substantialRatio < 0.4,
    signal: (s) =>
      weighted([
        [3, ramp(s.substantialLanguageCount, 2, 4)],
        [3, s.substantialProjects],
        [2, s.sustainedWork],
        [1, ramp(s.substantialCount, 2, 6)],
      ]),
    qualifying: (s) => [
      `${String(s.substantialLanguageCount)} languages observed across substantial projects`,
      `${String(s.substantialCount)} substantial projects, ${String(Math.round(s.substantialRatio * 100))}% of eligible repositories`,
    ],
    summary: "Real projects in several languages, not tutorials in several languages.",
    copy: {
      clean: "Works across several languages at genuine project scale.",
      spicy: "Polyglot maxxing at real project scale.",
      unhinged: "Refuses to be pinned to one ecosystem or one package manager.",
    },
  }),

  define({
    id: "commit_goblin",
    name: "COMMIT GOBLIN",
    motif: "active-weeks",
    polarity: "positive",
    requiredMetrics: ["ship.frequency.activeWeeks", "ship.frequency.commits"],
    evidenceMetrics: [
      "ship.frequency.activeWeeks",
      "ship.frequency.commits",
      "ship.frequency.recency",
    ],
    minimumEvidence: 2,
    minimumSignal: 0.6,
    minimumConfidence: CONFIDENCE_SPECIALIST,
    specificity: 0.76,
    maximumClass: "rare",
    mythicGate: never,
    // Cadence only counts when the commits are legible. Spam is COMMIT CHAOS.
    blocks: (s) =>
      s.annualizedCommits < 120 ||
      s.activeWeeksObserved < Math.ceil(s.activeWeeksWindow * 0.6) ||
      (s.commitSampleSize > 0 && s.lowEffortRate > 0.2) ||
      s.substantialCount < 1 ||
      !leads(
        weighted([
          [2, s.commits],
          [2, cadence(s)],
          [1, s.recency],
        ]),
        s,
        LEAD,
      ),
    signal: (s) =>
      weighted([
        [3, s.commits],
        [3, cadence(s)],
        [2, s.recency],
        [1, s.substantialProjects],
      ]),
    qualifying: (s) => [
      `active in ${String(s.activeWeeksObserved)} of the last ${String(s.activeWeeksWindow)} weeks`,
      `an estimated ${String(Math.round(s.annualizedCommits))} qualifying commits a year`,
    ],
    summary: "Public development cadence that does not let up.",
    copy: {
      clean: "Sustained public development week after week.",
      spicy: "Logs on. Stays on. The graph is fully green.",
      unhinged: "The contribution graph is a wall and it is load-bearing.",
    },
  }),

  define({
    id: "main_branch_menace",
    name: "MAIN-BRANCH MENACE",
    motif: "main-branch",
    polarity: "positive",
    requiredMetrics: ["ship.discipline.messages", "ship.frequency.recency"],
    evidenceMetrics: [
      "ship.discipline.messages",
      "ship.discipline.repairLoops",
      "ship.discipline.mergeHygiene",
      "ship.frequency.recency",
    ],
    minimumEvidence: 2,
    minimumSignal: 0.6,
    minimumConfidence: CONFIDENCE_SPECIALIST,
    specificity: 0.68,
    maximumClass: "rare",
    mythicGate: never,
    blocks: (s) =>
      recencyDays(s) > 30 ||
      s.repairRate > 0.15 ||
      s.revertRate > 0.04 ||
      s.lowEffortRate > 0.12 ||
      s.substantialCount < 1 ||
      !leads(
        weighted([
          [2, s.commitMessages],
          [2, s.repairLoops],
          [1, s.mergeHygiene],
        ]),
        s,
        LEAD,
      ),
    signal: (s) =>
      weighted([
        [3, s.commitMessages],
        [2, s.repairLoops],
        [2, s.mergeHygiene],
        [2, s.recency],
        [1, ramp(s.sustainedCount, 1, 4)],
      ]),
    qualifying: (s) => [
      `${String(Math.round(s.lowEffortRate * 100))}% low-effort commit messages in the sample`,
      `${String(Math.round(s.repairRate * 100))}% repair commits and ${String(Math.round(s.revertRate * 100))}% reverts`,
    ],
    summary: "Recent, legible history with almost no repair traffic.",
    copy: {
      clean: "Recent work with clean, readable commit history.",
      spicy: "Main branch witnessed everything and has no notes.",
      unhinged: "Walks into main, commits, leaves. No cleanup crew required.",
    },
  }),

  define({
    id: "monorepo_maxxer",
    name: "MONOREPO MAXXER",
    motif: "workspace",
    polarity: "positive",
    requiredMetrics: ["craft.hygiene.organization"],
    evidenceMetrics: [
      "craft.hygiene.organization",
      "craft.tooling.build",
      "craft.tooling.automation",
    ],
    minimumEvidence: 2,
    minimumSignal: 0.6,
    minimumConfidence: CONFIDENCE_SPECIALIST,
    specificity: 0.89,
    maximumClass: "rare",
    mythicGate: never,
    blocks: (s) => s.monorepoCount < 1 || (s.organization ?? 0) < 0.6 || s.substantialCount < 1,
    signal: (s) =>
      weighted([
        [3, ramp(s.monorepoCount, 0, 2)],
        [2, s.organization],
        [2, toolingStack(s)],
        [1, s.build],
      ]),
    qualifying: (s) => [
      `${String(s.monorepoCount)} inspected repositories carry a workspace layout`,
      `repository layout scores ${String(Math.round((s.organization ?? 0) * 100))}%`,
    ],
    summary: "Runs a workspace, not a folder.",
    copy: {
      clean: "Organises work as a maintained workspace with shared tooling.",
      spicy: "Runs a monorepo like an operating system.",
      unhinged: "Has opinions about workspace protocols and will share them.",
    },
  }),

  define({
    id: "archive_paladin",
    name: "ARCHIVE PALADIN",
    motif: "archive-honours",
    polarity: "positive",
    requiredMetrics: ["craft.hygiene.abandonment"],
    evidenceMetrics: ["craft.hygiene.abandonment", "ship.breadth.continuity"],
    minimumEvidence: 2,
    minimumSignal: 0.5,
    minimumConfidence: CONFIDENCE_SPECIALIST,
    specificity: 0.9,
    maximumClass: "rare",
    mythicGate: never,
    blocks: (s) =>
      s.archivedCount < 3 ||
      s.abandonedCount > 1 ||
      s.abandonmentDensity > 0.34 ||
      (s.continuity ?? 0) < 0.6,
    signal: (s) =>
      weighted([
        [3, ramp(s.archivedCount, 2, 5)],
        [2, s.abandonment],
        [2, inverseRamp(s.abandonmentDensity, 0, 0.34)],
        [2, s.continuity],
        [1, s.recency],
      ]),
    qualifying: (s) => [
      `${String(s.archivedCount)} projects deliberately archived as finished`,
      `${String(s.abandonedCount)} abandoned substantial projects`,
    ],
    summary: "Finishes things, then says so by archiving them.",
    copy: {
      clean: "Archives finished projects instead of leaving them to rot.",
      spicy: "Knows when something is done. Archive discipline confirmed.",
      unhinged: "Buries projects with full honours instead of ghosting them.",
    },
  }),

  define({
    id: "sustained_grinder",
    name: "SUSTAINED GRINDER",
    motif: "marathon",
    polarity: "positive",
    requiredMetrics: ["ship.substance.sustainedWork", "ship.breadth.continuity"],
    evidenceMetrics: [
      "ship.substance.sustainedWork",
      "ship.breadth.continuity",
      "ship.frequency.activeWeeks",
    ],
    minimumEvidence: 2,
    minimumSignal: 0.6,
    minimumConfidence: CONFIDENCE_SPECIALIST,
    specificity: 0.8,
    maximumClass: "rare",
    mythicGate: never,
    // Longevity alone is not engineering: `SCORECARD.md` SHIP B lets an old repository
    // with one recent push clear the substantiality bar, so this needs some tooling
    // behind the lifespan or a documentation-only profile qualifies as a grinder.
    blocks: (s) =>
      s.sustainedCount < 3 ||
      (s.sustainedWork ?? 0) < 0.7 ||
      (s.continuity ?? 0) < 0.7 ||
      toolingStack(s) < 0.4 ||
      s.activeWeeksObserved < Math.ceil(s.activeWeeksWindow * 0.4) ||
      !leads(
        weighted([
          [2, s.sustainedWork],
          [2, s.continuity],
          [1, cadence(s)],
        ]),
        s,
        LEAD,
      ),
    signal: (s) =>
      weighted([
        [3, s.sustainedWork],
        [2, s.continuity],
        [2, cadence(s)],
        [1, ramp(s.sustainedCount, 2, 6)],
      ]),
    qualifying: (s) => [
      `${String(s.sustainedCount)} projects worked on for six months or longer`,
      `active in ${String(s.activeWeeksObserved)} of the last ${String(s.activeWeeksWindow)} weeks`,
    ],
    summary: "Long-lived projects that keep receiving work.",
    copy: {
      clean: "Projects here survive past six months and keep receiving commits.",
      spicy: "Runs marathons while everyone else runs weekends.",
      unhinged: "Still committing to something started years ago. Unwell, respectfully.",
    },
  }),

  define({
    id: "structure_merchant",
    name: "STRUCTURE MERCHANT",
    motif: "layout",
    polarity: "positive",
    requiredMetrics: ["craft.hygiene.organization", "craft.tooling.build"],
    evidenceMetrics: [
      "craft.hygiene.organization",
      "craft.tooling.build",
      "craft.tooling.lint",
      "craft.hygiene.dependencies",
    ],
    minimumEvidence: 2,
    minimumSignal: 0.6,
    minimumConfidence: CONFIDENCE_SPECIALIST,
    specificity: 0.84,
    maximumClass: "distinctive",
    mythicGate: never,
    // Configuration theatre is YAML ENGINEER. This needs real output behind it.
    blocks: (s) =>
      (s.organization ?? 0) < 0.7 ||
      s.substantialCount < 2 ||
      (s.substantialProjects ?? 0) < 0.5 ||
      !leads(
        weighted([
          [2, s.organization],
          [2, toolingStack(s)],
          [1, s.dependencies],
        ]),
        s,
        LEAD,
      ),
    signal: (s) =>
      weighted([
        [3, s.organization],
        [2, toolingStack(s)],
        [2, s.dependencies],
        [1, s.fileSize],
        [1, s.substantialProjects],
      ]),
    qualifying: (s) => [
      `repository layout scores ${String(Math.round((s.organization ?? 0) * 100))}%`,
      `${String(s.substantialCount)} substantial projects behind the tooling`,
    ],
    summary: "Structure and tooling in service of work that actually exists.",
    copy: {
      clean: "Repository structure and tooling are consistently in order.",
      spicy: "You can find anything here without a map.",
      unhinged: "Directory layout so deliberate it feels like a stated position.",
    },
  }),

  define({
    id: "repo_generalist",
    name: "REPO GENERALIST",
    motif: "identity-matchup",
    polarity: "neutral",
    requiredMetrics: [],
    evidenceMetrics: [
      "ship.substance.substantialProjects",
      "ship.frequency.recency",
      "craft.hygiene.documentation",
      "craft.hygiene.organization",
      "craft.testing.exists",
      "craft.tooling.ci",
      "ship.breadth.continuity",
    ],
    minimumEvidence: 2,
    minimumSignal: 0,
    minimumConfidence: 35,
    specificity: 0.72,
    maximumClass: "distinctive",
    mythicGate: never,
    blocks: (s) =>
      s.inspectedCount < 2 ||
      s.confidence < 45 ||
      s.dominantRepositoryShare > 0.75 ||
      s.abandonmentDensity > 0.4,
    signal: (s) => ramp(s.measuredBaseline, 0.2, 0.9),
    qualifying: (s) => [
      `measured categories average ${String(Math.round(s.measuredBaseline * 100))} out of 100`,
      `${String(s.inspectedCount)} repositories inspected end to end`,
    ],
    summary: "Measured evidence spans categories without a qualifying specialist.",
    copy: {
      clean: "Public evidence spans several measured categories.",
      spicy: "A little of everything. No specialist lane owns the profile.",
      unhinged: "Generalist loadout. Every measured category got a turn.",
    },
  }),

  define({
    id: "stealth_builder",
    name: "STEALTH BUILDER",
    motif: "stealth-mode",
    polarity: "neutral",
    requiredMetrics: [],
    // Coverage evidence is the honest justification here (ADR 0008 D4).
    evidenceMetrics: [
      "ship.frequency.recency",
      "ship.substance.substantialProjects",
      "craft.hygiene.abandonment",
      "craft.testing.exists",
      "craft.hygiene.documentation",
    ],
    minimumEvidence: 0,
    minimumSignal: 0,
    minimumConfidence: CONFIDENCE_FALLBACK,
    specificity: 0,
    maximumClass: "unrated",
    mythicGate: never,
    blocks: never,
    signal: () => 0,
    qualifying: (s) => [
      `confidence ${String(s.confidence)} from ${String(s.inspectedCount)} inspected repositories`,
      `${String(s.measuredWeight)} of the scorecard's 100 points were measurable`,
      "work that is private or outside GitHub was not measured and did not score zero",
    ],
    summary: "Public evidence is too limited for a confident specialized identity.",
    copy: {
      clean: "Limited public evidence. Whatever is being built is not visible here.",
      spicy: "Stealth mode. Git Mog cannot score what GitHub does not show.",
      unhinged: "Ghost with a keyboard. No receipts, which is not the same as no skill.",
    },
  }),
]);

export const MOGSONA_BY_ID: ReadonlyMap<string, MogsonaDefinition> = new Map(
  MOGSONA_DEFINITIONS.map((definition) => [definition.id, definition]),
);

/** The two definitions that must always resolve, in fallback order. */
export const MOGSONA_FALLBACK_IDS = Object.freeze(["repo_generalist", "stealth_builder"] as const);
