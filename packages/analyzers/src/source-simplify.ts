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

const STRING_QUOTES = new Set(['"', "'", String.fromCharCode(96)]) as ReadonlySet<string>;

const closingQuotePositions = (line: string): Readonly<Record<string, readonly number[]>> => {
  const positions: Record<string, number[]> = { '"': [], "'": [], [String.fromCharCode(96)]: [] };
  let backslashes = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? "";
    if (STRING_QUOTES.has(character) && backslashes % 2 === 0) {
      positions[character]?.push(index);
    }
    backslashes = character === "\\" ? backslashes + 1 : 0;
  }
  return positions;
};

const shortenLongStrings = (line: string): { readonly text: string; readonly count: number } => {
  let shortened = 0;
  const closers = closingQuotePositions(line);
  const closerOffsets: Record<string, number> = {
    '"': 0,
    "'": 0,
    [String.fromCharCode(96)]: 0,
  };
  const output: string[] = [];
  let cursor = 0;

  // Single-line strings only. Escaped delimiters are retained, short strings remain
  // byte-identical, and malformed source cannot trigger regular-expression backtracking.
  while (cursor < line.length) {
    const quote = line[cursor] ?? "";
    if (!STRING_QUOTES.has(quote)) {
      output.push(quote);
      cursor += 1;
      continue;
    }

    const quoteClosers = closers[quote] ?? [];
    let closerOffset = closerOffsets[quote] ?? 0;
    while (closerOffset < quoteClosers.length && (quoteClosers[closerOffset] ?? -1) <= cursor) {
      closerOffset += 1;
    }
    closerOffsets[quote] = closerOffset;
    const closingIndex = quoteClosers[closerOffset];
    if (closingIndex === undefined) {
      output.push(quote);
      cursor += 1;
      continue;
    }

    const innerLength = closingIndex - cursor - 1;
    if (innerLength <= LONG_STRING_CONTENT_LIMIT) {
      output.push(line.slice(cursor, closingIndex + 1));
    } else {
      shortened += 1;
      output.push(quote + "«string:" + String(innerLength) + " chars»" + quote);
    }
    cursor = closingIndex + 1;
  }

  return { text: output.join(""), count: shortened };
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
