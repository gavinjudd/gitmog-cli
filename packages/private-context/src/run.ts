import {
  GithubHttpClient,
  collectQualitySource,
  digest,
  isEligibleRepository,
  normalizeReleases,
  normalizeRepository,
  normalizeTree,
  type ProfileSnapshot,
  type RepositoryInspection,
  type RepositorySummary,
} from "@gitmog/github";
import {
  analyzeQualityParseResults,
  parseQualitySourcesIsolated,
  type ParseQualityResult,
  type QualityReading,
  type QualitySourceInput,
} from "@gitmog/quality-judge";

import { privateContextInstallationUrl } from "./config.js";
import { createPrivateArtifactScanner, privateAggregateShapeIsSafe } from "./privacy.js";
import {
  PRIVATE_CONTEXT_MAX_REPOSITORIES,
  PRIVATE_CONTEXT_MAX_REQUESTS,
  PRIVATE_CONTEXT_MAX_REQUESTS_PER_REPOSITORY,
  PRIVATE_CONTEXT_REQUEST_VERSION,
  PRIVATE_CONTEXT_RESULT_VERSION,
  type PrivateAggregateReceipt,
  type PrivateContextAppConfig,
  type PrivateContextLimitation,
  type PrivateContextResult,
  type PrivateContextRunResult,
  type PrivateQualityReading,
  type PrivateRepositoryRelationship,
  type PrivateRequestTelemetry,
} from "./types.js";

interface Installation {
  readonly id: number;
  readonly appId: string;
  readonly repositorySelection: "selected" | "all";
}

interface PrivateRepository {
  readonly summary: RepositorySummary;
  readonly visibility: "private" | "internal";
  readonly ownerLogin: string;
  readonly ownerType: "User" | "Organization";
  readonly permissions: {
    readonly admin: boolean;
    readonly maintain: boolean;
    readonly push: boolean;
    readonly pull: boolean;
  };
  readonly maintained: boolean;
}

interface RequestCounters {
  total: number;
  identity: number;
  installations: number;
  repositoryList: number;
  repositoryMetadata: number;
  source: number;
  attribution: number;
}

export interface RunPrivateContextOptions {
  readonly handles: readonly [string] | readonly [string, string];
  readonly token: string;
  readonly config: PrivateContextAppConfig;
  readonly fetchImpl?: typeof globalThis.fetch | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly now?: (() => number) | undefined;
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const bool = (value: unknown): boolean => value === true;

const safeInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;

const parseUser = (value: unknown): string | null => {
  const login = record(value)?.login;
  return typeof login === "string" && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(login)
    ? login
    : null;
};

const exactInstallationPermissions = (value: unknown): boolean => {
  const permissions = record(value);
  if (permissions === null) return false;
  const keys = Object.keys(permissions).toSorted();
  if (keys.length !== 2 || keys[0] !== "contents" || keys[1] !== "metadata") return false;
  return permissions.contents === "read" && permissions.metadata === "read";
};

const parseInstallations = (value: unknown, appId: string): readonly Installation[] | null => {
  const raw = record(value)?.installations;
  if (!Array.isArray(raw)) return null;
  const installations: Installation[] = [];
  for (const item of raw) {
    const entry = record(item);
    if (entry === null) continue;
    const rawAppId = entry.app_id;
    const itemAppId =
      typeof rawAppId === "string"
        ? rawAppId
        : typeof rawAppId === "number" && Number.isSafeInteger(rawAppId)
          ? String(rawAppId)
          : null;
    if (itemAppId !== appId) continue;
    const id = safeInteger(entry.id);
    const selection = entry.repository_selection;
    if (id === null || (selection !== "selected" && selection !== "all")) return null;
    if (!exactInstallationPermissions(entry.permissions)) return null;
    installations.push({ id, appId, repositorySelection: selection });
  }
  return installations;
};

const parsePrivateRepository = (value: unknown, login: string): PrivateRepository | null => {
  const entry = record(value);
  if (entry === null) return null;
  const visibility = entry.visibility;
  if (visibility !== "private" && visibility !== "internal") return null;
  if (visibility === "private" && entry.private !== true) return null;
  const owner = record(entry.owner);
  const ownerLogin = owner?.login;
  const ownerType = owner?.type;
  if (
    typeof ownerLogin !== "string" ||
    (ownerType !== "User" && ownerType !== "Organization") ||
    (ownerType === "User" && ownerLogin.toLowerCase() !== login.toLowerCase())
  )
    return null;
  const permissions = record(entry.permissions);
  if (permissions === null) return null;
  const summary = normalizeRepository(value);
  if (summary === null || !isEligibleRepository(summary)) return null;
  const normalizedPermissions = {
    admin: bool(permissions.admin),
    maintain: bool(permissions.maintain),
    push: bool(permissions.push),
    pull: bool(permissions.pull),
  };
  return {
    summary: { ...summary, stars: 0, forks: 0 },
    visibility,
    ownerLogin,
    ownerType,
    permissions: normalizedPermissions,
    maintained:
      ownerType === "User" || normalizedPermissions.admin || normalizedPermissions.maintain,
  };
};

const parseRevision = (
  value: unknown,
): { readonly commitSha: string; readonly treeSha: string } | null => {
  const entry = record(value);
  const tree = record(record(entry?.commit)?.tree);
  const commitSha = entry?.sha;
  const treeSha = tree?.sha;
  return typeof commitSha === "string" &&
    /^[0-9a-f]{40}$/u.test(commitSha) &&
    typeof treeSha === "string" &&
    /^[0-9a-f]{40}$/u.test(treeSha)
    ? { commitSha, treeSha }
    : null;
};

const privateRank = (repositories: readonly PrivateRepository[]): readonly PrivateRepository[] =>
  [...repositories].toSorted((left, right) => {
    const leftSubstantial = left.summary.sizeKb >= 64 ? 1 : 0;
    const rightSubstantial = right.summary.sizeKb >= 64 ? 1 : 0;
    if (rightSubstantial !== leftSubstantial) return rightSubstantial - leftSubstantial;
    const leftPushed = Date.parse(left.summary.pushedAt ?? left.summary.updatedAt);
    const rightPushed = Date.parse(right.summary.pushedAt ?? right.summary.updatedAt);
    if (rightPushed !== leftPushed) return rightPushed - leftPushed;
    if (right.summary.sizeKb !== left.summary.sizeKb)
      return right.summary.sizeKb - left.summary.sizeKb;
    return left.summary.fullName
      .normalize("NFC")
      .localeCompare(right.summary.fullName.normalize("NFC"));
  });

const repositoryKeyForUrl = (url: URL): string | null => {
  const match = /^\/repos\/([^/]+)\/([^/]+)(?:\/|$)/u.exec(url.pathname);
  return match === null
    ? null
    : `${decodeURIComponent(match[1] as string)}/${decodeURIComponent(match[2] as string)}`.toLowerCase();
};

const boundedFetch =
  (
    fetchImpl: typeof globalThis.fetch,
    counters: RequestCounters,
    perRepository: Map<string, number>,
  ): typeof globalThis.fetch =>
  async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const repositoryKey = repositoryKeyForUrl(url);
    if (
      counters.total >= PRIVATE_CONTEXT_MAX_REQUESTS ||
      (repositoryKey !== null &&
        (perRepository.get(repositoryKey) ?? 0) >= PRIVATE_CONTEXT_MAX_REQUESTS_PER_REPOSITORY)
    ) {
      return Response.json(
        { message: "Private Context request budget exhausted." },
        { status: 403 },
      );
    }
    counters.total += 1;
    if (repositoryKey !== null)
      perRepository.set(repositoryKey, (perRepository.get(repositoryKey) ?? 0) + 1);
    if (url.pathname === "/user") counters.identity += 1;
    else if (url.pathname === "/user/installations") counters.installations += 1;
    else if (/^\/user\/installations\/\d+\/repositories$/u.test(url.pathname))
      counters.repositoryList += 1;
    else if (/\/git\/blobs\//u.test(url.pathname)) counters.source += 1;
    else if (url.pathname.endsWith("/commits") && url.searchParams.has("author"))
      counters.attribution += 1;
    else if (repositoryKey !== null) counters.repositoryMetadata += 1;
    return fetchImpl(request);
  };

const qualityReading = (reading: QualityReading): PrivateQualityReading => ({
  status: reading.status,
  previewScore: reading.previewScore,
  coverage: reading.coverage,
  dimensions: reading.dimensions,
  repositories: reading.repositories,
  files: reading.files,
  sourceBytes: reading.sourceBytes,
  nonBlankLines: reading.nonBlankLines,
  languages: reading.languages,
});

const relationshipFor = (
  maintainedRepositories: number,
  attributableRepositories: number,
  analyzedRepositories: number,
): PrivateRepositoryRelationship => {
  if (analyzedRepositories === 0) return "unavailable";
  if (maintainedRepositories > 0 && attributableRepositories > 0)
    return "maintained-and-attributed";
  if (maintainedRepositories > 0) return "maintained-only";
  if (attributableRepositories > 0) return "attributed-only";
  return "insufficient";
};

const telemetryFor = (counters: RequestCounters): PrivateRequestTelemetry => ({
  version: PRIVATE_CONTEXT_REQUEST_VERSION,
  requests: counters.total,
  requestCap: PRIVATE_CONTEXT_MAX_REQUESTS,
  requestCapPerRepository: PRIVATE_CONTEXT_MAX_REQUESTS_PER_REPOSITORY,
  identityRequests: counters.identity,
  installationRequests: counters.installations,
  repositoryListRequests: counters.repositoryList,
  repositoryMetadataRequests: counters.repositoryMetadata,
  sourceRequests: counters.source,
  attributionRequests: counters.attribution,
});

const unavailableReading = (): PrivateQualityReading => ({
  status: "insufficient",
  previewScore: null,
  coverage: 0,
  dimensions: {
    correctnessDiscipline: {
      available: false,
      previewScore: null,
      previewWeight: 4,
      measuredPoints: null,
      observations: 0,
    },
    testQuality: {
      available: false,
      previewScore: null,
      previewWeight: 2,
      measuredPoints: null,
      observations: 0,
    },
    maintainability: {
      available: false,
      previewScore: null,
      previewWeight: 7,
      measuredPoints: null,
      observations: 0,
    },
    contractQuality: {
      available: false,
      previewScore: null,
      previewWeight: 4,
      measuredPoints: null,
      observations: 0,
    },
    architecture: {
      available: false,
      previewScore: null,
      previewWeight: 5,
      measuredPoints: null,
      observations: 0,
    },
    securityHygiene: {
      available: false,
      previewScore: null,
      previewWeight: 4,
      measuredPoints: null,
      observations: 0,
    },
    duplicationAndDeadPatterns: {
      available: false,
      previewScore: null,
      previewWeight: 3,
      measuredPoints: null,
      observations: 0,
    },
  },
  repositories: 0,
  files: 0,
  sourceBytes: 0,
  nonBlankLines: 0,
  languages: [],
});

export async function runPrivateContext(
  options: RunPrivateContextOptions,
): Promise<PrivateContextRunResult> {
  const counters: RequestCounters = {
    total: 0,
    identity: 0,
    installations: 0,
    repositoryList: 0,
    repositoryMetadata: 0,
    source: 0,
    attribution: 0,
  };
  const rawFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const perRepository = new Map<string, number>();
  const fetchImpl = boundedFetch(rawFetch, counters, perRepository);
  const client = new GithubHttpClient({
    token: options.token,
    fetchImpl,
    maxRequests: PRIVATE_CONTEXT_MAX_REQUESTS,
    userAgent: "gitmog-private-context",
  });
  const identityResponse = await client.get<unknown>("/user");
  const login = identityResponse.ok ? parseUser(identityResponse.data) : null;
  if (login === null)
    return {
      ok: false,
      error: {
        code: "private_context_unavailable",
        message: "Private Context identity could not be confirmed.",
      },
    };
  const matching = options.handles.filter((handle) => handle.toLowerCase() === login.toLowerCase());
  if (matching.length !== 1)
    return {
      ok: false,
      error: {
        code: "private_context_identity_mismatch",
        message: "Private Context can only be added to the matching battle participant.",
        signedInAs: login,
      },
    };

  const installationResponse = await client.get<unknown>("/user/installations", {
    per_page: "100",
  });
  if (!installationResponse.ok)
    return {
      ok: false,
      error: {
        code: "private_context_unavailable",
        message: "Private Context installations could not be checked.",
      },
    };
  const installations = parseInstallations(installationResponse.data, options.config.appId);
  if (installations === null)
    return {
      ok: false,
      error: {
        code: "private_context_permissions_invalid",
        message: "Private Context permissions did not match the read-only contract.",
      },
    };
  if (installations.length === 0)
    return {
      ok: false,
      error: {
        code: "private_context_installation_required",
        message:
          "Install Git Mog Private Context and choose only the private repositories you want included.",
        installationUrl: privateContextInstallationUrl(options.config),
      },
    };
  if (installations.some((installation) => installation.repositorySelection === "all"))
    return {
      ok: false,
      error: {
        code: "private_context_selected_repositories_required",
        message:
          "Change the GitHub App installation to Only select repositories, then run it again.",
      },
    };

  const repositories: PrivateRepository[] = [];
  const sensitiveValues: string[] = [options.token];
  for (const installation of installations) {
    sensitiveValues.push(String(installation.id));
    for (let page = 1; page <= 5; page += 1) {
      const response = await client.get<unknown>(
        `/user/installations/${String(installation.id)}/repositories`,
        { per_page: "100", page: String(page) },
      );
      if (!response.ok) break;
      const body = record(response.data);
      const rawRepositories = body?.repositories;
      const total = body?.total_count;
      if (!Array.isArray(rawRepositories) || !Number.isSafeInteger(total)) break;
      for (const value of rawRepositories) {
        const repository = parsePrivateRepository(value, login);
        if (repository !== null) repositories.push(repository);
      }
      if (rawRepositories.length < 100) break;
    }
  }
  const deduplicated = new Map<string, PrivateRepository>();
  const normalizedOwners = new Map<string, string>();
  for (const repository of repositories) {
    const normalized = repository.summary.fullName.normalize("NFC").toLowerCase();
    const existing = normalizedOwners.get(normalized);
    if (existing !== undefined && existing !== repository.summary.fullName) continue;
    normalizedOwners.set(normalized, repository.summary.fullName);
    deduplicated.set(normalized, repository);
  }
  const ranked = privateRank([...deduplicated.values()]);
  const considered = ranked.slice(0, PRIVATE_CONTEXT_MAX_REPOSITORIES);
  const limitations: PrivateContextLimitation[] = [];
  if (ranked.length > PRIVATE_CONTEXT_MAX_REPOSITORIES)
    limitations.push({
      code: "repository-limit",
      detail: "The five-repository Private Context limit was applied deterministically.",
      count: ranked.length - PRIVATE_CONTEXT_MAX_REPOSITORIES,
    });

  const inspections: RepositoryInspection[] = [];
  const usableRepositories: RepositorySummary[] = [];
  const releaseRepositories = new Set<string>();
  for (const repository of considered) {
    const [owner, name] = repository.summary.fullName.split("/", 2);
    if (owner === undefined || name === undefined) continue;
    sensitiveValues.push(
      repository.summary.name,
      repository.summary.fullName,
      repository.summary.htmlUrl,
      String(repository.summary.id),
    );
    const revisionResponse = await client.get<unknown>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(repository.summary.defaultBranch)}`,
    );
    const revision = revisionResponse.ok ? parseRevision(revisionResponse.data) : null;
    if (revision === null) {
      limitations.push({
        code: "source-unavailable",
        detail: "An immutable private revision was unavailable.",
        count: 1,
      });
      continue;
    }
    const treeResponse = await client.get<unknown>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${revision.treeSha}`,
      { recursive: "1" },
    );
    const tree = treeResponse.ok ? normalizeTree(treeResponse.data) : null;
    if (tree === null || tree.sha !== revision.treeSha) {
      limitations.push({
        code: "source-unavailable",
        detail: "A bounded private repository tree was unavailable.",
        count: 1,
      });
      continue;
    }
    const releaseResponse = await client.get<unknown>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases`,
      { per_page: "10" },
    );
    const releases = releaseResponse.ok
      ? normalizeReleases(releaseResponse.data)
      : { count: 0, latestAt: null };
    if (releases.count > 0) releaseRepositories.add(repository.summary.fullName);
    for (const entry of tree.entries) {
      sensitiveValues.push(entry.path, entry.sha);
    }
    sensitiveValues.push(revision.commitSha, revision.treeSha);
    usableRepositories.push(repository.summary);
    inspections.push({
      name: repository.summary.name,
      fullName: repository.summary.fullName,
      htmlUrl: repository.summary.htmlUrl,
      languageBytes: {},
      releaseCount: releases.count,
      latestReleaseAt: releases.latestAt,
      tree: tree.entries,
      treeSha: tree.sha,
      treeTruncated: tree.truncated,
      failures: [],
    });
  }

  const now = options.now?.() ?? Date.now();
  const snapshot: ProfileSnapshot = {
    snapshotKey: digest({
      mode: "private-process-only",
      login,
      repositories: usableRepositories.map((repository) => repository.id),
    }),
    collectedAt: new Date(now).toISOString(),
    referenceDate: new Date(now).toISOString().slice(0, 10),
    profile: {
      login,
      id: -1,
      name: null,
      avatarUrl: "",
      htmlUrl: `https://github.com/${login}`,
      bio: null,
      publicRepos: 0,
      followers: 0,
      createdAt: "",
      accountType: "User",
    },
    repositories: usableRepositories,
    repositoryListComplete: true,
    eligibleRepositoryCount: usableRepositories.length,
    selectedRepositories: usableRepositories.map((repository) => repository.fullName),
    inspections,
    events: [],
    eventsAvailable: false,
    eventWindow: { oldest: null, newest: null, truncated: false },
    commitSample: null,
    budget: {
      maxRequests: PRIVATE_CONTEXT_MAX_REQUESTS,
      usedRequests: counters.total,
      maxInspectedRepositories: PRIVATE_CONTEXT_MAX_REPOSITORIES,
      inspectedRepositories: inspections.length,
      exhausted: counters.total >= PRIVATE_CONTEXT_MAX_REQUESTS,
    },
    rateLimit: { authenticated: true, limit: null, remaining: null, resetAt: null },
    degradations: [],
  };

  const collection = await collectQualitySource(snapshot, {
    token: options.token,
    fetchImpl,
    sourceRequestCap: 21,
    attributionRequestCap: 12,
  });
  for (const file of collection.files)
    sensitiveValues.push(
      file.repository,
      file.path,
      file.sourceUrl,
      file.commitSha,
      file.blobSha,
      file.source,
    );
  const inputs: QualitySourceInput[] = [...collection.files];
  const parseResults = await parseQualitySourcesIsolated(inputs, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const maintainedNames = new Set(
    considered
      .filter((repository) => repository.maintained)
      .map((repository) => repository.summary.fullName.toLowerCase()),
  );
  const maintainedInputs: QualitySourceInput[] = [];
  const maintainedParseResults: Array<ParseQualityResult | null> = [];
  for (const [index, input] of inputs.entries()) {
    if (!maintainedNames.has(input.repository.toLowerCase())) continue;
    maintainedInputs.push(input);
    maintainedParseResults.push(parseResults[index] ?? null);
  }
  const maintainedAnalysis = analyzeQualityParseResults(maintainedInputs, maintainedParseResults, {
    requestTelemetry: {
      sourceRequests: counters.source,
      attributionRequests: counters.attribution,
    },
  });
  const attributedAnalysis = analyzeQualityParseResults(inputs, parseResults, {
    requestTelemetry: {
      sourceRequests: counters.source,
      attributionRequests: counters.attribution,
    },
  });
  const attributableNames = new Set(
    inputs
      .filter((input) => input.attribution.status === "attributed")
      .map((input) => input.repository.toLowerCase()),
  );
  const analyzedNames = new Set(inspections.map((inspection) => inspection.fullName.toLowerCase()));
  const maintainedRepositories = considered.filter(
    (repository) =>
      repository.maintained && analyzedNames.has(repository.summary.fullName.toLowerCase()),
  ).length;
  const attributableRepositories = attributableNames.size;
  const activeRepositories = considered.filter((repository) => {
    const pushed = Date.parse(repository.summary.pushedAt ?? repository.summary.updatedAt);
    return Number.isFinite(pushed) && now - pushed <= 365 * 86_400_000;
  }).length;
  const substantialRepositories = considered.filter(
    (repository) => repository.summary.sizeKb >= 64,
  ).length;
  const repositoriesWithTests = inspections.filter((inspection) =>
    inspection.tree?.some((entry) =>
      /(?:^|\/)(?:test|tests|spec|specs|__tests__)(?:\/|\.)|\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(
        entry.path,
      ),
    ),
  ).length;
  const repositoriesWithCi = inspections.filter((inspection) =>
    inspection.tree?.some((entry) => /^\.github\/workflows\/[^/]+\.ya?ml$/iu.test(entry.path)),
  ).length;
  const sustainedRepositories = considered.filter((repository) => {
    const created = Date.parse(repository.summary.createdAt);
    const pushed = Date.parse(repository.summary.pushedAt ?? repository.summary.updatedAt);
    return (
      repository.summary.sizeKb >= 64 &&
      Number.isFinite(created) &&
      Number.isFinite(pushed) &&
      pushed - created >= 180 * 86_400_000
    );
  }).length;
  const assertions = parseResults.reduce(
    (total, result) => total + (result?.ok === true ? result.features.assertionCount : 0),
    0,
  );
  const testCases = parseResults.reduce(
    (total, result) => total + (result?.ok === true ? result.features.testCaseCount : 0),
    0,
  );

  const receipts: PrivateAggregateReceipt[] = [
    {
      id: "P1",
      claim: `${String(repositoriesWithCi)} of ${String(inspections.length)} analyzed private repositories contain CI configuration.`,
      metric: "ci-repositories",
      observed: repositoriesWithCi,
      total: inspections.length,
    },
    {
      id: "P2",
      claim: `${String(sustainedRepositories)} selected private projects show sustained maintenance.`,
      metric: "sustained-repositories",
      observed: sustainedRepositories,
      total: considered.length,
    },
    {
      id: "P3",
      claim:
        maintainedAnalysis.maintainedCodebase.previewScore === null
          ? `${String(maintainedAnalysis.maintainedCodebase.coverage)}% of sampled maintained source was parser-supported.`
          : `Maintained private code quality is ${String(maintainedAnalysis.maintainedCodebase.previewScore)} with ${String(maintainedAnalysis.maintainedCodebase.coverage)}% supported-source coverage.`,
      metric: "quality-coverage",
      observed: maintainedAnalysis.maintainedCodebase.coverage,
      total: 100,
    },
    {
      id: "P4",
      claim: `${String(inputs.filter((input) => input.attribution.status === "attributed").length)} of ${String(inputs.length)} sampled files have user-linked commit evidence.`,
      metric: "attributed-files",
      observed: inputs.filter((input) => input.attribution.status === "attributed").length,
      total: inputs.length,
    },
    ...(testCases === 0
      ? []
      : [
          {
            id: "P5" as const,
            claim: `${String(assertions)} assertions appear across ${String(testCases)} sampled private tests.`,
            metric: "test-assertions" as const,
            observed: assertions,
            total: testCases,
          },
        ]),
  ];
  for (const limitation of collection.limitations) {
    limitations.push({
      code:
        limitation.code === "source-budget"
          ? "request-budget"
          : limitation.code === "attribution-budget"
            ? "attribution"
            : "source-unavailable",
      detail:
        limitation.code === "source-budget"
          ? "The bounded private request or byte budget reduced source coverage."
          : limitation.code === "attribution-budget"
            ? "The bounded attribution budget left some sampled files unattributed."
            : "Some selected private source was unavailable within the safety boundary.",
      count: limitation.files,
    });
  }
  if (inputs.length === 0)
    limitations.push({
      code: "insufficient",
      detail: "Not enough supported private source qualified for aggregate analysis.",
      count: considered.length,
    });

  const relationship = relationshipFor(
    maintainedRepositories,
    attributableRepositories,
    inspections.length,
  );
  const result: PrivateContextResult = {
    version: PRIVATE_CONTEXT_RESULT_VERSION,
    mode: "selected-private-repositories",
    status:
      inputs.length === 0
        ? "insufficient"
        : limitations.length === 0 && maintainedAnalysis.maintainedCodebase.status === "ready"
          ? "ready"
          : "partial",
    subject: login,
    relationship,
    scoreInfluence: 0,
    publicWinnerInfluence: 0,
    persisted: false,
    repositorySelection: {
      installedPrivateRepositories: ranked.length,
      consideredRepositories: considered.length,
      analyzedRepositories: inspections.length,
      maintainedRepositories,
      attributableRepositories,
    },
    repositorySignals: {
      activeRepositories,
      substantialRepositories,
      repositoriesWithTests,
      repositoriesWithCi,
      repositoriesWithReleases: releaseRepositories.size,
    },
    maintainedCodebase: qualityReading(maintainedAnalysis.maintainedCodebase),
    attributedCode: qualityReading(attributedAnalysis.attributedCode),
    limitations,
    receipts,
    requestTelemetry: telemetryFor(counters),
  };
  const scanner = createPrivateArtifactScanner(sensitiveValues);
  const safe = privateAggregateShapeIsSafe(result) && scanner.scan(JSON.stringify(result));
  scanner.dispose();
  sensitiveValues.length = 0;
  inputs.length = 0;
  maintainedInputs.length = 0;
  if (!safe)
    return {
      ok: false,
      error: {
        code: "private_context_privacy_violation",
        message: "Private Context output failed its privacy boundary.",
      },
    };
  return { ok: true, result };
}

export { unavailableReading };
