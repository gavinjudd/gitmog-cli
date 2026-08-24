import type { RepositorySummary } from "./types.js";

const DAY_MS = 86_400_000;

/**
 * Eligible for deep inspection. Forks, mirrors, templates, disabled repositories and
 * empty repositories are excluded outright. Archived repositories stay eligible:
 * SCORECARD.md CRAFT E treats an archive as intentionally finished work, not as
 * abandonment, so excluding it would silently delete positive evidence.
 */
export function isEligibleRepository(repository: RepositorySummary): boolean {
  return (
    !repository.fork &&
    !repository.mirror &&
    !repository.disabled &&
    !repository.isTemplate &&
    repository.sizeKb > 0
  );
}

const log1pScaled = (value: number, scale: number): number =>
  Math.log1p(Math.max(0, value)) / Math.log1p(scale);

function daysSince(iso: string | null, referenceMs: number): number {
  if (iso === null) return Number.POSITIVE_INFINITY;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (referenceMs - at) / DAY_MS);
}

function recencyWeight(days: number): number {
  if (days <= 30) return 1;
  if (days <= 90) return 0.85;
  if (days <= 365) return 0.6;
  if (days <= 730) return 0.35;
  return 0.15;
}

/**
 * Ranks candidates for inspection. Deliberately *not* a judgement: adoption appears
 * here because a repository other people use is more representative of the author's
 * work, and ADR 0004 D6 forbids it from reaching any scored metric. Two profiles with
 * identical metadata always yield the same ordering — ties break on push date and
 * then on name, never on array order from the API.
 */
export function selectionScore(repository: RepositorySummary, referenceMs: number): number {
  const substance = log1pScaled(repository.sizeKb, 50_000) * 3;
  const recency = recencyWeight(daysSince(repository.pushedAt, referenceMs)) * 3;
  const adoption = log1pScaled(repository.stars + repository.forks, 2_000) * 2;
  const described = repository.primaryLanguage === null ? 0 : 1;
  const created = Date.parse(repository.createdAt);
  const pushed = repository.pushedAt === null ? created : Date.parse(repository.pushedAt);
  const spanDays = Number.isNaN(created) || Number.isNaN(pushed) ? 0 : (pushed - created) / DAY_MS;
  const longevity = log1pScaled(spanDays, 1_460);
  return substance + recency + adoption + described + longevity;
}

export function selectRepositoriesForInspection(
  repositories: readonly RepositorySummary[],
  limit: number,
  referenceMs: number,
): readonly RepositorySummary[] {
  return repositories
    .filter(isEligibleRepository)
    .map((repository) => ({ repository, score: selectionScore(repository, referenceMs) }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftPushed = Date.parse(left.repository.pushedAt ?? left.repository.createdAt);
      const rightPushed = Date.parse(right.repository.pushedAt ?? right.repository.createdAt);
      if (rightPushed !== leftPushed) return rightPushed - leftPushed;
      return left.repository.name.localeCompare(right.repository.name);
    })
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.repository);
}
