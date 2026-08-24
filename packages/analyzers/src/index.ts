export { describeLanguageCoverage, type LanguageCoverage } from "./coverage.js";
export {
  hasMainstreamLinter,
  isSupportedLanguage,
  normalizeLanguage,
  SUPPORTED_LANGUAGES,
  usesGradualTyping,
  type SupportedLanguage,
} from "./languages.js";
export {
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
  classifyPath,
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
  type PathKind,
  type PathRule,
} from "./paths.js";
export {
  MAX_REDACTED_SHARE,
  REDACTION_TOKEN,
  SOURCE_REDACTION_VERSION,
  redactSecretShapedValues,
  type RedactionResult,
} from "./redaction.js";
export {
  SOURCE_FEATURE_VERSION,
  extractSourceFeatures,
  featureLanguageOf,
  mergeSourceFeatures,
  type MergedSourceFeatures,
  type SourceFeatures,
  type SupportedFeatureLanguage,
} from "./source-features.js";
export {
  LONG_STRING_CONTENT_LIMIT,
  SOURCE_SIMPLIFICATION_VERSION,
  simplifySourceForFeatures,
  type SimplifiedSource,
} from "./source-simplify.js";
export {
  analyzeRepositoryTree,
  emptyRepositoryStructure,
  OVERSIZED_SOURCE_BYTES,
  type RepositoryStructure,
  type TreeEntry,
} from "./structure.js";
