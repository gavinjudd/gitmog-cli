/**
 * Path classification. Input is a list of strings that GitHub returned; nothing here
 * touches a filesystem, spawns a process, or reads a byte of the repository under
 * analysis. See `packages/analyzers/AGENTS.md`.
 */

export type PathKind = "test" | "source" | "generated" | "config" | "documentation" | "other";

const SOURCE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "py",
  "go",
  "rs",
  "rb",
  "php",
  "java",
  "kt",
  "kts",
  "swift",
  "cs",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "m",
  "mm",
  "scala",
  "clj",
  "ex",
  "exs",
  "erl",
  "hs",
  "ml",
  "dart",
  "lua",
  "sh",
  "bash",
  "zig",
  "sql",
  "vue",
  "svelte",
  "sol",
]);

const GENERATED_DIRECTORIES = new Set([
  "node_modules",
  "vendor",
  "third_party",
  "thirdparty",
  "bower_components",
  "pods",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "__pycache__",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  "_site",
  "site-packages",
  ".venv",
  "venv",
  "generated",
  "gen",
]);

const DEPENDENCY_DIRECTORIES = new Set([
  "node_modules",
  "vendor",
  "bower_components",
  "pods",
  "site-packages",
  ".venv",
  "venv",
]);

const BUILD_OUTPUT_DIRECTORIES = new Set([
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".output",
  "_site",
  "coverage",
]);

const TEST_DIRECTORIES = new Set([
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
  "e2e",
  "testing",
  "integration_tests",
]);

const GENERATED_FILE_PATTERNS = [
  /\.min\.(js|css)$/,
  /\.bundle\.js$/,
  /\.generated\./,
  /\.gen\.(go|ts|js|py)$/,
  /_pb2?\.py$/,
  /\.pb\.go$/,
  /\.pb\.cc$/,
  /_generated\.(go|ts|js)$/,
  /\.d\.ts\.map$/,
  /^package-lock\.json$/,
];

const TEST_FILE_PATTERNS = [
  /\.(test|spec)\.[a-z]+$/,
  /_test\.(go|py|rb|rs|exs?)$/,
  /^test_[^/]+\.py$/,
  /Test[s]?\.(java|kt|cs|scala|swift)$/,
  /^conftest\.py$/,
];

const DOCUMENTATION_EXTENSIONS = new Set(["md", "mdx", "rst", "adoc", "txt"]);

export function pathSegments(path: string): readonly string[] {
  return path.split("/").filter((segment) => segment !== "");
}

export function fileName(path: string): string {
  const segments = pathSegments(path);
  return segments[segments.length - 1] ?? "";
}

export function extensionOf(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

const hasDirectory = (path: string, directories: ReadonlySet<string>): boolean =>
  pathSegments(path)
    .slice(0, -1)
    .some((segment) => directories.has(segment.toLowerCase()));

export const isGeneratedPath = (path: string): boolean =>
  hasDirectory(path, GENERATED_DIRECTORIES) ||
  GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(fileName(path)));

export const isDependencyDirectoryPath = (path: string): boolean =>
  hasDirectory(path, DEPENDENCY_DIRECTORIES);

export const isBuildOutputPath = (path: string): boolean =>
  hasDirectory(path, BUILD_OUTPUT_DIRECTORIES);

export function isTestPath(path: string): boolean {
  if (isGeneratedPath(path)) return false;
  if (hasDirectory(path, TEST_DIRECTORIES)) return true;
  const name = fileName(path);
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

export function isSourcePath(path: string): boolean {
  return !isGeneratedPath(path) && !isTestPath(path) && SOURCE_EXTENSIONS.has(extensionOf(path));
}

export function classifyPath(path: string): PathKind {
  if (isGeneratedPath(path)) return "generated";
  if (isTestPath(path)) return "test";
  if (SOURCE_EXTENSIONS.has(extensionOf(path))) return "source";
  if (DOCUMENTATION_EXTENSIONS.has(extensionOf(path))) return "documentation";
  if (matchesAny(path, CONFIGURATION_RULES)) return "config";
  return "other";
}

export interface PathRule {
  readonly id: string;
  readonly matches: (path: string, name: string) => boolean;
}

const startsWith =
  (prefix: string) =>
  (path: string): boolean =>
    path.toLowerCase().startsWith(prefix);

const named =
  (...names: readonly string[]) =>
  (_path: string, name: string): boolean =>
    names.includes(name.toLowerCase());

const nameMatches =
  (pattern: RegExp) =>
  (_path: string, name: string): boolean =>
    pattern.test(name);

const pathMatches =
  (pattern: RegExp) =>
  (path: string): boolean =>
    pattern.test(path);

export const CI_RULES: readonly PathRule[] = [
  { id: "github-actions", matches: pathMatches(/^\.github\/workflows\/[^/]+\.ya?ml$/i) },
  { id: "gitlab-ci", matches: named(".gitlab-ci.yml", ".gitlab-ci.yaml") },
  { id: "circleci", matches: startsWith(".circleci/config.") },
  { id: "azure-pipelines", matches: nameMatches(/^azure-pipelines(-.+)?\.ya?ml$/i) },
  { id: "jenkins", matches: named("jenkinsfile") },
  { id: "travis", matches: named(".travis.yml") },
  { id: "drone", matches: named(".drone.yml") },
  { id: "appveyor", matches: named("appveyor.yml", ".appveyor.yml") },
  { id: "buildkite", matches: startsWith(".buildkite/") },
  { id: "bitbucket", matches: named("bitbucket-pipelines.yml") },
  { id: "woodpecker", matches: named(".woodpecker.yml") },
  { id: "cirrus", matches: named(".cirrus.yml") },
];

export const LINT_RULES: readonly PathRule[] = [
  { id: "eslint", matches: nameMatches(/^(\.eslintrc(\..+)?|eslint\.config\.[cm]?[jt]s)$/i) },
  { id: "prettier", matches: nameMatches(/^(\.prettierrc(\..+)?|prettier\.config\.[cm]?[jt]s)$/i) },
  { id: "biome", matches: named("biome.json", "biome.jsonc") },
  { id: "oxlint", matches: named(".oxlintrc.json") },
  { id: "golangci", matches: nameMatches(/^\.golangci\.ya?ml$/i) },
  { id: "ruff", matches: named("ruff.toml", ".ruff.toml") },
  { id: "flake8", matches: named(".flake8") },
  { id: "pylint", matches: named(".pylintrc", "pylintrc") },
  { id: "rubocop", matches: named(".rubocop.yml") },
  { id: "php-cs-fixer", matches: nameMatches(/^\.php-cs-fixer(\..+)?$/i) },
  { id: "phpcs", matches: named("phpcs.xml", "phpcs.xml.dist") },
  { id: "checkstyle", matches: named("checkstyle.xml") },
  { id: "detekt", matches: named("detekt.yml") },
  { id: "swiftlint", matches: named(".swiftlint.yml") },
  { id: "clippy", matches: named("clippy.toml", "rustfmt.toml", ".rustfmt.toml") },
  { id: "clang-format", matches: named(".clang-format", ".clang-tidy") },
  { id: "stylelint", matches: nameMatches(/^\.stylelintrc(\..+)?$/i) },
];

export const TYPING_RULES: readonly PathRule[] = [
  { id: "typescript", matches: named("tsconfig.json", "jsconfig.json") },
  { id: "mypy", matches: named("mypy.ini", ".mypy.ini") },
  { id: "pyright", matches: named("pyrightconfig.json") },
  { id: "py-typed", matches: nameMatches(/^py\.typed$/) },
  { id: "flow", matches: named(".flowconfig") },
  { id: "phpstan", matches: named("phpstan.neon", "phpstan.neon.dist") },
  { id: "psalm", matches: named("psalm.xml") },
  { id: "sorbet", matches: startsWith("sorbet/") },
];

export const LOCKFILE_RULES: readonly PathRule[] = [
  {
    id: "lockfile",
    matches: named(
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lockb",
      "bun.lock",
      "poetry.lock",
      "pipfile.lock",
      "uv.lock",
      "pdm.lock",
      "go.sum",
      "cargo.lock",
      "gemfile.lock",
      "composer.lock",
      "pubspec.lock",
      "gradle.lockfile",
      "mix.lock",
      "flake.lock",
      "packages.lock.json",
    ),
  },
];

export const MANIFEST_RULES: readonly PathRule[] = [
  { id: "npm", matches: named("package.json") },
  { id: "python", matches: named("pyproject.toml", "setup.py", "setup.cfg", "requirements.txt") },
  { id: "go", matches: named("go.mod") },
  { id: "cargo", matches: named("cargo.toml") },
  { id: "ruby", matches: nameMatches(/^(gemfile|.+\.gemspec)$/i) },
  { id: "composer", matches: named("composer.json") },
  { id: "maven", matches: named("pom.xml") },
  { id: "gradle", matches: nameMatches(/^build\.gradle(\.kts)?$/i) },
  { id: "dart", matches: named("pubspec.yaml") },
  { id: "elixir", matches: named("mix.exs") },
  { id: "dotnet", matches: nameMatches(/\.(csproj|fsproj|sln)$/i) },
  { id: "cmake", matches: named("cmakelists.txt") },
  { id: "deno", matches: named("deno.json", "deno.jsonc") },
];

export const AUTOMATION_RULES: readonly PathRule[] = [
  { id: "makefile", matches: named("makefile", "justfile", "taskfile.yml") },
  { id: "container", matches: nameMatches(/^(dockerfile|containerfile)(\..+)?$/i) },
  { id: "compose", matches: nameMatches(/^(docker-)?compose(\..+)?\.ya?ml$/i) },
  { id: "precommit", matches: named(".pre-commit-config.yaml") },
  { id: "nix", matches: named("flake.nix", "shell.nix", "default.nix") },
  { id: "devcontainer", matches: startsWith(".devcontainer/") },
];

export const RELEASE_AUTOMATION_RULES: readonly PathRule[] = [
  { id: "release-workflow", matches: pathMatches(/^\.github\/workflows\/.*(release|publish)/i) },
  { id: "semantic-release", matches: nameMatches(/^\.releaserc(\..+)?$/i) },
  { id: "release-please", matches: named("release-please-config.json") },
  { id: "changesets", matches: startsWith(".changeset/") },
  { id: "goreleaser", matches: nameMatches(/^\.?goreleaser\.ya?ml$/i) },
  { id: "changelog", matches: nameMatches(/^changelog(\..+)?$/i) },
  { id: "git-cliff", matches: named("cliff.toml") },
];

export const DEPENDENCY_AUTOMATION_RULES: readonly PathRule[] = [
  { id: "dependabot", matches: pathMatches(/^\.github\/dependabot\.ya?ml$/i) },
  { id: "renovate", matches: nameMatches(/^(renovate\.json5?|\.renovaterc(\..+)?)$/i) },
];

export const MONOREPO_RULES: readonly PathRule[] = [
  { id: "pnpm", matches: named("pnpm-workspace.yaml") },
  { id: "turbo", matches: named("turbo.json") },
  { id: "nx", matches: named("nx.json") },
  { id: "lerna", matches: named("lerna.json") },
  { id: "rush", matches: named("rush.json") },
  { id: "go-work", matches: named("go.work") },
];

/** Config files are frequently written in a source language. They are counted as
 * configuration rather than as source, so a repository is not credited with source
 * volume for its own tooling. */
export const CONFIGURATION_RULES: readonly PathRule[] = [
  ...CI_RULES,
  ...LINT_RULES,
  ...TYPING_RULES,
  ...LOCKFILE_RULES,
  ...MANIFEST_RULES,
  ...AUTOMATION_RULES,
];

export function matchesAny(path: string, rules: readonly PathRule[]): boolean {
  const name = fileName(path);
  return rules.some((rule) => rule.matches(path, name));
}

export function matchingRuleIds(path: string, rules: readonly PathRule[]): readonly string[] {
  const name = fileName(path);
  return rules.filter((rule) => rule.matches(path, name)).map((rule) => rule.id);
}
