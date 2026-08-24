import type {
  GithubProfile,
  PublicEvent,
  RepositoryCommit,
  RepositorySummary,
  RepositoryTreeEntry,
} from "./types.js";

type Unknown = Record<string, unknown>;

const asRecord = (value: unknown): Unknown =>
  typeof value === "object" && value !== null ? (value as Unknown) : {};

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const strOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

const num = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const bool = (value: unknown): boolean => value === true;

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const BOT_SUFFIX = "[bot]";

export function isBotName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(BOT_SUFFIX) ||
    lower === "dependabot" ||
    lower === "renovate" ||
    lower === "github-actions" ||
    lower.endsWith("-bot")
  );
}

export function normalizeProfile(raw: unknown): GithubProfile | null {
  const record = asRecord(raw);
  const login = str(record.login);
  if (login === "") return null;
  return {
    login,
    id: num(record.id, -1),
    name: strOrNull(record.name),
    avatarUrl: str(record.avatar_url),
    htmlUrl: str(record.html_url, `https://github.com/${login}`),
    bio: strOrNull(record.bio),
    publicRepos: num(record.public_repos),
    followers: num(record.followers),
    createdAt: str(record.created_at),
    accountType: str(record.type, "User"),
  };
}

export function normalizeRepository(raw: unknown): RepositorySummary | null {
  const record = asRecord(raw);
  const name = str(record.name);
  if (name === "") return null;
  const owner = str(asRecord(record.owner).login);
  const license = asRecord(record.license);
  return {
    id: num(record.id, -1),
    name,
    fullName: str(record.full_name, owner === "" ? name : `${owner}/${name}`),
    htmlUrl: str(record.html_url),
    description: strOrNull(record.description),
    fork: bool(record.fork),
    archived: bool(record.archived),
    disabled: bool(record.disabled),
    isTemplate: bool(record.is_template),
    mirror: typeof record.mirror_url === "string" && record.mirror_url !== "",
    sizeKb: num(record.size),
    stars: num(record.stargazers_count),
    forks: num(record.forks_count),
    openIssues: num(record.open_issues_count),
    primaryLanguage: strOrNull(record.language),
    topics: strings(record.topics),
    homepage: strOrNull(record.homepage),
    licenseSpdxId: strOrNull(license.spdx_id),
    createdAt: str(record.created_at),
    updatedAt: str(record.updated_at),
    pushedAt: strOrNull(record.pushed_at),
    defaultBranch: str(record.default_branch, "main"),
  };
}

export function normalizeEvent(raw: unknown): PublicEvent | null {
  const record = asRecord(raw);
  const type = str(record.type);
  const createdAt = str(record.created_at);
  if (type === "" || createdAt === "") return null;
  const payload = asRecord(record.payload);
  const pull = asRecord(payload.pull_request);
  return {
    type,
    repoFullName: str(asRecord(record.repo).name),
    createdAt,
    action: strOrNull(payload.action),
    // The public payload is trimmed: `merged` is often absent, `merged_at` is not.
    merged: bool(pull.merged) || strOrNull(pull.merged_at) !== null,
    isBotActor: isBotName(str(asRecord(record.actor).login)),
  };
}

export const MAX_COMMIT_SAMPLE = 100;

export function normalizeCommits(raw: unknown): readonly RepositoryCommit[] {
  if (!Array.isArray(raw)) return [];
  const commits: RepositoryCommit[] = [];
  for (const item of raw) {
    if (commits.length >= MAX_COMMIT_SAMPLE) break;
    const entry = asRecord(item);
    const commit = asRecord(entry.commit);
    const author = asRecord(commit.author);
    const message = str(commit.message);
    if (message === "") continue;
    const authorName = str(author.name);
    const authorLogin = str(asRecord(entry.author).login);
    commits.push({
      sha: str(entry.sha).slice(0, 40),
      message,
      authoredAt: str(author.date),
      parentCount: Array.isArray(entry.parents) ? entry.parents.length : 1,
      authorName,
      isBotAuthor: isBotName(authorName) || isBotName(authorLogin),
    });
  }
  return commits;
}

export const MAX_TREE_ENTRIES = 6_000;

export function normalizeTree(raw: unknown): {
  readonly sha: string;
  readonly entries: readonly RepositoryTreeEntry[];
  readonly truncated: boolean;
} {
  const record = asRecord(raw);
  const rawEntries = Array.isArray(record.tree) ? record.tree : [];
  const entries: RepositoryTreeEntry[] = [];
  for (const item of rawEntries) {
    if (entries.length >= MAX_TREE_ENTRIES) break;
    const entry = asRecord(item);
    const path = str(entry.path);
    if (path === "") continue;
    const type = str(entry.type);
    entries.push({
      path,
      type: type === "tree" ? "tree" : type === "commit" ? "commit" : "blob",
      sizeBytes: num(entry.size),
      sha: str(entry.sha).slice(0, 64),
    });
  }
  return {
    sha: str(record.sha).slice(0, 64),
    entries,
    truncated: bool(record.truncated) || rawEntries.length > MAX_TREE_ENTRIES,
  };
}

export function normalizeReleases(raw: unknown): {
  readonly count: number;
  readonly latestAt: string | null;
} {
  if (!Array.isArray(raw)) return { count: 0, latestAt: null };
  let count = 0;
  let latestAt: string | null = null;
  for (const item of raw) {
    const release = asRecord(item);
    if (bool(release.draft)) continue;
    count += 1;
    const published = strOrNull(release.published_at) ?? strOrNull(release.created_at);
    if (published !== null && (latestAt === null || published > latestAt)) latestAt = published;
  }
  return { count, latestAt };
}

export function normalizeLanguages(raw: unknown): Readonly<Record<string, number>> {
  const record = asRecord(raw);
  const languages: Record<string, number> = {};
  for (const [language, bytes] of Object.entries(record)) {
    if (typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0) {
      languages[language] = bytes;
    }
  }
  return languages;
}
