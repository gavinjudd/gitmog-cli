import { Buffer } from "node:buffer";

import { featureLanguageOf } from "@gitmog/analyzers";

import { digest } from "./digest.js";
import { GithubHttpClient, type GithubHttpOptions } from "./http.js";
import {
  isTestSamplePath,
  rankSourceFiles,
  selectSampleRepositories,
  type SelectedSourceFile,
} from "./source-sample.js";
import type { ProfileSnapshot, RepositorySummary } from "./types.js";

export const QUALITY_SOURCE_COLLECTION_VERSION = "1.0.0-stratified-immutable-blobs";
export const QUALITY_ATTRIBUTION_COLLECTION_VERSION = "1.0.0-author-linked-path-commits";
export const QUALITY_MAX_REPOSITORIES = 3;
export const QUALITY_MAX_IMPLEMENTATION_FILES_PER_REPOSITORY = 5;
export const QUALITY_MAX_TEST_FILES_PER_REPOSITORY = 2;
export const QUALITY_MAX_FILES = 18;
export const QUALITY_MAX_FILE_BYTES = 20 * 1024;
export const QUALITY_MAX_TOTAL_BYTES = 300 * 1024;
export const QUALITY_MAX_SOURCE_REQUESTS = 21;
export const QUALITY_MAX_ATTRIBUTION_REQUESTS = 12;
const QUALITY_BLOB_BASE64_CHARS = Math.ceil(QUALITY_MAX_FILE_BYTES / 3) * 4;
const QUALITY_BLOB_RESPONSE_BYTES =
  QUALITY_BLOB_BASE64_CHARS + Math.ceil(QUALITY_BLOB_BASE64_CHARS / 60) * 2 + 4 * 1024;

/** Process-only file. `source` must never be serialized, cached, logged, or persisted. */
export interface CollectedQualitySourceFile {
  readonly selectionOrder: number;
  readonly repository: string;
  readonly commitSha: string;
  readonly blobSha: string;
  readonly path: string;
  readonly sourceUrl: string;
  readonly source: string;
  readonly byteLength: number;
  readonly isTest: boolean;
  readonly attribution: {
    readonly status: "attributed" | "not-attributed" | "not-checked";
    readonly commitSha: string | null;
  };
}

export interface QualitySourceCollectionLimitation {
  readonly code:
    | "source-budget"
    | "attribution-budget"
    | "unavailable"
    | "oversized"
    | "non-text"
    | "revision-drift";
  readonly detail: string;
  readonly files: number;
}

export interface QualitySourceCollection {
  readonly version: string;
  readonly attributionVersion: string;
  readonly selectionKey: string;
  readonly files: readonly CollectedQualitySourceFile[];
  readonly selectedPaths: readonly {
    readonly repository: string;
    readonly commitSha: string;
    readonly blobSha: string;
    readonly path: string;
    readonly isTest: boolean;
  }[];
  readonly sourceRequests: number;
  readonly attributionRequests: number;
  readonly sourceRequestCap: number;
  readonly attributionRequestCap: number;
  readonly unsupportedSelectedFiles: number;
  readonly limitations: readonly QualitySourceCollectionLimitation[];
}

export interface CollectQualitySourceOptions extends GithubHttpOptions {
  readonly sourceRequestCap?: number | undefined;
  readonly attributionRequestCap?: number | undefined;
}

interface RepositoryCandidates {
  readonly repository: RepositorySummary;
  readonly treeSha: string;
  readonly candidates: readonly SelectedSourceFile[];
}

interface RevisionContext {
  readonly commitSha: string;
  readonly treeSha: string;
}

const encodePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const boundedCap = (value: number | undefined, maximum: number): number =>
  value === undefined || !Number.isSafeInteger(value)
    ? maximum
    : Math.max(0, Math.min(maximum, value));

const parseRevision = (raw: unknown): RevisionContext | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const commit = record.commit;
  if (
    typeof record.sha !== "string" ||
    !/^[0-9a-f]{40}$/u.test(record.sha) ||
    typeof commit !== "object" ||
    commit === null
  )
    return null;
  const tree = (commit as Record<string, unknown>).tree;
  if (typeof tree !== "object" || tree === null) return null;
  const treeSha = (tree as Record<string, unknown>).sha;
  return typeof treeSha === "string" && /^[0-9a-f]{40}$/u.test(treeSha)
    ? { commitSha: record.sha, treeSha }
    : null;
};

const decodeBlob = (
  raw: unknown,
):
  | { readonly ok: true; readonly source: string }
  | { readonly ok: false; readonly reason: "oversized" | "non-text" } => {
  const invalid = { ok: false as const, reason: "non-text" as const };
  const oversized = { ok: false as const, reason: "oversized" as const };
  if (typeof raw !== "object" || raw === null) return invalid;
  const record = raw as Record<string, unknown>;
  if (record.encoding !== "base64" || typeof record.content !== "string") return invalid;
  if (typeof record.size === "number" && record.size > QUALITY_MAX_FILE_BYTES) return oversized;
  if (
    record.content.length >
    QUALITY_BLOB_BASE64_CHARS + Math.ceil(QUALITY_BLOB_BASE64_CHARS / 60) * 2
  )
    return oversized;
  if (/[^A-Za-z0-9+/=\r\n]/u.test(record.content)) return invalid;
  const encoded = record.content.replaceAll("\n", "").replaceAll("\r", "");
  if (
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    encoded.length > QUALITY_BLOB_BASE64_CHARS ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)
  )
    return invalid;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const expected = (encoded.length / 4) * 3 - padding;
  if (
    expected > QUALITY_MAX_FILE_BYTES ||
    (typeof record.size === "number" && record.size !== expected)
  )
    return oversized;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== expected || bytes.toString("base64") !== encoded || bytes.includes(0))
    return invalid;
  const source = bytes.toString("utf8");
  const replacementCount = source.split("\uFFFD").length - 1;
  return replacementCount > Math.max(2, source.length * 0.01) ? invalid : { ok: true, source };
};

const parseAttribution = (
  raw: unknown,
  login: string,
): { readonly status: "attributed" | "not-attributed"; readonly commitSha: string | null } => {
  if (!Array.isArray(raw) || raw.length === 0) return { status: "not-attributed", commitSha: null };
  for (const value of raw.slice(0, 5)) {
    if (typeof value !== "object" || value === null) continue;
    const record = value as Record<string, unknown>;
    const author = record.author;
    if (
      typeof record.sha !== "string" ||
      !/^[0-9a-f]{40}$/u.test(record.sha) ||
      typeof author !== "object" ||
      author === null
    )
      continue;
    const linkedLogin = (author as Record<string, unknown>).login;
    if (typeof linkedLogin === "string" && linkedLogin.toLowerCase() === login.toLowerCase())
      return { status: "attributed", commitSha: record.sha };
  }
  return { status: "not-attributed", commitSha: null };
};

const stratifiedCandidates = (snapshot: ProfileSnapshot): readonly RepositoryCandidates[] =>
  selectSampleRepositories(snapshot)
    .slice(0, QUALITY_MAX_REPOSITORIES)
    .flatMap((repository) => {
      const inspection = snapshot.inspections.find(
        (entry) => entry.fullName.toLowerCase() === repository.fullName.toLowerCase(),
      );
      if (inspection?.tree === null || inspection === undefined || inspection.treeSha === null)
        return [];
      const ranked = rankSourceFiles(
        inspection.tree
          .filter(
            (entry) =>
              entry.type === "blob" &&
              entry.sha !== "" &&
              entry.sizeBytes >= 0 &&
              entry.sizeBytes <= QUALITY_MAX_FILE_BYTES,
          )
          .map((entry) => ({ path: entry.path, sha: entry.sha, sizeBytes: entry.sizeBytes })),
      );
      const implementations = ranked
        .filter((entry) => !entry.isTest)
        .slice(0, QUALITY_MAX_IMPLEMENTATION_FILES_PER_REPOSITORY);
      const tests = ranked
        .filter((entry) => entry.isTest)
        .slice(0, QUALITY_MAX_TEST_FILES_PER_REPOSITORY);
      const byLane = new Map<string, SelectedSourceFile[]>();
      for (const candidate of [...implementations, ...tests]) {
        const key = `${candidate.isTest ? "test" : "implementation"}:${featureLanguageOf(candidate.blob.path)}:${candidate.blob.path.split("/")[0]?.normalize("NFC") ?? ""}`;
        const lane = byLane.get(key) ?? [];
        lane.push(candidate);
        byLane.set(key, lane);
      }
      const candidates: SelectedSourceFile[] = [];
      const lanes = [...byLane.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, values]) => values);
      while (lanes.some((lane) => lane.length > 0)) {
        for (const lane of lanes) {
          const candidate = lane.shift();
          if (candidate !== undefined) candidates.push(candidate);
        }
      }
      return [{ repository, treeSha: inspection.treeSha, candidates }];
    });

const opportunityOrder = (
  repositories: readonly RepositoryCandidates[],
): readonly {
  readonly repository: RepositorySummary;
  readonly treeSha: string;
  readonly candidate: SelectedSourceFile;
}[] => {
  const result: {
    repository: RepositorySummary;
    treeSha: string;
    candidate: SelectedSourceFile;
  }[] = [];
  let index = 0;
  while (result.length < QUALITY_MAX_FILES) {
    let progressed = false;
    for (const entry of repositories) {
      const candidate = entry.candidates[index];
      if (candidate === undefined) continue;
      result.push({ repository: entry.repository, treeSha: entry.treeSha, candidate });
      progressed = true;
      if (result.length >= QUALITY_MAX_FILES) break;
    }
    if (!progressed) break;
    index += 1;
  }
  return result;
};

export async function collectQualitySource(
  snapshot: ProfileSnapshot,
  options: CollectQualitySourceOptions = {},
): Promise<QualitySourceCollection> {
  const sourceRequestCap = boundedCap(options.sourceRequestCap, QUALITY_MAX_SOURCE_REQUESTS);
  const attributionRequestCap = boundedCap(
    options.attributionRequestCap,
    QUALITY_MAX_ATTRIBUTION_REQUESTS,
  );
  const sourceClient = new GithubHttpClient({
    ...options,
    maxRequests: sourceRequestCap,
    userAgent: "gitmog-quality-source",
  });
  const attributionClient = new GithubHttpClient({
    ...options,
    maxRequests: attributionRequestCap,
    userAgent: "gitmog-quality-attribution",
  });
  const repositories = stratifiedCandidates(snapshot);
  const revisions = new Map<string, RevisionContext>();
  const limitations: QualitySourceCollectionLimitation[] = [];
  for (const entry of repositories) {
    if (!sourceClient.canSpend(1)) break;
    const [owner] = entry.repository.fullName.split("/");
    const response = await sourceClient.get<unknown>(
      `/repos/${encodeURIComponent(owner ?? "")}/${encodeURIComponent(entry.repository.name)}/commits/${encodeURIComponent(entry.repository.defaultBranch)}`,
    );
    if (!response.ok) {
      limitations.push({
        code: "unavailable",
        detail: "An immutable repository revision could not be confirmed.",
        files: entry.candidates.length,
      });
      continue;
    }
    const revision = parseRevision(response.data);
    if (revision === null || revision.treeSha !== entry.treeSha) {
      limitations.push({
        code: "revision-drift",
        detail: "The repository revision changed during bounded collection.",
        files: entry.candidates.length,
      });
      continue;
    }
    revisions.set(entry.repository.fullName, revision);
  }
  const selected = opportunityOrder(repositories).filter((entry) =>
    revisions.has(entry.repository.fullName),
  );
  const files: CollectedQualitySourceFile[] = [];
  let totalBytes = 0;
  for (const entry of selected) {
    if (files.length >= QUALITY_MAX_FILES || totalBytes >= QUALITY_MAX_TOTAL_BYTES) break;
    if (!sourceClient.canSpend(1)) {
      limitations.push({
        code: "source-budget",
        detail: "The quality-source request cap reduced preview coverage.",
        files: selected.length - files.length,
      });
      break;
    }
    const [owner] = entry.repository.fullName.split("/");
    const response = await sourceClient.getBoundedJson<unknown>(
      `/repos/${encodeURIComponent(owner ?? "")}/${encodeURIComponent(entry.repository.name)}/git/blobs/${entry.candidate.blob.sha}`,
      QUALITY_BLOB_RESPONSE_BYTES,
    );
    if (!response.ok) {
      limitations.push({
        code: "unavailable",
        detail: "A selected immutable source blob was unavailable.",
        files: 1,
      });
      continue;
    }
    const decoded = decodeBlob(response.data);
    if (!decoded.ok) {
      limitations.push({
        code: decoded.reason,
        detail:
          decoded.reason === "oversized"
            ? "A selected file exceeded the decoded byte ceiling."
            : "A selected file was not bounded UTF-8 text.",
        files: 1,
      });
      continue;
    }
    const byteLength = Buffer.byteLength(decoded.source, "utf8");
    if (totalBytes + byteLength > QUALITY_MAX_TOTAL_BYTES) {
      limitations.push({
        code: "source-budget",
        detail: "The process-only source-byte ceiling reduced preview coverage.",
        files: selected.length - files.length,
      });
      break;
    }
    const revision = revisions.get(entry.repository.fullName);
    if (revision === undefined) continue;
    totalBytes += byteLength;
    files.push({
      selectionOrder: files.length,
      repository: entry.repository.fullName,
      commitSha: revision.commitSha,
      blobSha: entry.candidate.blob.sha,
      path: entry.candidate.blob.path.normalize("NFC"),
      sourceUrl: `${entry.repository.htmlUrl}/blob/${revision.commitSha}/${encodePath(entry.candidate.blob.path)}`,
      source: decoded.source,
      byteLength,
      isTest: isTestSamplePath(entry.candidate.blob.path),
      attribution: { status: "not-checked", commitSha: null },
    });
  }
  const attributed: CollectedQualitySourceFile[] = [];
  for (const file of files) {
    if (!attributionClient.canSpend(1)) {
      attributed.push(file);
      continue;
    }
    const [owner, repository] = file.repository.split("/");
    const response = await attributionClient.get<unknown>(
      `/repos/${encodeURIComponent(owner ?? "")}/${encodeURIComponent(repository ?? "")}/commits`,
      {
        sha: file.commitSha,
        path: file.path,
        author: snapshot.profile.login,
        per_page: "5",
      },
    );
    attributed.push({
      ...file,
      attribution: response.ok
        ? parseAttribution(response.data, snapshot.profile.login)
        : { status: "not-checked", commitSha: null },
    });
  }
  if (files.length > attributed.filter((file) => file.attribution.status !== "not-checked").length)
    limitations.push({
      code: "attribution-budget",
      detail: "The attribution request cap left some files as maintained-codebase evidence only.",
      files:
        files.length -
        attributed.filter((file) => file.attribution.status !== "not-checked").length,
    });
  const selectedPaths = attributed.map(
    ({
      selectionOrder: _selectionOrder,
      source: _source,
      sourceUrl: _sourceUrl,
      byteLength: _byteLength,
      attribution: _attribution,
      ...identity
    }) => identity,
  );
  return {
    version: QUALITY_SOURCE_COLLECTION_VERSION,
    attributionVersion: QUALITY_ATTRIBUTION_COLLECTION_VERSION,
    selectionKey: digest({
      version: QUALITY_SOURCE_COLLECTION_VERSION,
      login: snapshot.profile.login,
      selectedPaths,
    }),
    files: attributed,
    selectedPaths,
    sourceRequests: sourceClient.requestsUsed,
    attributionRequests: attributionClient.requestsUsed,
    sourceRequestCap,
    attributionRequestCap,
    unsupportedSelectedFiles: attributed.filter((file) => !supportedQualityPath(file.path)).length,
    limitations,
  };
}

export const supportedQualityPath = (path: string): boolean =>
  /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/iu.test(path);
