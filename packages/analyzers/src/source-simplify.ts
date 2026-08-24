import { featureLanguageOf, type SupportedFeatureLanguage } from "./source-features.js";

/**
 * In-memory source cleanup for bounded lexical analysis. This is deliberately a small,
 * deterministic text transform rather than a language parser: comment-only lines are
 * omitted where the syntax is unambiguous, and unusually long single-line strings are
 * shortened so prose and payloads cannot dominate an implementation sample.
 *
 * Pure: no I/O, no clock, no randomness, and no target code is parsed or executed.
 */

export const SOURCE_SIMPLIFICATION_VERSION = "1.0.0-implementation-signal";
export const LONG_STRING_CONTENT_LIMIT = 96;

export interface SimplifiedSource {
  readonly text: string;
  readonly commentLinesRemoved: number;
  readonly stringsShortened: number;
}

const HASH_COMMENT_LANGUAGES = new Set<SupportedFeatureLanguage>(["python", "ruby"]);

const shortenLongStrings = (line: string): { readonly text: string; readonly count: number } => {
  let shortened = 0;
  // Single-line strings only. Escaped delimiters are retained as part of the match, and
  // short strings stay byte-for-byte intact because they often carry useful API names.
  const text = line.replace(/(["'`])((?:\\.|(?!\1)[^\\\r\n])*)\1/g, (matched, quote, inner) => {
    if (typeof inner !== "string" || inner.length <= LONG_STRING_CONTENT_LIMIT) return matched;
    shortened += 1;
    return `${String(quote)}«string:${String(inner.length)} chars»${String(quote)}`;
  });
  return { text, count: shortened };
};

export function simplifySourceForFeatures(path: string, source: string): SimplifiedSource {
  const language = featureLanguageOf(path);
  const hashComments = HASH_COMMENT_LANGUAGES.has(language);
  const output: string[] = [];
  let inCommentOnlyBlock = false;
  let commentLinesRemoved = 0;
  let stringsShortened = 0;

  for (const rawLine of source.split("\n")) {
    const trimmed = rawLine.trim();

    if (inCommentOnlyBlock) {
      const closingIndex = rawLine.indexOf("*/");
      if (closingIndex < 0) {
        commentLinesRemoved += 1;
        continue;
      }
      inCommentOnlyBlock = false;
      const remainder = rawLine.slice(closingIndex + 2);
      if (remainder.trim().length === 0) {
        commentLinesRemoved += 1;
        continue;
      }
      const shortened = shortenLongStrings(remainder);
      stringsShortened += shortened.count;
      output.push(shortened.text);
      continue;
    }

    if (trimmed.startsWith("/*")) {
      const closingIndex = trimmed.indexOf("*/", 2);
      const isCommentOnly = closingIndex < 0 || trimmed.slice(closingIndex + 2).trim().length === 0;
      if (isCommentOnly) {
        commentLinesRemoved += 1;
        if (closingIndex < 0) inCommentOnlyBlock = true;
        continue;
      }
    }
    if (trimmed.startsWith("//") || (hashComments && trimmed.startsWith("#"))) {
      commentLinesRemoved += 1;
      continue;
    }

    const shortened = shortenLongStrings(rawLine);
    stringsShortened += shortened.count;
    output.push(shortened.text);
  }

  return {
    text: output.join("\n"),
    commentLinesRemoved,
    stringsShortened,
  };
}
