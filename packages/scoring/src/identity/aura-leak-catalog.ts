import { inverseRamp, ramp, weighted } from "./signals.js";
import type { AuraLeakDefinition } from "./types.js";

/**
 * The Aura Leak catalog: one evidence-backed gremlin trait, or none.
 *
 * Every definition names a *repository* behaviour. None of them makes a claim about the
 * person — not employability, not intelligence, not worth, not honesty, and not whether
 * anyone copied anything. `FORKLIFT OPERATOR` is phrased as public-repository
 * composition for exactly that reason: a fork is a documented, legitimate GitHub action.
 *
 * A leak is never forced. When nothing clears its threshold the product says
 * "None detected." and moves on (ADR 0008 D2).
 */

const define = (definition: AuraLeakDefinition): AuraLeakDefinition => definition;

/** Below this the commit sample is too thin to allege anything about commit behaviour. */
const COMMIT_SAMPLE_FLOOR = 20;

export const AURA_LEAK_DEFINITIONS: readonly AuraLeakDefinition[] = Object.freeze([
  define({
    id: "readme_ceo",
    name: "README CEO",
    motif: "readme-alibi",
    severity: "notable",
    requiredMetrics: ["craft.hygiene.documentation", "ship.breadth.released"],
    evidenceMetrics: ["craft.hygiene.documentation", "ship.breadth.released"],
    minimumEvidence: 2,
    minimumSignal: 0.55,
    blocks: (s) => s.releaseCount > 0 || (s.documentation ?? 0) < 0.75 || s.substantialCount < 1,
    signal: (s) =>
      weighted([
        [3, s.documentation],
        [2, inverseRamp(s.releaseCount, 0, 2)],
        [2, inverseRamp(s.testsExist ?? 0, 0, 0.6)],
        [1, ramp(s.substantialCount, 0, 3)],
      ]),
    qualifying: (s) => [
      `documentation scores ${String(Math.round((s.documentation ?? 0) * 100))}% across inspected repositories`,
      "no published release on any inspected repository",
    ],
    copy: {
      clean: "Documentation is ahead of the software it documents.",
      spicy: "The README is carrying the whole project.",
      unhinged: "Full documentation coverage for software that has never shipped.",
    },
  }),

  define({
    id: "sidequest_collector",
    name: "SIDEQUEST COLLECTOR",
    motif: "repo-confetti",
    severity: "notable",
    requiredMetrics: ["ship.substance.substantialProjects"],
    evidenceMetrics: ["ship.substance.substantialProjects", "craft.hygiene.abandonment"],
    minimumEvidence: 1,
    minimumSignal: 0.55,
    // Archived work is intentionally finished, so a deliberate archivist is excluded.
    blocks: (s) =>
      s.eligibleCount < 8 ||
      s.substantialRatio > 0.34 ||
      s.archivedCount >= Math.max(3, Math.round(s.eligibleCount * 0.4)),
    signal: (s) =>
      weighted([
        [3, ramp(s.eligibleCount - s.substantialCount, 4, 14)],
        [3, inverseRamp(s.substantialRatio, 0.05, 0.34)],
        [1, ramp(s.abandonmentDensity, 0, 0.5)],
        [1, inverseRamp(s.substantialProjects ?? 0, 0.2, 0.8)],
      ]),
    qualifying: (s) => [
      `${String(s.eligibleCount)} eligible repositories, ${String(s.substantialCount)} substantial`,
      `${String(s.archivedCount)} archived, so the rest were left open rather than finished`,
    ],
    copy: {
      clean: "Many public repositories, few of them substantial.",
      spicy: "The side quest log is longer than the main story.",
      unhinged: "Repository confetti. Somewhere in there is a finished project.",
    },
  }),

  define({
    id: "framework_tourist",
    name: "FRAMEWORK TOURIST",
    motif: "polyglot-tourism",
    severity: "light",
    requiredMetrics: ["ship.substance.substantialProjects"],
    evidenceMetrics: ["ship.substance.substantialProjects", "ship.substance.sustainedWork"],
    minimumEvidence: 1,
    minimumSignal: 0.55,
    // A genuine polyglot has breadth *and* substance. This needs breadth without it.
    blocks: (s) =>
      s.languageCount < 4 ||
      s.substantialLanguageCount >= 3 ||
      s.substantialRatio > 0.4 ||
      (s.sustainedWork ?? 0) > 0.5,
    signal: (s) =>
      weighted([
        [3, ramp(s.languageCount, 3, 7)],
        [2, inverseRamp(s.substantialLanguageCount, 0, 3)],
        [2, inverseRamp(s.sustainedWork ?? 0, 0, 0.5)],
        [1, inverseRamp(s.substantialRatio, 0.05, 0.4)],
      ]),
    qualifying: (s) => [
      `${String(s.languageCount)} languages observed, ${String(s.substantialLanguageCount)} of them in substantial projects`,
      `${String(s.sustainedCount)} projects sustained past six months`,
    ],
    copy: {
      clean: "Broad language surface, thin continuity behind it.",
      spicy: "Five frameworks entered. Shipping never did.",
      unhinged: "Visited every ecosystem. Left a first commit in each one.",
    },
  }),

  define({
    id: "release_avoider",
    name: "RELEASE AVOIDER",
    motif: "release-avoidance",
    severity: "notable",
    requiredMetrics: ["craft.hygiene.releases"],
    evidenceMetrics: ["craft.hygiene.releases", "ship.breadth.released"],
    minimumEvidence: 1,
    minimumSignal: 0.35,
    // A profile whose real problem is abandonment is REPO GRAVEYARD, not this. Release
    // avoidance is about maintained projects that never get tagged.
    blocks: (s) =>
      s.releaseCount > 0 ||
      s.substantialCount < 2 ||
      (s.releaseHygiene ?? 1) > 0 ||
      s.abandonmentDensity >= 0.4,
    signal: (s) =>
      weighted([
        [3, ramp(s.substantialCount, 2, 6)],
        [2, ramp(s.sustainedCount, 1, 4)],
        [2, inverseRamp(s.abandonmentDensity, 0, 0.4)],
      ]),
    qualifying: (s) => [
      `${String(s.substantialCount)} substantial projects that look intended for distribution`,
      "no tagged release on any of them",
    ],
    copy: {
      clean: "Substantial projects with no tagged release yet.",
      spicy: "The releases tab remains an aspirational feature.",
      unhinged: "Refuses to tag a version. Main branch is the product and always will be.",
    },
  }),

  define({
    id: "forklift_operator",
    name: "FORKLIFT OPERATOR",
    motif: "fork-composition",
    severity: "light",
    requiredMetrics: ["ship.substance.substantialProjects"],
    evidenceMetrics: ["ship.substance.substantialProjects"],
    minimumEvidence: 1,
    minimumSignal: 0.5,
    blocks: (s) => s.publicCount < 6 || s.forkRatio < 0.5 || s.substantialCount > 2,
    signal: (s) =>
      weighted([
        [3, ramp(s.forkRatio, 0.45, 0.85)],
        [2, ramp(s.forkCount, 2, 12)],
        [2, inverseRamp(s.substantialCount, 0, 3)],
      ]),
    qualifying: (s) => [
      `${String(s.forkCount)} of ${String(s.publicCount)} public repositories are forks`,
      `${String(s.substantialCount)} substantial original projects alongside them`,
    ],
    copy: {
      clean: "Most of the public profile is forks rather than original repositories.",
      spicy: "Forklift certified. The original work is in there somewhere.",
      unhinged: "The profile grid is mostly other people's repositories wearing your avatar.",
    },
  }),

  define({
    id: "fix_loop_enjoyer",
    name: "FIX-LOOP ENJOYER",
    motif: "fix-loop",
    severity: "notable",
    requiredMetrics: ["ship.discipline.repairLoops"],
    evidenceMetrics: ["ship.discipline.repairLoops", "ship.discipline.mergeHygiene"],
    minimumEvidence: 1,
    minimumSignal: 0.5,
    blocks: (s) => s.commitSampleSize < COMMIT_SAMPLE_FLOOR || s.repairRate < 0.25,
    signal: (s) =>
      weighted([
        [3, ramp(s.repairRate, 0.2, 0.55)],
        [2, ramp(s.revertRate, 0, 0.15)],
        [1, ramp(s.commitSampleSize, 20, 60)],
      ]),
    qualifying: (s) => [
      `${String(Math.round(s.repairRate * 100))}% of sampled commits repair an earlier commit`,
      `${String(Math.round(s.revertRate * 100))}% are reverts, across ${String(s.commitSampleSize)} sampled commits`,
    ],
    copy: {
      clean: "A large share of commits repair an earlier commit.",
      spicy: "Ships, repairs, then repairs the repair.",
      unhinged: "fix. fix again. actually fix it. revert. The saga continues.",
    },
  }),

  define({
    id: "commit_chaos",
    name: "COMMIT CHAOS",
    motif: "commit-crime-board",
    severity: "notable",
    requiredMetrics: ["ship.discipline.messages"],
    evidenceMetrics: ["ship.discipline.messages", "ship.discipline.mergeHygiene"],
    minimumEvidence: 1,
    minimumSignal: 0.5,
    blocks: (s) => s.commitSampleSize < COMMIT_SAMPLE_FLOOR || s.lowEffortRate < 0.3,
    signal: (s) =>
      weighted([
        [3, ramp(s.lowEffortRate, 0.25, 0.7)],
        [2, inverseRamp(s.commitMessages ?? 0, 0, 0.6)],
        [1, ramp(s.revertRate, 0, 0.12)],
      ]),
    qualifying: (s) => [
      `${String(Math.round(s.lowEffortRate * 100))}% of sampled commit messages are one word or shorter`,
      `median commit subject is ${String(s.commitSampleSize > 0 ? "measured" : "unmeasured")} across ${String(s.commitSampleSize)} commits`,
    ],
    copy: {
      clean: "Most commit messages do not describe the change.",
      spicy: "The commit log reads like a group chat at 3am.",
      unhinged: "git log is a keyboard falling down a flight of stairs.",
    },
  }),

  define({
    id: "localhost_millionaire",
    name: "LOCALHOST MILLIONAIRE",
    motif: "yaml-discipline",
    severity: "light",
    requiredMetrics: ["craft.tooling.build", "ship.breadth.released"],
    evidenceMetrics: ["craft.tooling.build", "craft.tooling.lint", "ship.breadth.released"],
    minimumEvidence: 2,
    minimumSignal: 0.55,
    // Asserts nothing about business, funding or deployment. Setup versus delivery: the
    // toolchain and the tests are complete, and nothing has reached a user. A profile
    // with no tests at all is YAML ENGINEER; one with no docs behind it is README CEO.
    blocks: (s) =>
      s.releaseCount > 0 ||
      (s.build ?? 0) < 0.7 ||
      (s.lint ?? 0) < 0.7 ||
      (s.typing ?? 0) < 0.7 ||
      (s.testsExist ?? 0) < 0.34 ||
      s.substantialCount < 1 ||
      s.externalRepositoryCount > 1,
    signal: (s) =>
      weighted([
        [
          3,
          weighted([
            [2, s.build],
            [1, s.lint],
            [1, s.typing],
            [1, s.dependencies],
          ]),
        ],
        [2, inverseRamp(s.releaseCount, 0, 2)],
        [2, inverseRamp(s.externalWork ?? 0, 0, 0.5)],
        [1, ramp(s.substantialCount, 0, 3)],
      ]),
    qualifying: (s) => [
      "build, lint, type-check and dependency configuration all measured positive",
      `no published release and ${String(s.externalRepositoryCount)} external repositories touched`,
    ],
    copy: {
      clean: "The setup is complete. Public delivery evidence is not.",
      spicy: "Runs beautifully on one machine. Nobody else has seen it.",
      unhinged: "Perfect toolchain, zero releases. Localhost is thriving.",
    },
  }),

  define({
    id: "code_hermit",
    name: "CODE HERMIT",
    motif: "other-peoples-repos",
    severity: "light",
    requiredMetrics: ["ship.breadth.external"],
    evidenceMetrics: ["ship.breadth.external", "ship.substance.substantialProjects"],
    minimumEvidence: 1,
    minimumSignal: 0.5,
    blocks: (s) =>
      s.externalRepositoryCount > 0 ||
      s.mergedPullRequests > 0 ||
      s.substantialCount < 2 ||
      s.annualizedCommits < 40,
    signal: (s) =>
      weighted([
        [3, ramp(s.annualizedCommits, 30, 200)],
        [2, ramp(s.substantialCount, 1, 5)],
        [2, inverseRamp(s.externalWork ?? 0, 0, 0.4)],
      ]),
    qualifying: (s) => [
      `${String(s.substantialCount)} substantial owned projects with active public development`,
      "no repositories touched outside their own account in the public window",
    ],
    copy: {
      clean: "Public collaboration evidence is solo-heavy.",
      spicy: "All the work, none of it in anyone else's repository.",
      unhinged: "Never leaves the account. The pull request tab is decorative.",
    },
  }),

  define({
    id: "yaml_engineer",
    name: "YAML ENGINEER",
    motif: "yaml-discipline",
    severity: "light",
    requiredMetrics: ["craft.tooling.ci", "ship.substance.substantialProjects"],
    evidenceMetrics: ["craft.tooling.ci", "craft.tooling.automation"],
    minimumEvidence: 1,
    minimumSignal: 0.55,
    // The gate is path-based: pipelines and automation present, tests absent, layout
    // weak, nothing published. Those are all things a file tree can honestly show.
    blocks: (s) =>
      (s.ci ?? 0) < 0.7 ||
      (s.testsExist ?? 1) > 0.2 ||
      s.releaseCount > 0 ||
      (s.organization ?? 1) > 0.7 ||
      (s.automation ?? 0) < 0.5,
    signal: (s) =>
      weighted([
        [3, s.ci],
        [2, inverseRamp(s.testsExist ?? 0, 0, 0.2)],
        [2, inverseRamp(s.organization ?? 0, 0.3, 0.7)],
        [1, s.automation],
      ]),
    qualifying: (s) => [
      `CI configured in ${String(s.ciCount)} of ${String(s.inspectedCount)} inspected repositories`,
      `${String(s.substantialCount)} substantial projects behind that pipeline`,
    ],
    copy: {
      clean: "Strong pipeline configuration, thin measured output behind it.",
      spicy: "CI has more discipline than the roadmap.",
      unhinged: "The workflow file is the most finished thing in the repository.",
    },
  }),

  define({
    id: "repo_graveyard",
    name: "REPO GRAVEYARD",
    motif: "graveyard",
    severity: "critical",
    requiredMetrics: ["craft.hygiene.abandonment"],
    evidenceMetrics: ["craft.hygiene.abandonment", "ship.breadth.continuity"],
    minimumEvidence: 1,
    minimumSignal: 0.55,
    blocks: (s) => s.abandonedCount < 3 || s.abandonmentDensity < 0.4,
    signal: (s) =>
      weighted([
        [3, ramp(s.abandonedCount, 2, 7)],
        [3, ramp(s.abandonmentDensity, 0.3, 0.8)],
        [1, inverseRamp(s.continuity ?? 0, 0, 0.6)],
      ]),
    qualifying: (s) => [
      `${String(s.abandonedCount)} abandoned substantial projects`,
      `${String(Math.round(s.abandonmentDensity * 100))}% of substantial projects are abandoned, archives excluded`,
    ],
    copy: {
      clean: "Several substantial projects have gone a year without maintenance.",
      spicy: "This repo graveyard has zoning permits.",
      unhinged: "A whole cemetery, and not one headstone says archived.",
    },
  }),

  define({
    id: "single_point_of_aura",
    name: "SINGLE POINT OF AURA",
    motif: "one-repo-carry",
    severity: "light",
    requiredMetrics: ["ship.substance.substantialProjects"],
    evidenceMetrics: ["ship.substance.substantialProjects", "ship.substance.sustainedWork"],
    minimumEvidence: 1,
    minimumSignal: 0.5,
    // Excludes the profile that clears the stronger ONE-REPO FINAL BOSS gate.
    blocks: (s) =>
      s.dominantRepositoryShare < 0.8 ||
      s.substantialCount > 2 ||
      (s.releaseCount >= 2 && (s.sustainedWork ?? 0) >= 0.4) ||
      ((s.testsExist ?? 0) >= 0.6 && (s.sustainedWork ?? 0) >= 0.4),
    signal: (s) =>
      weighted([
        [3, ramp(s.dominantRepositoryShare, 0.75, 0.99)],
        [2, inverseRamp(s.substantialCount, 0, 3)],
        [2, inverseRamp(s.sustainedWork ?? 0, 0, 0.5)],
      ]),
    qualifying: (s) => [
      `one repository holds ${String(Math.round(s.dominantRepositoryShare * 100))}% of the substantial public bytes`,
      `${String(s.substantialCount)} substantial projects in total`,
    ],
    copy: {
      clean: "One repository carries nearly all of the measured evidence.",
      spicy: "One repository is carrying the entire bloodline.",
      unhinged: "Delete that repo and the profile stops existing.",
    },
  }),
]);

export const AURA_LEAK_BY_ID: ReadonlyMap<string, AuraLeakDefinition> = new Map(
  AURA_LEAK_DEFINITIONS.map((definition) => [definition.id, definition]),
);
