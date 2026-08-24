import { isSupportedLanguage, normalizeLanguage, type SupportedLanguage } from "./languages.js";

/**
 * Deliberately has no penalty field. PLANNING.md §4.3 and §11 require an
 * unsupported language to produce a coverage warning rather than a quality
 * deduction, and a type that cannot express a penalty enforces that more
 * strongly than a comment can.
 */
export interface LanguageCoverage {
  readonly supported: readonly SupportedLanguage[];
  readonly unsupported: readonly string[];
  readonly coverageWarning: boolean;
}

export function describeLanguageCoverage(languages: readonly string[]): LanguageCoverage {
  const supported = new Set<SupportedLanguage>();
  const unsupported = new Set<string>();

  for (const language of languages) {
    const normalized = normalizeLanguage(language);
    if (normalized === "") continue;
    if (isSupportedLanguage(normalized)) supported.add(normalized);
    else unsupported.add(normalized);
  }

  return {
    supported: [...supported].sort(),
    unsupported: [...unsupported].sort(),
    coverageWarning: unsupported.size > 0,
  };
}
