/**
 * Bounded in-process snapshot cache.
 *
 * PLANNING.md §6.2 asks for a 24-hour profile cache, which assumes the persistence
 * layer this slice deliberately does not have. Fifteen minutes is the compromise
 * recorded in ADR 0004: long enough that a page refresh, the Open Graph route, the
 * story route and the CLI all read one snapshot, short enough that nothing stale
 * survives a development session. No Redis, no database.
 */
export const DEFAULT_SNAPSHOT_TTL_MS = 15 * 60 * 1000;
export const SNAPSHOT_CACHE_KEY_VERSION = "default-full-snapshot:2";
const MAX_ENTRIES = 200;

interface Entry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

export interface SnapshotCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

export function createSnapshotCache<T>(
  ttlMs: number = DEFAULT_SNAPSHOT_TTL_MS,
  now: () => number = Date.now,
): SnapshotCache<T> {
  const entries = new Map<string, Entry<T>>();

  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      // Refresh insertion order so the oldest *unused* entry is evicted first.
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + ttlMs });
      while (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
    },
    delete(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

/** Deterministic: authentication raises GitHub's account allowance but cannot select a
 * different product analysis. The same handle and supported inspection depth therefore
 * share one public snapshot across anonymous, explicit-token and device sessions. */
export function snapshotCacheKey(input: {
  readonly login: string;
  readonly authenticated: boolean;
  readonly maxInspectedRepositories: number;
}): string {
  const depth = String(input.maxInspectedRepositories);
  return `${SNAPSHOT_CACHE_KEY_VERSION}:${input.login.toLowerCase()}:public:${depth}`;
}
