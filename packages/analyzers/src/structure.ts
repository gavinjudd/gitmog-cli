import {
  AUTOMATION_RULES,
  CI_RULES,
  CONFIGURATION_RULES,
  DEPENDENCY_AUTOMATION_RULES,
  LINT_RULES,
  LOCKFILE_RULES,
  MANIFEST_RULES,
  MONOREPO_RULES,
  RELEASE_AUTOMATION_RULES,
  TYPING_RULES,
  extensionOf,
  fileName,
  isBuildOutputPath,
  isDependencyDirectoryPath,
  isGeneratedPath,
  isSourcePath,
  isTestPath,
  matchesAny,
  matchingRuleIds,
  pathSegments,
} from "./paths.js";

export interface TreeEntry {
  readonly path: string;
  readonly type: "blob" | "tree" | "commit";
  readonly sizeBytes: number;
}

/**
 * What a file tree can honestly tell you. This is repository hygiene and structure
 * analysis, not code review: nothing here has read a line of source, so no field
 * claims anything about semantics, correctness, or architecture quality.
 */
export interface RepositoryStructure {
  readonly fileCount: number;
  readonly directoryCount: number;
  readonly sourceFileCount: number;
  readonly testFileCount: number;
  readonly generatedFileCount: number;
  readonly documentationFileCount: number;
  readonly rootFileCount: number;
  readonly maxDepth: number;
  readonly largestSourceFileBytes: number;
  readonly oversizedSourceFileCount: number;
  readonly sourceBytes: number;
  readonly hasTests: boolean;
  readonly hasCi: boolean;
  readonly ciSystems: readonly string[];
  readonly hasLinting: boolean;
  readonly lintTools: readonly string[];
  readonly hasTypeChecking: boolean;
  readonly typeTools: readonly string[];
  readonly hasLockfile: boolean;
  readonly hasManifest: boolean;
  readonly manifestKinds: readonly string[];
  readonly hasAutomation: boolean;
  readonly hasReleaseAutomation: boolean;
  readonly hasDependencyAutomation: boolean;
  readonly hasReadme: boolean;
  readonly hasDocsDirectory: boolean;
  readonly hasLicenseFile: boolean;
  readonly hasContributingGuide: boolean;
  readonly hasSecurityPolicy: boolean;
  readonly hasCodeOfConduct: boolean;
  readonly isMonorepo: boolean;
  readonly committedDependencyDirectory: boolean;
  readonly committedBuildOutput: boolean;
  readonly separatesSourceFromTests: boolean;
  readonly extensions: Readonly<Record<string, number>>;
  readonly truncated: boolean;
}

/** A source file this large is a maintainability signal on its own (SCORECARD.md
 * CRAFT C, "file/function size pathologies"). Bytes, because that is what the tree
 * endpoint provides. */
export const OVERSIZED_SOURCE_BYTES = 100_000;

const ROOT_DOCUMENT_RULES = {
  readme: /^readme(\.[a-z]+)?$/i,
  license: /^(licen[cs]e|copying|unlicense)(\.[a-z]+)?$/i,
  contributing: /^contributing(\.[a-z]+)?$/i,
  security: /^security(\.[a-z]+)?$/i,
  codeOfConduct: /^code[_-]of[_-]conduct(\.[a-z]+)?$/i,
} as const;

const SOURCE_ROOT_DIRECTORIES = new Set([
  "src",
  "lib",
  "app",
  "apps",
  "packages",
  "internal",
  "cmd",
  "pkg",
  "source",
]);

export function analyzeRepositoryTree(
  entries: readonly TreeEntry[],
  options: { readonly truncated?: boolean } = {},
): RepositoryStructure {
  const blobs = entries.filter((entry) => entry.type === "blob");
  const extensions: Record<string, number> = {};
  const ciSystems = new Set<string>();
  const lintTools = new Set<string>();
  const typeTools = new Set<string>();
  const manifestKinds = new Set<string>();

  let sourceFileCount = 0;
  let testFileCount = 0;
  let generatedFileCount = 0;
  let documentationFileCount = 0;
  let rootFileCount = 0;
  let maxDepth = 0;
  let largestSourceFileBytes = 0;
  let oversizedSourceFileCount = 0;
  let sourceBytes = 0;
  let hasLockfile = false;
  let hasManifest = false;
  let hasAutomation = false;
  let hasReleaseAutomation = false;
  let hasDependencyAutomation = false;
  let isMonorepo = false;
  let committedDependencyDirectory = false;
  let committedBuildOutput = false;
  let hasReadme = false;
  let hasDocsDirectory = false;
  let hasLicenseFile = false;
  let hasContributingGuide = false;
  let hasSecurityPolicy = false;
  let hasCodeOfConduct = false;
  let sourceUnderRoot = 0;
  let sourceUnderSourceDirectory = 0;

  for (const entry of entries) {
    const segments = pathSegments(entry.path);
    maxDepth = Math.max(maxDepth, segments.length);
    if (entry.type !== "blob") {
      if (segments.length === 1 && segments[0]?.toLowerCase() === "docs") hasDocsDirectory = true;
      continue;
    }

    const name = fileName(entry.path);
    const depth = segments.length;
    if (depth === 1) rootFileCount += 1;

    if (isDependencyDirectoryPath(entry.path)) committedDependencyDirectory = true;
    if (isBuildOutputPath(entry.path)) committedBuildOutput = true;

    if (isGeneratedPath(entry.path)) {
      generatedFileCount += 1;
    } else if (isTestPath(entry.path)) {
      testFileCount += 1;
    } else if (isSourcePath(entry.path) && !matchesAny(entry.path, CONFIGURATION_RULES)) {
      sourceFileCount += 1;
      sourceBytes += entry.sizeBytes;
      largestSourceFileBytes = Math.max(largestSourceFileBytes, entry.sizeBytes);
      if (entry.sizeBytes > OVERSIZED_SOURCE_BYTES) oversizedSourceFileCount += 1;
      if (depth === 1) sourceUnderRoot += 1;
      const first = segments[0]?.toLowerCase() ?? "";
      if (SOURCE_ROOT_DIRECTORIES.has(first)) sourceUnderSourceDirectory += 1;
    }

    const extension = extensionOf(entry.path);
    if (extension !== "" && !isGeneratedPath(entry.path)) {
      extensions[extension] = (extensions[extension] ?? 0) + 1;
    }
    if (["md", "mdx", "rst", "adoc"].includes(extension) && !isGeneratedPath(entry.path)) {
      documentationFileCount += 1;
    }
    if (segments[0]?.toLowerCase() === "docs") hasDocsDirectory = true;

    for (const id of matchingRuleIds(entry.path, CI_RULES)) ciSystems.add(id);
    for (const id of matchingRuleIds(entry.path, LINT_RULES)) lintTools.add(id);
    for (const id of matchingRuleIds(entry.path, TYPING_RULES)) typeTools.add(id);
    for (const id of matchingRuleIds(entry.path, MANIFEST_RULES)) manifestKinds.add(id);
    if (matchesAny(entry.path, LOCKFILE_RULES)) hasLockfile = true;
    if (matchesAny(entry.path, MANIFEST_RULES)) hasManifest = true;
    if (matchesAny(entry.path, AUTOMATION_RULES)) hasAutomation = true;
    if (matchesAny(entry.path, RELEASE_AUTOMATION_RULES)) hasReleaseAutomation = true;
    if (matchesAny(entry.path, DEPENDENCY_AUTOMATION_RULES)) hasDependencyAutomation = true;
    if (matchesAny(entry.path, MONOREPO_RULES)) isMonorepo = true;

    if (depth === 1 || (depth === 2 && segments[0] === ".github")) {
      if (ROOT_DOCUMENT_RULES.readme.test(name)) hasReadme = true;
      if (ROOT_DOCUMENT_RULES.license.test(name)) hasLicenseFile = true;
      if (ROOT_DOCUMENT_RULES.contributing.test(name)) hasContributingGuide = true;
      if (ROOT_DOCUMENT_RULES.security.test(name)) hasSecurityPolicy = true;
      if (ROOT_DOCUMENT_RULES.codeOfConduct.test(name)) hasCodeOfConduct = true;
    }
  }

  if (!isMonorepo) {
    const workspaceManifests = blobs.filter((entry) =>
      /^(packages|apps)\/[^/]+\/(package\.json|pyproject\.toml|go\.mod|Cargo\.toml)$/.test(
        entry.path,
      ),
    ).length;
    isMonorepo = workspaceManifests >= 2;
  }

  return {
    fileCount: blobs.length,
    directoryCount: entries.filter((entry) => entry.type === "tree").length,
    sourceFileCount,
    testFileCount,
    generatedFileCount,
    documentationFileCount,
    rootFileCount,
    maxDepth,
    largestSourceFileBytes,
    oversizedSourceFileCount,
    sourceBytes,
    hasTests: testFileCount > 0,
    hasCi: ciSystems.size > 0,
    ciSystems: [...ciSystems].sort(),
    hasLinting: lintTools.size > 0,
    lintTools: [...lintTools].sort(),
    hasTypeChecking: typeTools.size > 0,
    typeTools: [...typeTools].sort(),
    hasLockfile,
    hasManifest,
    manifestKinds: [...manifestKinds].sort(),
    hasAutomation,
    hasReleaseAutomation,
    hasDependencyAutomation,
    hasReadme,
    hasDocsDirectory,
    hasLicenseFile,
    hasContributingGuide,
    hasSecurityPolicy,
    hasCodeOfConduct,
    isMonorepo,
    committedDependencyDirectory,
    committedBuildOutput,
    separatesSourceFromTests:
      sourceFileCount > 0 && sourceUnderSourceDirectory >= sourceUnderRoot && testFileCount > 0,
    extensions,
    truncated: options.truncated ?? false,
  };
}

/** An empty structure, used when the tree endpoint failed for a repository. Every
 * count is zero and every flag false, and the caller records the failure as reduced
 * coverage rather than as evidence of absence. */
export function emptyRepositoryStructure(): RepositoryStructure {
  return analyzeRepositoryTree([], { truncated: false });
}
