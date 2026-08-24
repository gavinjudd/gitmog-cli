import {
  analyzeRepositoryTree,
  describeLanguageCoverage,
  type LanguageCoverage,
  type RepositoryStructure,
} from "@gitmog/analyzers";
import type { ProfileSnapshot, RepositorySummary } from "@gitmog/github";

import { DAY_MS, daysBetween, isoWeekKey, median } from "./curves.js";

export const ACTIVE_WEEK_WINDOW = 12;
const ACTIVE_WEEK_WINDOW_DAYS = ACTIVE_WEEK_WINDOW * 7;
/** GitHub's public events feed reaches back at most 90 days. */
const EVENT_FEED_DAYS = 90;
const ABANDONMENT_IDLE_DAYS = 365;
const ABANDONMENT_MINIMUM_AGE_DAYS = 365;

const DEVELOPMENT_EVENTS = new Set([
  "PushEvent",
  "PullRequestEvent",
  "PullRequestReviewEvent",
  "ReleaseEvent",
  "CreateEvent",
  "IssuesEvent",
  "CommitCommentEvent",
]);

const MERGE_PREFIXES = ["merge branch", "merge pull request", "merge remote-tracking", "merge tag"];

/** Below this, the commit sample is too thin to judge message hygiene. */
export const MINIMUM_COMMIT_SAMPLE = 20;

const LOW_EFFORT_MESSAGES = new Set([
  "fix",
  "fixes",
  "fixed",
  "update",
  "updates",
  "updated",
  "stuff",
  "changes",
  "change",
  "wip",
  "asdf",
  "test",
  "tests",
  "temp",
  "tmp",
  "minor",
  "cleanup",
  "misc",
  "commit",
  ".",
  "..",
  "x",
  "a",
  "final",
  "done",
  "oops",
  "typo",
]);

const REPAIR_PATTERN =
  /^(fix|fixup|hotfix|patch|correct|actually|really|revert|undo|redo|retry)\b/i;
const REVERT_PATTERN = /^revert\b/i;

export interface RepositoryEvidence {
  readonly summary: RepositorySummary;
  readonly inspected: boolean;
  readonly structure: RepositoryStructure | null;
  readonly treeTruncated: boolean;
  readonly releaseCount: number;
  readonly latestReleaseAt: string | null;
  readonly languageBytes: Readonly<Record<string, number>>;
  readonly ageDays: number;
  readonly idleDays: number;
  readonly spanDays: number;
  readonly eligible: boolean;
  readonly substantial: boolean;
  readonly abandoned: boolean;
}

export interface ProfileSignals {
  readonly snapshot: ProfileSnapshot;
  readonly referenceMs: number;
  readonly repositories: readonly RepositoryEvidence[];
  readonly eligible: readonly RepositoryEvidence[];
  readonly inspected: readonly RepositoryEvidence[];
  readonly analyzed: readonly RepositoryEvidence[];
  readonly substantial: readonly RepositoryEvidence[];
  readonly abandoned: readonly RepositoryEvidence[];
  readonly archivedCount: number;
  readonly forkCount: number;
  readonly commitMessages: readonly string[];
  readonly commitSampleSize: number;
  readonly commitSampleRepository: string | null;
  readonly commitSampleUrl: string | null;
  readonly mergeCommitRate: number;
  readonly observedPushes: number;
  readonly annualizedCommits: number;
  readonly activityWindowDays: number;
  readonly activeWeeks: number;
  readonly daysSinceLastPublicPush: number | null;
  readonly externalRepositories: readonly string[];
  readonly mergedPullRequests: number;
  readonly reviewEvents: number;
  readonly releaseEvents: number;
  readonly totalReleases: number;
  readonly languageCoverage: LanguageCoverage;
  readonly languagesObserved: readonly string[];
  /** Languages seen on substantial repositories only, so breadth means project breadth
   * rather than a pile of tiny experiments in different ecosystems. */
  readonly substantialLanguages: readonly string[];
  readonly monorepoCount: number;
  readonly releaseRepositoryCount: number;
  readonly sustainedCount: number;
  /** The largest substantial repository's share of all substantial repository bytes. */
  readonly dominantRepositoryShare: number;
  readonly hasEventEvidence: boolean;
  readonly hasTreeEvidence: boolean;
  readonly treeCoverage: number;
}

const normalizeMessage = (message: string): string =>
  message
    .split("\n")[0]
    ?.trim()
    .toLowerCase()
    .replace(/[.!]+$/, "") ?? "";

export const isMergeMessage = (message: string): boolean => {
  const normalized = normalizeMessage(message);
  return MERGE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

export const isLowEffortMessage = (message: string): boolean => {
  const normalized = normalizeMessage(message);
  if (normalized.length <= 3) return true;
  if (LOW_EFFORT_MESSAGES.has(normalized)) return true;
  return /^(fix|update|wip|test|commit)\s*\d*$/.test(normalized);
};

export const isRepairMessage = (message: string): boolean =>
  REPAIR_PATTERN.test(normalizeMessage(message));

export const isRevertMessage = (message: string): boolean =>
  REVERT_PATTERN.test(normalizeMessage(message));

/**
 * SCORECARD.md SHIP B: "No points for creating 100 empty repos." A long
 * created-to-pushed span is not substance on its own — an eleven-year-old two-file
 * repository with one recent push would otherwise qualify — so a repository must
 * clear a content anchor before the multi-signal count is even consulted.
 */
function isSubstantial(
  summary: RepositorySummary,
  structure: RepositoryStructure | null,
  releaseCount: number,
  spanDays: number,
): boolean {
  const hasContentAnchor =
    summary.sizeKb >= 50 ||
    releaseCount >= 1 ||
    (structure !== null && (structure.sourceFileCount >= 20 || structure.hasManifest));
  if (!hasContentAnchor) return false;

  let points = 0;
  if (summary.sizeKb >= 50) points += 1;
  if (summary.sizeKb >= 500) points += 1;
  if (spanDays >= 30) points += 1;
  if (spanDays >= 180) points += 1;
  if (releaseCount >= 1) points += 1;
  if (structure !== null && structure.sourceFileCount >= 20) points += 1;
  if (structure !== null && structure.hasManifest) points += 1;
  return points >= 2;
}

export function deriveSignals(snapshot: ProfileSnapshot): ProfileSignals {
  const referenceMs = Date.parse(`${snapshot.referenceDate}T00:00:00.000Z`);
  const inspectionByName = new Map(
    snapshot.inspections.map((inspection) => [inspection.name, inspection]),
  );

  const repositories: RepositoryEvidence[] = snapshot.repositories.map((summary) => {
    const inspection = inspectionByName.get(summary.name);
    const structure =
      inspection?.tree == null
        ? null
        : analyzeRepositoryTree(inspection.tree, { truncated: inspection.treeTruncated });
    const ageDays = daysBetween(summary.createdAt, referenceMs) ?? 0;
    const idleDays = daysBetween(summary.pushedAt ?? summary.updatedAt, referenceMs) ?? ageDays;
    const createdMs = Date.parse(summary.createdAt);
    const pushedMs = Date.parse(summary.pushedAt ?? summary.updatedAt);
    const spanDays =
      Number.isNaN(createdMs) || Number.isNaN(pushedMs)
        ? 0
        : Math.max(0, (pushedMs - createdMs) / DAY_MS);
    const releaseCount = inspection?.releaseCount ?? 0;
    const eligible =
      !summary.fork &&
      !summary.mirror &&
      !summary.disabled &&
      !summary.isTemplate &&
      summary.sizeKb > 0;
    const substantial = eligible && isSubstantial(summary, structure, releaseCount, spanDays);
    return {
      summary,
      inspected: inspection !== undefined,
      structure,
      treeTruncated: inspection?.treeTruncated ?? false,
      releaseCount,
      latestReleaseAt: inspection?.latestReleaseAt ?? null,
      languageBytes: inspection?.languageBytes ?? {},
      ageDays,
      idleDays,
      spanDays,
      eligible,
      substantial,
      // PLANNING.md §4.5: archived work is intentionally finished, never abandoned.
      abandoned:
        substantial &&
        !summary.archived &&
        ageDays >= ABANDONMENT_MINIMUM_AGE_DAYS &&
        idleDays >= ABANDONMENT_IDLE_DAYS,
    };
  });

  const eligible = repositories.filter((repository) => repository.eligible);
  const inspected = repositories.filter((repository) => repository.inspected);
  const analyzed = inspected.filter((repository) => repository.structure !== null);

  const pushEvents = snapshot.events.filter(
    (event) => event.type === "PushEvent" && !event.isBotActor,
  );
  const observedPushes = pushEvents.length;

  // ADR 0004 D3: one push counts as one commit. That is a deliberate lower bound —
  // the public events endpoint no longer reports how many commits a push contained,
  // and under-counting is the only direction that cannot inflate a score.
  const accountAgeDays = daysBetween(snapshot.profile.createdAt, referenceMs) ?? EVENT_FEED_DAYS;
  const activityWindowDays = eventWindowDays(snapshot, accountAgeDays, referenceMs);
  const annualizedCommits = Math.min(
    600,
    activityWindowDays <= 0 ? 0 : (observedPushes * 365) / activityWindowDays,
  );

  const sampledCommits = (snapshot.commitSample?.commits ?? []).filter(
    (commit) => !commit.isBotAuthor,
  );
  const nonMergeCommits = sampledCommits.filter(
    (commit) => commit.parentCount <= 1 && !isMergeMessage(commit.message),
  );
  const mergeCommitRate =
    sampledCommits.length === 0
      ? 0
      : (sampledCommits.length - nonMergeCommits.length) / sampledCommits.length;
  const humanMessages = nonMergeCommits.map((commit) => commit.message);

  const activeWeekKeys = new Set<string>();
  for (const event of snapshot.events) {
    if (!DEVELOPMENT_EVENTS.has(event.type) || event.isBotActor) continue;
    const age = daysBetween(event.createdAt, referenceMs);
    if (age === null || age > ACTIVE_WEEK_WINDOW_DAYS) continue;
    const key = isoWeekKey(event.createdAt);
    if (key !== "") activeWeekKeys.add(key);
  }

  const pushDates = [
    ...repositories.map((repository) => repository.summary.pushedAt),
    ...snapshot.events
      .filter((event) => event.type === "PushEvent")
      .map((event) => event.createdAt),
  ].filter((value): value is string => value !== null && value !== "");
  const daysSinceLastPublicPush =
    pushDates.length === 0
      ? null
      : Math.min(...pushDates.map((value) => daysBetween(value, referenceMs) ?? Infinity));

  const ownedFullNames = new Set(
    snapshot.repositories.map((repository) => repository.fullName.toLowerCase()),
  );
  const login = snapshot.profile.login.toLowerCase();
  const externalRepositories = new Set<string>();
  let mergedPullRequests = 0;
  let reviewEvents = 0;
  let releaseEvents = 0;
  for (const event of snapshot.events) {
    if (event.isBotActor) continue;
    const owner = event.repoFullName.split("/")[0]?.toLowerCase() ?? "";
    const external =
      event.repoFullName !== "" &&
      owner !== login &&
      !ownedFullNames.has(event.repoFullName.toLowerCase());
    if (external && DEVELOPMENT_EVENTS.has(event.type))
      externalRepositories.add(event.repoFullName);
    if (event.type === "PullRequestEvent" && event.merged) mergedPullRequests += 1;
    if (event.type === "PullRequestReviewEvent") reviewEvents += 1;
    if (event.type === "ReleaseEvent") releaseEvents += 1;
  }

  const languageNames = new Set<string>();
  for (const repository of repositories) {
    if (repository.summary.primaryLanguage !== null) {
      languageNames.add(repository.summary.primaryLanguage);
    }
    for (const language of Object.keys(repository.languageBytes)) languageNames.add(language);
  }

  const substantial = repositories.filter((repository) => repository.substantial);
  const substantialLanguages = new Set<string>();
  for (const repository of substantial) {
    if (repository.summary.primaryLanguage !== null) {
      substantialLanguages.add(repository.summary.primaryLanguage);
    }
    for (const language of Object.keys(repository.languageBytes)) {
      substantialLanguages.add(language);
    }
  }
  const substantialBytes = substantial.reduce(
    (total, repository) => total + repository.summary.sizeKb,
    0,
  );
  const largestSubstantial = substantial.reduce(
    (largest, repository) => Math.max(largest, repository.summary.sizeKb),
    0,
  );

  const treeCoverage =
    snapshot.selectedRepositories.length === 0
      ? 0
      : analyzed.length / snapshot.selectedRepositories.length;

  return {
    snapshot,
    referenceMs,
    repositories,
    eligible,
    inspected,
    analyzed,
    substantial,
    abandoned: repositories.filter((repository) => repository.abandoned),
    archivedCount: repositories.filter((repository) => repository.summary.archived).length,
    forkCount: repositories.filter((repository) => repository.summary.fork).length,
    commitMessages: humanMessages,
    commitSampleSize: sampledCommits.length,
    commitSampleRepository: snapshot.commitSample?.repository ?? null,
    commitSampleUrl: snapshot.commitSample?.repositoryUrl ?? null,
    mergeCommitRate,
    observedPushes,
    annualizedCommits,
    activityWindowDays,
    // An 84-day window can touch 13 ISO week labels at its two partial edges. The
    // scorecard calls this a 12-week window, so the displayed count must never say
    // "13 of 12". The scoring curve already saturated at 12; this corrects the
    // diagnostic without changing any numeric score.
    activeWeeks: Math.min(ACTIVE_WEEK_WINDOW, activeWeekKeys.size),
    daysSinceLastPublicPush:
      daysSinceLastPublicPush === null || !Number.isFinite(daysSinceLastPublicPush)
        ? null
        : daysSinceLastPublicPush,
    externalRepositories: [...externalRepositories].sort(),
    mergedPullRequests,
    reviewEvents,
    releaseEvents,
    totalReleases: repositories.reduce((total, repository) => total + repository.releaseCount, 0),
    languageCoverage: describeLanguageCoverage([...languageNames]),
    languagesObserved: [...languageNames].sort(),
    substantialLanguages: [...substantialLanguages].sort(),
    monorepoCount: analyzed.filter((repository) => repository.structure?.isMonorepo === true)
      .length,
    releaseRepositoryCount: inspected.filter((repository) => repository.releaseCount > 0).length,
    sustainedCount: substantial.filter((repository) => repository.spanDays >= 180).length,
    dominantRepositoryShare: substantialBytes === 0 ? 0 : largestSubstantial / substantialBytes,
    hasEventEvidence: snapshot.eventsAvailable && snapshot.events.length > 0,
    hasTreeEvidence: analyzed.length > 0,
    treeCoverage,
  };
}

/**
 * ADR 0004 D3. When the collector hit its page cap the feed is dense and the observed
 * span is the real window; otherwise GitHub returned everything it has, which is at
 * most the last 90 days, bounded below by how long the account has existed.
 */
function eventWindowDays(
  snapshot: ProfileSnapshot,
  accountAgeDays: number,
  referenceMs: number,
): number {
  if (!snapshot.eventsAvailable || snapshot.events.length === 0) return EVENT_FEED_DAYS;
  if (snapshot.eventWindow.truncated) {
    const oldest = daysBetween(snapshot.eventWindow.oldest, referenceMs);
    return Math.max(7, oldest ?? EVENT_FEED_DAYS);
  }
  return Math.min(EVENT_FEED_DAYS, Math.max(14, accountAgeDays));
}

export function commitMessageStatistics(messages: readonly string[]): {
  readonly count: number;
  readonly medianLength: number;
  readonly lowEffortRate: number;
  readonly repairRate: number;
  readonly revertRate: number;
} {
  if (messages.length === 0) {
    return { count: 0, medianLength: 0, lowEffortRate: 0, repairRate: 0, revertRate: 0 };
  }
  const subjects = messages.map((message) => message.split("\n")[0]?.trim() ?? "");
  return {
    count: messages.length,
    medianLength: median(subjects.map((subject) => subject.length)),
    lowEffortRate: subjects.filter(isLowEffortMessage).length / subjects.length,
    repairRate: subjects.filter(isRepairMessage).length / subjects.length,
    revertRate: subjects.filter(isRevertMessage).length / subjects.length,
  };
}
