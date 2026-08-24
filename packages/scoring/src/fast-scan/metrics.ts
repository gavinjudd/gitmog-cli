import { hasMainstreamLinter, usesGradualTyping } from "@gitmog/analyzers";

import { METRIC_DEFINITIONS, UNMEASURABLE_IN_FAST_SCAN } from "./catalog.js";
import { clampUnit, interpolate, inversePenalty, mean, round } from "./curves.js";
import {
  commitMessageStatistics,
  ACTIVE_WEEK_WINDOW,
  MINIMUM_COMMIT_SAMPLE,
  type ProfileSignals,
  type RepositoryEvidence,
} from "./signals.js";
import type { EvidenceItem, EvidencePolarity, MetricAvailability, MetricResult } from "./types.js";

interface MetricOutcome {
  readonly availability: MetricAvailability;
  readonly ratio: number;
  readonly detail: string;
  readonly limitation?: string;
  readonly evidenceIds: readonly string[];
}

interface EvidenceDraft {
  readonly suffix: string;
  readonly polarity: EvidencePolarity;
  readonly title: string;
  readonly detail: string;
  readonly sourceUrl: string;
  readonly value?: number | string | null;
  readonly repository?: string | null;
}

class MetricContext {
  readonly signals: ProfileSignals;
  readonly collected: EvidenceItem[] = [];
  #metricId = "";
  #categoryId = "";

  constructor(signals: ProfileSignals) {
    this.signals = signals;
  }

  begin(metricId: string, categoryId: string): void {
    this.#metricId = metricId;
    this.#categoryId = categoryId;
  }

  add(draft: EvidenceDraft): string {
    const id = `${this.#metricId}:${draft.suffix}`;
    this.collected.push({
      id,
      category: this.#categoryId,
      metric: this.#metricId,
      polarity: draft.polarity,
      title: draft.title,
      detail: draft.detail,
      sourceUrl: draft.sourceUrl,
      ...(draft.value === null || draft.value === undefined ? {} : { value: draft.value }),
      ...(draft.repository === null || draft.repository === undefined
        ? {}
        : { repository: draft.repository }),
    });
    return id;
  }
}

type Scorer = (context: MetricContext) => MetricOutcome;

const unavailable = (reason: string): MetricOutcome => ({
  availability: "unavailable",
  ratio: 0,
  detail: reason,
  limitation: reason,
  evidenceIds: [],
});

const profileUrl = (signals: ProfileSignals): string => signals.snapshot.profile.htmlUrl;

const pluralRepositories = (count: number): string =>
  count === 1 ? "1 repository" : `${String(count)} repositories`;

const analyzedOrNull = (signals: ProfileSignals): readonly RepositoryEvidence[] | null =>
  signals.analyzed.length === 0 ? null : signals.analyzed;

const NO_TREE = "No repository file tree could be read, so this metric was left out of the score.";
const NO_EVENTS =
  "No public activity events were readable, so this metric was left out of the score.";
const TOO_FEW_MESSAGES = `Fewer than ${String(MINIMUM_COMMIT_SAMPLE)} public commit messages were readable, which is too thin to judge.`;

const SCORERS: Readonly<Record<string, Scorer>> = {
  "ship.frequency.commits": (context) => {
    const { signals } = context;
    if (!signals.hasEventEvidence) return unavailable(NO_EVENTS);
    const annualized = signals.annualizedCommits;
    const ratio =
      interpolate(annualized, [
        [0, 0],
        [10, 2],
        [25, 4],
        [50, 5.6],
        [100, 7],
        [250, 9],
        [500, 10],
      ]) / 10;
    const evidenceIds = [
      context.add({
        suffix: "annualized",
        polarity: annualized >= 60 ? "positive" : annualized >= 15 ? "neutral" : "negative",
        title: `${String(Math.round(annualized))} qualifying commits per year, estimated`,
        detail: `${String(signals.observedPushes)} public pushes observed across ${String(Math.round(signals.activityWindowDays))} days, excluding bots. Each push counts as one commit, a deliberate lower bound.`,
        value: Math.round(annualized),
        sourceUrl: profileUrl(signals),
      }),
    ];
    return {
      availability: "partial",
      ratio,
      detail: `≈${String(Math.round(annualized))} qualifying commits a year, from the public events window.`,
      limitation:
        "Commit volume is a lower bound: the public events endpoint reports pushes, not commit counts, and reaches back at most 90 days.",
      evidenceIds,
    };
  },

  "ship.frequency.activeWeeks": (context) => {
    const { signals } = context;
    if (!signals.hasEventEvidence) return unavailable(NO_EVENTS);
    const weeks = signals.activeWeeks;
    const ratio = interpolate(weeks, [
      [0, 0],
      [1, 0.15],
      [3, 0.4],
      [7, 0.68],
      [9, 0.86],
      [12, 1],
    ]);
    return {
      availability: "partial",
      ratio,
      detail: `${String(weeks)} of the last ${String(ACTIVE_WEEK_WINDOW)} weeks contained public development.`,
      limitation: `Active weeks are counted over the last ${String(ACTIVE_WEEK_WINDOW)} weeks, not the 52 the scorecard describes.`,
      evidenceIds: [
        context.add({
          suffix: "weeks",
          polarity: weeks >= 7 ? "positive" : weeks >= 3 ? "neutral" : "negative",
          title: `Active in ${String(weeks)} of the last ${String(ACTIVE_WEEK_WINDOW)} weeks`,
          detail: "A week counts when it contains at least one public development event.",
          value: weeks,
          sourceUrl: profileUrl(signals),
        }),
      ],
    };
  },

  "ship.frequency.recency": (context) => {
    const { signals } = context;
    const days = signals.daysSinceLastPublicPush;
    if (days === null) {
      return unavailable("No public push date is visible on any repository or event.");
    }
    const ratio = interpolate(days, [
      [0, 1],
      [7, 1],
      [30, 0.9],
      [90, 0.72],
      [180, 0.5],
      [365, 0.3],
      [730, 0.1],
    ]);
    return {
      availability: "available",
      ratio,
      detail: `Last public push was ${String(Math.round(days))} days ago.`,
      evidenceIds: [
        context.add({
          suffix: "last-push",
          polarity: days <= 30 ? "positive" : days <= 180 ? "neutral" : "negative",
          title: `Last public push ${String(Math.round(days))} days ago`,
          detail: "Measured across every public repository and every public push event.",
          value: Math.round(days),
          sourceUrl: profileUrl(signals),
        }),
      ],
    };
  },

  "ship.substance.substantialProjects": (context) => {
    const { signals } = context;
    const count = signals.substantial.length;
    const ratio =
      interpolate(count, [
        [0, 0],
        [1, 1.6],
        [2, 2.5],
        [3, 3.1],
        [5, 3.7],
        [8, 4],
      ]) / 4;
    const strongest = [...signals.substantial].sort(
      (left, right) => right.summary.sizeKb - left.summary.sizeKb,
    )[0];
    const evidenceIds = [
      context.add({
        suffix: "count",
        polarity: count >= 3 ? "positive" : count >= 1 ? "neutral" : "negative",
        title: `${String(count)} substantial original ${count === 1 ? "project" : "projects"}`,
        detail:
          "Substantial means original, non-template, non-empty, and passing at least two of size, lifespan, release, source volume and manifest.",
        value: count,
        sourceUrl: profileUrl(signals),
      }),
    ];
    if (strongest !== undefined) {
      evidenceIds.push(
        context.add({
          suffix: "largest",
          polarity: "positive",
          title: `Largest substantial project: ${strongest.summary.name}`,
          detail: `${String(strongest.summary.sizeKb)} KB, ${String(Math.round(strongest.spanDays))} days between first and latest public commit.`,
          value: strongest.summary.sizeKb,
          repository: strongest.summary.fullName,
          sourceUrl: strongest.summary.htmlUrl,
        }),
      );
    }
    return {
      availability: "available",
      ratio,
      detail: `${String(count)} substantial original ${count === 1 ? "project" : "projects"}.`,
      evidenceIds,
    };
  },

  "ship.substance.sustainedWork": (context) => {
    const { signals } = context;
    const sustained = signals.substantial.filter((repository) => repository.spanDays >= 180);
    const ratio =
      interpolate(sustained.length, [
        [0, 0],
        [1, 1.4],
        [2, 2.2],
        [3, 2.7],
        [5, 3],
      ]) / 3;
    const longest = [...signals.substantial].sort(
      (left, right) => right.spanDays - left.spanDays,
    )[0];
    const evidenceIds = [
      context.add({
        suffix: "count",
        polarity:
          sustained.length >= 2 ? "positive" : sustained.length >= 1 ? "neutral" : "negative",
        title: `${String(sustained.length)} ${sustained.length === 1 ? "project" : "projects"} worked on for six months or more`,
        detail: "Measured from repository creation to the most recent public push.",
        value: sustained.length,
        sourceUrl: profileUrl(signals),
      }),
    ];
    if (longest !== undefined && longest.spanDays >= 90) {
      evidenceIds.push(
        context.add({
          suffix: "longest",
          polarity: "positive",
          title: `${longest.summary.name} spans ${String(Math.round(longest.spanDays / 30))} months`,
          detail: "A repository that keeps receiving commits is stronger evidence than a new one.",
          value: Math.round(longest.spanDays),
          repository: longest.summary.fullName,
          sourceUrl: longest.summary.htmlUrl,
        }),
      );
    }
    return {
      availability: "available",
      ratio,
      detail: `${String(sustained.length)} substantial ${sustained.length === 1 ? "project" : "projects"} sustained past six months.`,
      evidenceIds,
    };
  },

  "ship.discipline.messages": (context) => {
    const { signals } = context;
    const stats = commitMessageStatistics(signals.commitMessages);
    if (signals.commitSampleSize < MINIMUM_COMMIT_SAMPLE) return unavailable(TOO_FEW_MESSAGES);
    const ratio =
      0.7 * inversePenalty(stats.lowEffortRate, 0.4) +
      0.3 *
        interpolate(stats.medianLength, [
          [0, 0],
          [10, 0.2],
          [20, 0.6],
          [35, 0.9],
          [60, 1],
        ]);
    return {
      availability: "partial",
      ratio: clampUnit(ratio),
      detail: `${String(Math.round(stats.lowEffortRate * 100))}% low-effort messages, median subject ${String(Math.round(stats.medianLength))} characters.`,
      limitation: `Commit messages are sampled from ${signals.commitSampleRepository ?? "one repository"} only.`,
      evidenceIds: [
        context.add({
          suffix: "low-effort",
          polarity:
            stats.lowEffortRate <= 0.1
              ? "positive"
              : stats.lowEffortRate >= 0.25
                ? "negative"
                : "neutral",
          title: `${String(Math.round(stats.lowEffortRate * 100))}% of sampled commit messages are low effort`,
          detail: `Across ${String(stats.count)} non-merge commits in ${signals.commitSampleRepository ?? "the sampled repository"}. "fix", "update", "wip", "." and friends.`,
          value: round(stats.lowEffortRate * 100, 1),
          repository: signals.commitSampleRepository,
          sourceUrl: signals.commitSampleUrl ?? profileUrl(signals),
        }),
      ],
    };
  },

  "ship.discipline.repairLoops": (context) => {
    const { signals } = context;
    const stats = commitMessageStatistics(signals.commitMessages);
    if (signals.commitSampleSize < MINIMUM_COMMIT_SAMPLE) return unavailable(TOO_FEW_MESSAGES);
    const ratio = inversePenalty(stats.repairRate, 0.35);
    return {
      availability: "partial",
      ratio,
      detail: `${String(Math.round(stats.repairRate * 100))}% of sampled commits are repairs of an earlier commit.`,
      limitation: `Repair loops are sampled from ${signals.commitSampleRepository ?? "one repository"} only.`,
      evidenceIds: [
        context.add({
          suffix: "rate",
          polarity:
            stats.repairRate <= 0.12
              ? "positive"
              : stats.repairRate >= 0.25
                ? "negative"
                : "neutral",
          title: `${String(Math.round(stats.repairRate * 100))}% repair commits`,
          detail: `Messages starting with fix, hotfix, actually, revert and similar, across ${String(stats.count)} sampled commits.`,
          value: round(stats.repairRate * 100, 1),
          repository: signals.commitSampleRepository,
          sourceUrl: signals.commitSampleUrl ?? profileUrl(signals),
        }),
      ],
    };
  },

  "ship.discipline.mergeHygiene": (context) => {
    const { signals } = context;
    const stats = commitMessageStatistics(signals.commitMessages);
    if (signals.commitSampleSize < MINIMUM_COMMIT_SAMPLE) return unavailable(TOO_FEW_MESSAGES);
    // Merges are counted exactly, from the commit's parent count rather than its text.
    const ratio =
      0.6 * inversePenalty(stats.revertRate, 0.08) +
      0.4 * inversePenalty(Math.max(0, signals.mergeCommitRate - 0.5), 0.4);
    return {
      availability: "partial",
      ratio,
      detail: `${String(round(stats.revertRate * 100, 1))}% reverts, ${String(round(signals.mergeCommitRate * 100, 1))}% merge commits in the sample.`,
      limitation: `Merge and revert noise is sampled from ${signals.commitSampleRepository ?? "one repository"} only.`,
      evidenceIds: [
        context.add({
          suffix: "reverts",
          polarity:
            stats.revertRate === 0 ? "positive" : stats.revertRate >= 0.05 ? "negative" : "neutral",
          title: `${String(round(stats.revertRate * 100, 1))}% of sampled commits are reverts`,
          detail: `Across ${String(stats.count)} non-merge commits, with ${String(round(signals.mergeCommitRate * 100, 1))}% of the sample being merge commits.`,
          value: round(stats.revertRate * 100, 1),
          repository: signals.commitSampleRepository,
          sourceUrl: signals.commitSampleUrl ?? profileUrl(signals),
        }),
      ],
    };
  },

  "ship.breadth.external": (context) => {
    const { signals } = context;
    if (!signals.hasEventEvidence) return unavailable(NO_EVENTS);
    const repositories = signals.externalRepositories.length;
    const weighted = repositories + signals.mergedPullRequests * 0.4 + signals.reviewEvents * 0.3;
    const ratio =
      interpolate(weighted, [
        [0, 0],
        [1, 1.6],
        [3, 2.8],
        [6, 3.5],
        [10, 4],
      ]) / 4;
    const evidenceIds = [
      context.add({
        suffix: "repositories",
        polarity: repositories >= 2 ? "positive" : repositories >= 1 ? "neutral" : "negative",
        title: `${pluralRepositories(repositories)} touched outside their own account`,
        detail: `${String(signals.mergedPullRequests)} merged pull requests and ${String(signals.reviewEvents)} reviews observed in the public window.`,
        value: repositories,
        sourceUrl: profileUrl(signals),
      }),
    ];
    return {
      availability: "partial",
      ratio,
      detail: `${pluralRepositories(repositories)} outside their own account in the public window.`,
      limitation: "External work is counted only inside the public events window.",
      evidenceIds,
    };
  },

  "ship.breadth.released": (context) => {
    const { signals } = context;
    if (signals.inspected.length === 0) {
      return unavailable("No repository was inspected deeply enough to read its releases.");
    }
    const withReleases = signals.inspected.filter((repository) => repository.releaseCount > 0);
    const ratio = interpolate(withReleases.length / signals.inspected.length, [
      [0, 0],
      [0.34, 0.6],
      [0.67, 0.85],
      [1, 1],
    ]);
    const evidenceIds = [
      context.add({
        suffix: "ratio",
        polarity: withReleases.length > 0 ? "positive" : "negative",
        title:
          withReleases.length === 0
            ? "No published releases on any inspected repository"
            : `${String(withReleases.length)} of ${String(signals.inspected.length)} inspected repositories publish releases`,
        detail: `${String(signals.totalReleases)} published releases in total across inspected repositories.`,
        value: signals.totalReleases,
        sourceUrl: profileUrl(signals),
      }),
    ];
    const best = [...withReleases].sort((left, right) => right.releaseCount - left.releaseCount)[0];
    if (best !== undefined) {
      evidenceIds.push(
        context.add({
          suffix: "top",
          polarity: "positive",
          title: `${best.summary.name} has ${String(best.releaseCount)} published releases`,
          detail: "Releases are the observable form of finished, distributable work.",
          value: best.releaseCount,
          repository: best.summary.fullName,
          sourceUrl: `${best.summary.htmlUrl}/releases`,
        }),
      );
    }
    return {
      availability: "available",
      ratio,
      detail: `${String(withReleases.length)} of ${String(signals.inspected.length)} inspected repositories publish releases.`,
      evidenceIds,
    };
  },

  "ship.breadth.continuity": (context) => {
    const { signals } = context;
    if (signals.substantial.length === 0) {
      return unavailable("No substantial repository exists to judge continuity against.");
    }
    // An archived repository is intentionally finished, so it counts as continued.
    const continued = signals.substantial.filter(
      (repository) => repository.summary.archived || repository.idleDays <= 365,
    );
    const ratio = continued.length / signals.substantial.length;
    return {
      availability: "available",
      ratio,
      detail: `${String(continued.length)} of ${String(signals.substantial.length)} substantial projects are current or deliberately archived.`,
      evidenceIds: [
        context.add({
          suffix: "ratio",
          polarity: ratio >= 0.7 ? "positive" : ratio >= 0.4 ? "neutral" : "negative",
          title: `${String(continued.length)} of ${String(signals.substantial.length)} substantial projects still maintained`,
          detail: "Archived repositories count as finished, not as abandoned.",
          value: `${String(continued.length)}/${String(signals.substantial.length)}`,
          sourceUrl: profileUrl(signals),
        }),
      ],
    };
  },

  "craft.testing.exists": (context) => {
    const analyzed = analyzedOrNull(context.signals);
    if (analyzed === null) return unavailable(NO_TREE);
    const meaningful = (repository: RepositoryEvidence): boolean => {
      const structure = repository.structure;
      if (structure === null) return false;
      return (
        structure.testFileCount >= 3 ||
        (structure.testFileCount >= 1 && structure.sourceFileCount < 20)
      );
    };
    const withTests = analyzed.filter(meaningful);
    const ratio = interpolate(withTests.length / analyzed.length, [
      [0, 0],
      [0.34, 0.5],
      [0.67, 0.8],
      [1, 1],
    ]);
    const evidenceIds = [
      context.add({
        suffix: "ratio",
        polarity:
          withTests.length === analyzed.length
            ? "positive"
            : withTests.length === 0
              ? "negative"
              : "neutral",
        title:
          withTests.length === 0
            ? `No meaningful tests in any of the ${String(analyzed.length)} inspected repositories`
            : `${String(withTests.length)} of ${String(analyzed.length)} inspected repositories carry meaningful tests`,
        detail: "Meaningful means at least three test files, or at least one in a small project.",
        value: `${String(withTests.length)}/${String(analyzed.length)}`,
        sourceUrl: context.signals.snapshot.profile.htmlUrl,
      }),
    ];
    const best = [...withTests].sort(
      (left, right) => (right.structure?.testFileCount ?? 0) - (left.structure?.testFileCount ?? 0),
    )[0];
    if (best?.structure !== undefined && best.structure !== null) {
      evidenceIds.push(
        context.add({
          suffix: "top",
          polarity: "positive",
          title: `${best.summary.name} has ${String(best.structure.testFileCount)} test files`,
          detail: `Against ${String(best.structure.sourceFileCount)} source files in the same tree.`,
          value: best.structure.testFileCount,
          repository: best.summary.fullName,
          sourceUrl: best.summary.htmlUrl,
        }),
      );
    }
    return {
      availability: "available",
      ratio,
      detail: `${String(withTests.length)} of ${String(analyzed.length)} inspected repositories carry meaningful tests.`,
      evidenceIds,
    };
  },

  "craft.testing.breadth": (context) => {
    const analyzed = analyzedOrNull(context.signals);
    if (analyzed === null) return unavailable(NO_TREE);
    const scored = analyzed.filter(
      (repository) => (repository.structure?.sourceFileCount ?? 0) >= 5,
    );
    if (scored.length === 0) {
      return unavailable("No inspected repository has enough source files to judge test breadth.");
    }
    const ratios = scored.map((repository) => {
      const structure = repository.structure;
      if (structure === null) return 0;
      return structure.testFileCount / Math.max(1, structure.sourceFileCount);
    });
    const average = mean(ratios);
    const ratio = interpolate(average, [
      [0, 0],
      [0.05, 0.3],
      [0.15, 0.7],
      [0.3, 1],
    ]);
    return {
      availability: "available",
      ratio,
      detail: `Test-to-source file ratio averages ${String(round(average, 2))} across inspected repositories.`,
      evidenceIds: [
        context.add({
          suffix: "ratio",
          polarity: average >= 0.15 ? "positive" : average >= 0.05 ? "neutral" : "negative",
          title: `Test-to-source ratio ${String(round(average, 2))}`,
          detail: `Averaged over ${pluralRepositories(scored.length)} with enough source files to compare.`,
          value: round(average, 2),
          sourceUrl: context.signals.snapshot.profile.htmlUrl,
        }),
      ],
    };
  },

  "craft.testing.workflow": (context) => {
    const analyzed = analyzedOrNull(context.signals);
    if (analyzed === null) return unavailable(NO_TREE);
    const wired = analyzed.filter(
      (repository) => repository.structure?.hasCi === true && repository.structure.hasTests,
    );
    const ratio = wired.length / analyzed.length;
    return {
      availability: "available",
      ratio,
      detail: `${String(wired.length)} of ${String(analyzed.length)} inspected repositories have both tests and CI.`,
      evidenceIds: [
        context.add({
          suffix: "ratio",
          polarity: ratio >= 0.67 ? "positive" : ratio > 0 ? "neutral" : "negative",
          title: `${String(wired.length)} of ${String(analyzed.length)} inspected repositories run tests under CI configuration`,
          detail: "Both a CI configuration file and test files are present in the same tree.",
          value: `${String(wired.length)}/${String(analyzed.length)}`,
          sourceUrl: context.signals.snapshot.profile.htmlUrl,
        }),
      ],
    };
  },

  "craft.maintainability.fileSize": (context) => {
    const analyzed = analyzedOrNull(context.signals);
    if (analyzed === null) return unavailable(NO_TREE);
    const withSource = analyzed.filter(
      (repository) => (repository.structure?.sourceFileCount ?? 0) > 0,
    );
    if (withSource.length === 0) {
      return unavailable("No inspected repository contains recognised source files.");
    }
    const oversizedRate = mean(
      withSource.map((repository) => {
        const structure = repository.structure;
        if (structure === null) return 0;
        return structure.oversizedSourceFileCount / Math.max(1, structure.sourceFileCount);
      }),
    );
    const largest = Math.max(
      ...withSource.map((repository) => repository.structure?.largestSourceFileBytes ?? 0),
    );
    const base = inversePenalty(oversizedRate, 0.05);
    const ratio = largest > 300_000 ? Math.min(base, 0.5) : base;
    const worst = [...withSource].sort(
      (left, right) =>
        (right.structure?.largestSourceFileBytes ?? 0) -
        (left.structure?.largestSourceFileBytes ?? 0),
    )[0];
    return {
      availability: "available",
      ratio,
      detail: `Largest source file is ${String(Math.round(largest / 1024))} KB.`,
      evidenceIds: [
        context.add({
          suffix: "largest",
          polarity: largest <= 60_000 ? "positive" : largest >= 200_000 ? "negative" : "neutral",
          title: `Largest single source file: ${String(Math.round(largest / 1024))} KB`,
          detail: "File size is the only maintainability signal a file tree can honestly supply.",
          value: Math.round(largest / 1024),
          repository: worst?.summary.fullName ?? null,
          sourceUrl: worst?.summary.htmlUrl ?? context.signals.snapshot.profile.htmlUrl,
        }),
      ],
    };
  },

  "craft.tooling.ci": (context) => {
    const analyzed = analyzedOrNull(context.signals);
    if (analyzed === null) return unavailable(NO_TREE);
    const withCi = analyzed.filter((repository) => repository.structure?.hasCi === true);
    const ratio = withCi.length / analyzed.length;
    const systems = [
      ...new Set(withCi.flatMap((repository) => repository.structure?.ciSystems ?? [])),
    ].sort();
    return {
      availability: "available",
      ratio,
      detail: `${String(withCi.length)} of ${String(analyzed.length)} inspected repositories configure CI.`,
      evidenceIds: [
        context.add({
          suffix: "ratio",
          polarity: ratio >= 0.67 ? "positive" : ratio > 0 ? "neutral" : "negative",
          title:
            withCi.length === 0
              ? `No CI configuration in any of the ${String(analyzed.length)} inspected repositories`
              : `CI configured in ${String(withCi.length)} of ${String(analyzed.length)} inspected repositories`,
          detail:
            systems.length === 0
              ? "No CI configuration file was found."
              : `Detected: ${systems.join(", ")}.`,
          value: `${String(withCi.length)}/${String(analyzed.length)}`,
          sourceUrl: context.signals.snapshot.profile.htmlUrl,
        }),
      ],
    };
  },

  "craft.tooling.lint": (context) =>
    applicabilityGated(context, {
      suffix: "lint",
      applies: (repository) => hasMainstreamLinter(repository.summary.primaryLanguage),
      satisfied: (repository) => repository.structure?.hasLinting === true,
      title: "linting or formatting configuration",
      skipped: "No inspected repository uses a language with a mainstream linter.",
    }),

  "craft.tooling.typing": (context) =>
    applicabilityGated(context, {
      suffix: "typing",
      applies: (repository) => usesGradualTyping(repository.summary.primaryLanguage),
      satisfied: (repository) => repository.structure?.hasTypeChecking === true,
      title: "type-checking configuration",
      skipped:
        "No inspected repository uses a gradually typed language, so a type checker is not expected.",
    }),

  "craft.tooling.build": (context) =>
    applicabilityGated(context, {
      suffix: "build",
      applies: (repository) => repository.structure?.hasManifest === true,
      satisfied: (repository) => repository.structure?.hasLockfile === true,
      title: "a dependency lockfile beside the manifest",
      skipped: "No inspected repository carries a package manifest.",
    }),

  "craft.tooling.automation": (context) => {
    const analyzed = analyzedOrNull(context.signals);
    if (analyzed === null) return unavailable(NO_TREE);
    const automated = analyzed.filter((repository) => {
      const structure = repository.structure;
      if (structure === null) return false;
      return (
        structure.hasAutomation ||
        structure.hasReleaseAutomation ||
        structure.hasDependencyAutomation
      );
    });
    const ratio = automated.length / analyzed.length;
    return {
      availability: "available",
      ratio,
      detail: `${String(automated.length)} of ${String(analyzed.length)} inspected repositories carry project automation.`,
      evidenceIds: [
        context.add({
          suffix: "ratio",
          polarity: ratio >= 0.5 ? "positive" : ratio > 0 ? "neutral" : "negative",
          title: `Automation in ${String(automated.length)} of ${String(analyzed.length)} inspected repositories`,
          detail: "Makefiles, container definitions, pre-commit, release or dependency automation.",
          value: `${String(automated.length)}/${String(analyzed.length)}`,
          sourceUrl: context.signals.snapshot.profile.htmlUrl,
        }),
      ],
    };
  },

  "craft.hygiene.organization": (context) => {
    const analyzed = analyzedOrNull(context.signals);
    if (analyzed === null) return unavailable(NO_TREE);
    const scores = analyzed.map((repository) => {
      const structure = repository.structure;
      if (structure === null) return 0;
      return (
        (structure.separatesSourceFromTests ? 0.4 : 0) +
        (structure.committedBuildOutput ? 0 : 0.3) +
        (structure.rootFileCount <= 25 ? 0.15 : 0) +
        (structure.committedDependencyDirectory ? 0 : 0.15)
      );
    });
    const ratio = clampUnit(mean(scores));
    const messy = analyzed.filter(
      (repository) =>
        repository.structure?.committedDependencyDirectory === true ||
        repository.structure?.committedBuildOutput === true,
    );
    const evidenceIds = [
      context.add({
        suffix: "layout",
        polarity: ratio >= 0.7 ? "positive" : ratio >= 0.45 ? "neutral" : "negative",
        title: `Repository layout scores ${String(Math.round(ratio * 100))}%`,
        detail:
          "Source and tests separated, no committed build output, no committed dependency directory, a readable repository root.",
        value: Math.round(ratio * 100),
        sourceUrl: context.signals.snapshot.profile.htmlUrl,
      }),
    ];
    const firstMessy = messy[0];
    if (firstMessy !== undefined) {
      evidenceIds.push(
        context.add({
          suffix: "committed-artifacts",
          polarity: "negative",
          title: `${firstMessy.summary.name} has build output or dependencies committed`,
          detail: "Checked-in artefacts make a repository harder to review and to trust.",
          repository: firstMessy.summary.fullName,
          sourceUrl: firstMessy.summary.htmlUrl,
        }),
      );
    }
    return {
      availability: "available",
      ratio,
      detail: `Repository layout scores ${String(Math.round(ratio * 100))}% across inspected repositories.`,
      evidenceIds,
    };
  },

  "craft.hygiene.documentation": (context) => {
    const analyzed = analyzedOrNull(context.signals);
    if (analyzed === null) return unavailable(NO_TREE);
    const scores = analyzed.map((repository) => {
      const structure = repository.structure;
      if (structure === null) return 0;
      return (
        (structure.hasReadme ? 0.6 : 0) +
        (structure.hasDocsDirectory || structure.documentationFileCount >= 3 ? 0.25 : 0) +
        (structure.hasContributingGuide ? 0.15 : 0)
      );
    });
    const ratio = clampUnit(mean(scores));
    const withReadme = analyzed.filter((repository) => repository.structure?.hasReadme === true);
    return {
      availability: "available",
      ratio,
      detail: `${String(withReadme.length)} of ${String(analyzed.length)} inspected repositories document themselves.`,
      evidenceIds: [
        context.add({
          suffix: "readme",
          polarity: ratio >= 0.7 ? "positive" : ratio >= 0.4 ? "neutral" : "negative",
          title: `${String(withReadme.length)} of ${String(analyzed.length)} inspected repositories have a README`,
          detail: "Documentation credit also counts a docs directory and a contribution guide.",
          value: `${String(withReadme.length)}/${String(analyzed.length)}`,
          sourceUrl: context.signals.snapshot.profile.htmlUrl,
        }),
      ],
    };
  },

  "craft.hygiene.dependencies": (context) =>
    applicabilityGated(context, {
      suffix: "dependencies",
      applies: (repository) => repository.structure?.hasManifest === true,
      satisfied: (repository) =>
        repository.structure?.hasLockfile === true &&
        repository.structure.committedDependencyDirectory === false,
      title: "a lockfile and no committed dependency directory",
      skipped: "No inspected repository declares dependencies.",
    }),

  "craft.hygiene.releases": (context) =>
    applicabilityGated(context, {
      suffix: "releases",
      applies: (repository) =>
        repository.structure?.hasManifest === true ||
        repository.summary.homepage !== null ||
        repository.summary.topics.length > 0,
      satisfied: (repository) => repository.releaseCount > 0,
      title: "at least one published release",
      skipped: "No inspected repository looks intended for distribution.",
    }),

  "craft.hygiene.abandonment": (context) => {
    const { signals } = context;
    if (signals.substantial.length === 0) {
      return unavailable("No substantial repository exists to judge abandonment against.");
    }
    const abandoned = signals.abandoned.length;
    // Capped so a history of experiments cannot erase current work (PLANNING.md §4.5).
    const ratio = inversePenalty(abandoned, Math.max(3, signals.substantial.length * 0.6));
    const evidenceIds = [
      context.add({
        suffix: "count",
        polarity: abandoned === 0 ? "positive" : abandoned >= 3 ? "negative" : "neutral",
        title:
          abandoned === 0
            ? "No abandoned substantial projects"
            : `${String(abandoned)} abandoned substantial ${abandoned === 1 ? "project" : "projects"}`,
        detail:
          "Abandoned means substantial, original, not archived, over a year old and untouched for a year.",
        value: abandoned,
        sourceUrl: profileUrl(signals),
      }),
    ];
    if (signals.archivedCount > 0) {
      evidenceIds.push(
        context.add({
          suffix: "archived",
          polarity: "positive",
          title: `${String(signals.archivedCount)} archived ${signals.archivedCount === 1 ? "project" : "projects"} treated as finished`,
          detail: "Archiving is a deliberate act, so it never counts as abandonment.",
          value: signals.archivedCount,
          sourceUrl: profileUrl(signals),
        }),
      );
    }
    return {
      availability: "available",
      ratio,
      detail:
        abandoned === 0
          ? "No abandoned substantial projects."
          : `${String(abandoned)} abandoned substantial ${abandoned === 1 ? "project" : "projects"}.`,
      evidenceIds,
    };
  },
};

interface ApplicabilityOptions {
  readonly suffix: string;
  readonly applies: (repository: RepositoryEvidence) => boolean;
  readonly satisfied: (repository: RepositoryEvidence) => boolean;
  readonly title: string;
  readonly skipped: string;
}

/**
 * SCORECARD.md CRAFT D: absence only counts where the tool is appropriate. A
 * repository that fails `applies` leaves the denominator instead of scoring zero, and
 * when nothing applies the whole metric leaves the scoring basis (ADR 0004 D4).
 */
function applicabilityGated(context: MetricContext, options: ApplicabilityOptions): MetricOutcome {
  const analyzed = analyzedOrNull(context.signals);
  if (analyzed === null) return unavailable(NO_TREE);
  const applicable = analyzed.filter(options.applies);
  if (applicable.length === 0) return unavailable(options.skipped);
  const satisfied = applicable.filter(options.satisfied);
  const ratio = satisfied.length / applicable.length;
  return {
    availability: "available",
    ratio,
    detail: `${String(satisfied.length)} of ${String(applicable.length)} applicable repositories have ${options.title}.`,
    evidenceIds: [
      context.add({
        suffix: options.suffix,
        polarity: ratio >= 0.67 ? "positive" : ratio > 0 ? "neutral" : "negative",
        title: `${String(satisfied.length)} of ${String(applicable.length)} applicable repositories have ${options.title}`,
        detail: `${String(analyzed.length - applicable.length)} inspected ${
          analyzed.length - applicable.length === 1 ? "repository was" : "repositories were"
        } excluded because the tool is not appropriate there.`,
        value: `${String(satisfied.length)}/${String(applicable.length)}`,
        sourceUrl: context.signals.snapshot.profile.htmlUrl,
      }),
    ],
  };
}

export interface MetricScoringResult {
  readonly metrics: readonly MetricResult[];
  readonly evidence: readonly EvidenceItem[];
}

export function scoreMetrics(signals: ProfileSignals): MetricScoringResult {
  const context = new MetricContext(signals);
  const metrics: MetricResult[] = [];

  for (const definition of METRIC_DEFINITIONS) {
    const structural = UNMEASURABLE_IN_FAST_SCAN[definition.id];
    if (structural !== undefined) {
      metrics.push({
        id: definition.id,
        category: definition.category,
        label: definition.label,
        weight: definition.weight,
        availability: "unavailable",
        earned: 0,
        ratio: 0,
        detail: structural,
        limitation: structural,
        evidenceIds: [],
      });
      continue;
    }

    const scorer = SCORERS[definition.id];
    if (scorer === undefined) {
      throw new Error(`No fast-scan scorer registered for ${definition.id}`);
    }
    context.begin(definition.id, definition.category);
    const outcome = scorer(context);
    const ratio = outcome.availability === "unavailable" ? 0 : clampUnit(outcome.ratio);
    metrics.push({
      id: definition.id,
      category: definition.category,
      label: definition.label,
      weight: definition.weight,
      availability: outcome.availability,
      earned: round(ratio * definition.weight, 3),
      ratio: round(ratio, 4),
      detail: outcome.detail,
      ...(outcome.limitation === undefined ? {} : { limitation: outcome.limitation }),
      evidenceIds: outcome.evidenceIds,
    });
  }

  return { metrics, evidence: context.collected };
}
