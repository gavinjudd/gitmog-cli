import { createSnapshotCache, snapshotCacheKey, type SnapshotCache } from "./cache.js";
import { digest } from "./digest.js";
import { GithubHttpClient, type GithubHttpOptions } from "./http.js";
import {
  normalizeCommits,
  normalizeEvent,
  normalizeLanguages,
  normalizeProfile,
  normalizeReleases,
  normalizeRepository,
  normalizeTree,
} from "./normalize.js";
import { isEligibleRepository, selectRepositoriesForInspection } from "./select.js";
import {
  EVENTS_PER_PAGE,
  type CollectionResult,
  type CommitSample,
  type EventWindow,
  type PersistentCachePolicy,
  type ProfileSnapshot,
  type PublicEvent,
  type RepositoryInspection,
  type RepositorySummary,
} from "./types.js";
import { parseGithubUsername } from "./username.js";

/**
 * Per-profile request budget. Unauthenticated public REST is 60 requests per hour per
 * address, so a tokenless battle must fit two profiles inside a single-digit fraction
 * of that. Every number here is a hard cap, not a target.
 */
export const REQUEST_BUDGETS = Object.freeze({
  anonymous: Object.freeze({
    maxRequests: 16,
    repositoryPages: 2,
    eventPages: 2,
    inspectedRepositories: 3,
  }),
  authenticated: Object.freeze({
    maxRequests: 16,
    repositoryPages: 2,
    eventPages: 2,
    inspectedRepositories: 3,
  }),
});

const REPOSITORY_PAGE_SIZE = 100;
const RELEASE_PAGE_SIZE = 10;
const COMMIT_PAGE_SIZE = 100;
/** Requests reserved for repository inspection and the single commit sample before
 * optional event pages may be spent. */
const perRepositoryRequests = 3;

export interface CollectProfileOptions extends GithubHttpOptions {
  readonly now?: (() => number) | undefined;
  /** Pass `null` to bypass caching entirely, which the offline suite does. */
  readonly cache?: SnapshotCache<ProfileSnapshot> | null | undefined;
  /** Explicit persistent snapshot read/write policy. */
  readonly cachePolicy?: PersistentCachePolicy | undefined;
  /** Operational lifecycle hook for CLI progress. It carries no source bytes and is
   * excluded from snapshots, cache identity, scoring, and hashes. */
  readonly onRepositoryRankingStart?: ((input: { readonly cached: boolean }) => void) | undefined;
}

const defaultCache = createSnapshotCache<ProfileSnapshot>();

export function defaultSnapshotCache(): SnapshotCache<ProfileSnapshot> {
  return defaultCache;
}

export async function collectProfileSnapshot(
  handle: string,
  options: CollectProfileOptions = {},
): Promise<CollectionResult> {
  const username = parseGithubUsername(handle);
  if (username === null) {
    return {
      ok: false,
      error: {
        code: "invalid_handle",
        message: `"${handle.slice(0, 40)}" is not a GitHub handle.`,
      },
    };
  }

  const authenticated = (options.token ?? "").trim() !== "";
  const budget = authenticated ? REQUEST_BUDGETS.authenticated : REQUEST_BUDGETS.anonymous;
  const cache = options.cache === undefined ? defaultCache : options.cache;
  const cacheKey = snapshotCacheKey({
    login: username,
    authenticated,
    maxInspectedRepositories: budget.inspectedRepositories,
  });

  const cachePolicy = options.cachePolicy ?? { read: true, write: true };
  const cached = cachePolicy.read ? cache?.get(cacheKey) : undefined;
  if (cached !== undefined) {
    options.onRepositoryRankingStart?.({ cached: true });
    return { ok: true, snapshot: cached, requestsUsed: 0 };
  }

  const now = options.now ?? Date.now;
  const collectedAtMs = now();
  const collectedAt = new Date(collectedAtMs).toISOString();
  const referenceDate = collectedAt.slice(0, 10);
  const referenceMs = Date.parse(`${referenceDate}T00:00:00.000Z`);

  const client = new GithubHttpClient({
    ...options,
    maxRequests: options.maxRequests ?? budget.maxRequests,
  });
  const degradations: string[] = [];

  const profileResponse = await client.get<unknown>(`/users/${encodeURIComponent(username)}`);
  if (!profileResponse.ok) return { ok: false, error: profileResponse.error };
  const profile = normalizeProfile(profileResponse.data);
  if (profile === null) {
    return {
      ok: false,
      error: { code: "malformed_response", message: "GitHub returned an unreadable profile." },
    };
  }

  const repositories: RepositorySummary[] = [];
  let repositoryListComplete = true;
  for (let page = 1; page <= budget.repositoryPages; page += 1) {
    const response = await client.get<unknown>(`/users/${encodeURIComponent(username)}/repos`, {
      per_page: String(REPOSITORY_PAGE_SIZE),
      page: String(page),
      sort: "pushed",
      direction: "desc",
      type: "owner",
    });
    if (!response.ok) {
      if (page === 1) return { ok: false, error: response.error };
      degradations.push("Repository listing stopped early after a GitHub error.");
      repositoryListComplete = false;
      break;
    }
    const batch = Array.isArray(response.data) ? response.data : [];
    for (const raw of batch) {
      const repository = normalizeRepository(raw);
      if (repository !== null) repositories.push(repository);
    }
    if (batch.length < REPOSITORY_PAGE_SIZE) break;
    if (page === budget.repositoryPages) {
      repositoryListComplete = false;
      degradations.push(
        `Only the ${String(budget.repositoryPages * REPOSITORY_PAGE_SIZE)} most recently pushed repositories were listed.`,
      );
    }
  }

  const events: PublicEvent[] = [];
  let eventsAvailable = true;
  let eventsTruncated = false;
  for (let page = 1; page <= budget.eventPages; page += 1) {
    if (!client.canSpend(1 + budget.inspectedRepositories * perRepositoryRequests + 1)) {
      eventsTruncated = true;
      break;
    }
    const response = await client.get<unknown>(
      `/users/${encodeURIComponent(username)}/events/public`,
      { per_page: String(EVENTS_PER_PAGE), page: String(page) },
    );
    if (!response.ok) {
      if (page === 1) {
        eventsAvailable = false;
        degradations.push("Public activity events were not readable for this account.");
      }
      break;
    }
    const batch = Array.isArray(response.data) ? response.data.slice(0, EVENTS_PER_PAGE) : [];
    for (const raw of batch) {
      const event = normalizeEvent(raw);
      if (event !== null) events.push(event);
    }
    if (batch.length < EVENTS_PER_PAGE) break;
    if (page === budget.eventPages) eventsTruncated = true;
  }
  if (eventsTruncated) {
    degradations.push("The public activity window was capped before GitHub ran out of events.");
  }

  options.onRepositoryRankingStart?.({ cached: false });
  const eligible = repositories.filter(isEligibleRepository);
  const selected = selectRepositoriesForInspection(
    repositories,
    budget.inspectedRepositories,
    referenceMs,
  );

  const inspections: RepositoryInspection[] = [];
  for (const repository of selected) {
    if (!client.canSpend(perRepositoryRequests)) {
      degradations.push(
        `The request budget stopped repository inspection after ${String(inspections.length)} of ${String(selected.length)} selected repositories.`,
      );
      break;
    }
    inspections.push(await inspectRepository(client, repository));
  }

  // One commit sample, from the strongest repository only. The public events endpoint
  // stopped returning commit payloads, so this is the only tokenless source of real
  // commit messages, and one request is all the budget allows.
  let commitSample: CommitSample | null = null;
  const sampleTarget = selected[0];
  if (sampleTarget !== undefined && client.canSpend(1)) {
    const owner = sampleTarget.fullName.split("/")[0] ?? "";
    const response = await client.get<unknown>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(sampleTarget.name)}/commits`,
      {
        author: username,
        per_page: String(COMMIT_PAGE_SIZE),
      },
    );
    if (response.ok) {
      const commits = normalizeCommits(response.data);
      commitSample = {
        repository: sampleTarget.fullName,
        repositoryUrl: `${sampleTarget.htmlUrl}/commits`,
        commits,
        truncated: commits.length >= COMMIT_PAGE_SIZE,
      };
    } else {
      degradations.push("Commit messages were not readable for the sampled repository.");
    }
  } else if (sampleTarget !== undefined) {
    degradations.push("The request budget did not allow a commit-message sample.");
  }

  const eventWindow = describeEventWindow(events, eventsTruncated);
  const evidence = {
    profile,
    repositories,
    repositoryListComplete,
    eligibleRepositoryCount: eligible.length,
    selectedRepositories: inspections.map((inspection) => inspection.name),
    inspections,
    events,
    eventsAvailable,
    eventWindow,
    commitSample,
    referenceDate,
    degradations,
  };

  const snapshot: ProfileSnapshot = {
    ...evidence,
    snapshotKey: digest(evidence),
    collectedAt,
    budget: {
      maxRequests: client.maxRequests,
      usedRequests: client.requestsUsed,
      maxInspectedRepositories: budget.inspectedRepositories,
      inspectedRepositories: inspections.length,
      exhausted: !client.canSpend(1),
    },
    rateLimit: client.rateLimit,
  };

  if (cachePolicy.write) cache?.set(cacheKey, snapshot);
  return { ok: true, snapshot, requestsUsed: client.requestsUsed };
}

async function inspectRepository(
  client: GithubHttpClient,
  repository: RepositorySummary,
): Promise<RepositoryInspection> {
  const owner = repository.fullName.split("/")[0] ?? "";
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository.name)}`;
  const failures: string[] = [];

  const languagesResponse = await client.get<unknown>(`${base}/languages`);
  if (!languagesResponse.ok) failures.push("languages");
  const languageBytes = languagesResponse.ok ? normalizeLanguages(languagesResponse.data) : {};

  const releasesResponse = await client.get<unknown>(`${base}/releases`, {
    per_page: String(RELEASE_PAGE_SIZE),
  });
  if (!releasesResponse.ok) failures.push("releases");
  const releases = releasesResponse.ok
    ? normalizeReleases(releasesResponse.data)
    : { count: 0, latestAt: null };

  const treeResponse = await client.get<unknown>(
    `${base}/git/trees/${encodeURIComponent(repository.defaultBranch)}`,
    { recursive: "1" },
  );
  if (!treeResponse.ok) failures.push("tree");
  const tree = treeResponse.ok ? normalizeTree(treeResponse.data) : null;

  return {
    name: repository.name,
    fullName: repository.fullName,
    htmlUrl: repository.htmlUrl,
    languageBytes,
    releaseCount: releases.count,
    latestReleaseAt: releases.latestAt,
    tree: tree === null ? null : tree.entries,
    treeSha: tree?.sha || null,
    treeTruncated: tree?.truncated ?? false,
    failures,
  };
}

function describeEventWindow(events: readonly PublicEvent[], truncated: boolean): EventWindow {
  let oldest: string | null = null;
  let newest: string | null = null;
  for (const event of events) {
    if (oldest === null || event.createdAt < oldest) oldest = event.createdAt;
    if (newest === null || event.createdAt > newest) newest = event.createdAt;
  }
  return { oldest, newest, truncated };
}
