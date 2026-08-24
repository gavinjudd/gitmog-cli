/** Initial language-specific support, from PLANNING.md §4.3. */
export const SUPPORTED_LANGUAGES = Object.freeze([
  "typescript",
  "javascript",
  "python",
  "go",
] as const);

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function normalizeLanguage(value: string): string {
  return value.trim().toLowerCase();
}

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(normalizeLanguage(value));
}

/**
 * SCORECARD.md CRAFT D: "Absence of a tool should only hurt when that tool is
 * appropriate." These two predicates are the applicability gate that rule requires;
 * ADR 0004 D4 records why a repository that fails one leaves the metric's denominator
 * instead of scoring zero.
 */
const LANGUAGES_WITH_MAINSTREAM_LINTERS = Object.freeze([
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "ruby",
  "php",
  "java",
  "kotlin",
  "swift",
  "c#",
  "c++",
  "scala",
  "dart",
  "elixir",
]);

/** Gradually typed: a type checker is a choice the author had to make. A statically
 * typed language is not penalised for having no type-checker configuration file. */
const GRADUALLY_TYPED_LANGUAGES = Object.freeze([
  "typescript",
  "javascript",
  "python",
  "php",
  "ruby",
]);

export function hasMainstreamLinter(language: string | null): boolean {
  if (language === null) return false;
  return LANGUAGES_WITH_MAINSTREAM_LINTERS.includes(normalizeLanguage(language));
}

export function usesGradualTyping(language: string | null): boolean {
  if (language === null) return false;
  return GRADUALLY_TYPED_LANGUAGES.includes(normalizeLanguage(language));
}
