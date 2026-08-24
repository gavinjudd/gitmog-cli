/**
 * Deterministic source features.
 *
 * Every field here is a count or ratio derived through bounded lexical traversal. Nothing
 * is parsed into an AST, nothing is imported, nothing is evaluated, and nothing is
 * executed — repository code under analysis is untrusted input and stays quoted data
 * (`packages/analyzers/AGENTS.md`).
 *
 * These features gate Code DNA labels and contribute to source-analysis confidence.
 * They are **personality evidence only** and never reach the Git Mog score.
 *
 * Pure: no I/O, no clock, no randomness.
 */

export const SOURCE_FEATURE_VERSION = "1.0.0-lexical-source-features";

export type SupportedFeatureLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "csharp"
  | "ruby"
  | "php"
  | "swift"
  | "kotlin"
  | "c"
  | "cpp"
  | "unknown";

export interface SourceFeatures {
  readonly language: SupportedFeatureLanguage;
  /** False when the language has no dedicated detectors, which lowers coverage rather
   * than producing a negative judgement. */
  readonly languageSupported: boolean;
  readonly totalLines: number;
  readonly nonBlankLines: number;
  readonly commentLines: number;
  readonly commentRatio: number;
  readonly averageLineLength: number;
  readonly maximumLineLength: number;
  readonly importCount: number;
  readonly functionCount: number;
  readonly classOrTypeCount: number;
  readonly typeAnnotationCount: number;
  readonly validationMarkers: number;
  readonly guardMarkers: number;
  readonly errorHandlingMarkers: number;
  readonly asyncMarkers: number;
  readonly maximumNestingDepth: number;
  readonly genericMarkers: number;
  readonly factoryMarkers: number;
  readonly protocolMarkers: number;
  readonly dataLibraryMarkers: number;
  readonly algorithmMarkers: number;
  readonly testMarkers: number;
  readonly configurationLines: number;
  readonly configurationRatio: number;
}

const EXTENSION_LANGUAGE: Readonly<Record<string, SupportedFeatureLanguage>> = Object.freeze({
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  vue: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  mm: "cpp",
});

export function featureLanguageOf(path: string): SupportedFeatureLanguage {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return "unknown";
  return EXTENSION_LANGUAGE[lower.slice(dot + 1)] ?? "unknown";
}

const LINE_COMMENT: Readonly<Record<string, readonly string[]>> = Object.freeze({
  python: ["#"],
  ruby: ["#"],
  default: ["//"],
});

const count = (source: string, pattern: RegExp): number => (source.match(pattern) ?? []).length;

const FUNCTION_PATTERNS: Readonly<Record<string, RegExp>> = Object.freeze({
  typescript:
    /\b(?:function\b|=>\s*\{|(?:public|private|protected|static)?\s*\w+\s*\([^)]*\)\s*\{)/g,
  javascript: /\b(?:function\b|=>\s*\{)/g,
  python: /^\s*(?:async\s+)?def\s+\w+/gm,
  go: /^\s*func\s+/gm,
  rust: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+/gm,
  java: /\b(?:public|private|protected|static)[\w\s<>,[\]]*\w+\s*\([^)]*\)\s*\{/g,
  csharp: /\b(?:public|private|protected|internal|static)[\w\s<>,[\]]*\w+\s*\([^)]*\)\s*\{/g,
  ruby: /^\s*def\s+\w+/gm,
  php: /\bfunction\s+\w*\s*\(/g,
  swift: /^\s*(?:public|private|internal|fileprivate)?\s*func\s+/gm,
  kotlin: /^\s*(?:suspend\s+)?fun\s+/gm,
  c: /^\s*[\w*]+\s+[\w*]+\s*\([^;]*\)\s*\{/gm,
  cpp: /^\s*[\w*:<>]+\s+[\w*:]+\s*\([^;]*\)\s*\{/gm,
});

const CLASS_PATTERNS: Readonly<Record<string, RegExp>> = Object.freeze({
  typescript: /\b(?:class|interface|type|enum)\s+\w+/g,
  javascript: /\bclass\s+\w+/g,
  python: /^\s*class\s+\w+/gm,
  go: /^\s*type\s+\w+\s+(?:struct|interface)\b/gm,
  rust: /^\s*(?:pub\s+)?(?:struct|enum|trait|impl)\s+/gm,
  java: /\b(?:class|interface|enum|record)\s+\w+/g,
  csharp: /\b(?:class|interface|struct|record|enum)\s+\w+/g,
  ruby: /^\s*(?:class|module)\s+\w+/gm,
  php: /\b(?:class|interface|trait)\s+\w+/g,
  swift: /\b(?:class|struct|protocol|enum|extension)\s+\w+/g,
  kotlin: /\b(?:class|interface|object|data class)\s+\w+/g,
  c: /\b(?:struct|union|enum|typedef)\s+\w+/g,
  cpp: /\b(?:class|struct|union|enum|typedef|namespace)\s+\w+/g,
});

const IMPORT_PATTERN =
  /^\s*(?:import\b|from\s+\S+\s+import\b|#include\b|use\s+[\w:]+;|require\s*\(|require\s+['"]|using\s+\w)/gm;

const TYPE_ANNOTATION =
  /(?::\s*(?:readonly\s+)?(?:string|number|boolean|unknown|void|never|object|[A-Z]\w*)(?:<[^>\n]{1,80}>)?(?:\[\])?)|(?:->\s*(?:int|str|float|bool|bytes|[A-Z]\w*))|(?:\bas\s+(?:const|unknown|never|[A-Z]\w*))|(?:\b(?:int|str|float|bool|bytes|List|Dict|Optional|Union)\b\s*[[\]:])/g;

const VALIDATION_MARKER =
  /\b(?:validate|validator|schema|parse(?:Safe)?|zod|pydantic|joi|yup|ajv|assert(?:_that|Equals)?|requir(?:e|ed|es)In|sanitiz|normaliz|ensure)\w*\s*\(/gi;

const GUARD_MARKER =
  /(?:\bif\s*\([^)]{1,80}\)\s*(?:\{\s*)?(?:return|throw|continue|break)\b)|(?:\bif\s+\S[^\n:]{0,80}:\s*(?:return|raise|continue|break)\b)|(?:\bif\s+err\s*!=\s*nil\b)|(?:\bguard\b[^\n]{0,80}else\b)|(?:\bunwrap_or\b)|(?:\?\?=?)/g;

const ERROR_MARKER =
  /\b(?:try\b|catch\b|except\b|rescue\b|finally\b|throw\b|raise\b|panic\b|recover\b|Result<|Either<|errors?\.(?:New|Is|As|Wrap)|\.catch\s*\(|onError)/g;

const ASYNC_MARKER =
  /\b(?:async\b|await\b|Promise\b|goroutine|go\s+func\b|tokio|asyncio|Mutex|RwLock|channel\b|chan\b|Thread\b|spawn\s*\(|\.then\s*\()/g;

const GENERIC_MARKER =
  /(?:<\s*[A-Z]\w{0,20}(?:\s*,\s*[A-Z]\w{0,20})*\s*(?:extends\s+[^>]{1,40})?>)|(?:\bimpl\s*<)|(?:\bTypeVar\s*\()|(?:\bGeneric\[)/g;

const FACTORY_MARKER =
  /\b(?:create[A-Z]\w*|make[A-Z]\w*|build[A-Z]\w*|\w*Factory\b|\w*Builder\b|\w*Provider\b|\w*Wrapper\b|\w*Adapter\b|\w*Decorator\b|withDefaults?|new\w+Instance)\b/g;

const PROTOCOL_MARKER =
  /\b(?:socket|TcpListener|TcpStream|net\.(?:Dial|Listen)|http\.(?:Server|Client|Handle)|grpc|protobuf|websocket|ByteBuffer|Uint8Array|readUInt|writeUInt|htonl|ntohs|\bmmap\b|epoll|kqueue|syscall|unsafe\b|Box<dyn|alloc\b|malloc\b|free\s*\()/gi;

const DATA_MARKER =
  /\b(?:numpy|np\.|pandas|pd\.|scipy|sklearn|torch|tensorflow|polars|pyarrow|matplotlib|plt\.|DataFrame|Series\b|ndarray|dataframe|duckdb|spark|dbt|\.groupby\(|\.agg\()/gi;

const ALGORITHM_MARKER =
  /\b(?:memo(?:ize|ised|ized)?|dynamic_programming|dijkstra|bfs\b|dfs\b|binary_search|binarySearch|quicksort|mergesort|heapify|priority_?queue|PriorityQueue|adjacency|visited\b|backtrack|permutation|combinatio|fibonacci|modulo|gcd\b|lcm\b|O\(n)/gi;

const TEST_MARKER =
  /\b(?:describe\s*\(|it\s*\(|test\s*\(|expect\s*\(|assert\w*\s*\(|@Test\b|def\s+test_|func\s+Test[A-Z]|#\[test\]|beforeEach|afterEach|mock\w*\s*\()/g;

const CONFIGURATION_LINE =
  /^\s*(?:(?:export\s+)?const\s+[A-Z0-9_]+\s*=|[A-Z0-9_]{3,}\s*[:=]\s*['"\d]|"[\w-]+"\s*:\s*['"\d[{])/gm;

function commentLineCount(lines: readonly string[], language: SupportedFeatureLanguage): number {
  const markers = LINE_COMMENT[language] ?? LINE_COMMENT["default"] ?? ["//"];
  let total = 0;
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (inBlock) {
      total += 1;
      if (line.includes("*/") || line.includes('"""') || line.includes("'''")) inBlock = false;
      continue;
    }
    if (line.startsWith("/*") || line.startsWith('"""') || line.startsWith("'''")) {
      total += 1;
      const opener = line.startsWith("/*") ? "*/" : line.slice(0, 3);
      if (!line.slice(3).includes(opener)) inBlock = true;
      continue;
    }
    if (markers.some((marker) => line.startsWith(marker))) total += 1;
  }
  return total;
}

/** Brace and indentation depth, whichever the language expresses nesting with. */
function nestingDepth(lines: readonly string[], language: SupportedFeatureLanguage): number {
  if (language === "python" || language === "ruby") {
    let deepest = 0;
    for (const line of lines) {
      if (line.trim() === "") continue;
      const indent = line.length - line.trimStart().length;
      deepest = Math.max(deepest, Math.floor(indent / 4));
    }
    return deepest;
  }
  let depth = 0;
  let deepest = 0;
  for (const character of lines.join("\n")) {
    if (character === "{" || character === "(" || character === "[") {
      depth += 1;
      deepest = Math.max(deepest, depth);
    } else if (character === "}" || character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
    }
  }
  return deepest;
}

const ratio = (part: number, whole: number): number =>
  whole <= 0 ? 0 : Math.round((part / whole) * 1000) / 1000;

const isWordCharacter = (character: string): boolean =>
  (character >= "a" && character <= "z") ||
  (character >= "0" && character <= "9") ||
  character === "_";

const isWhitespace = (character: string): boolean =>
  character.length > 0 && character.trim().length === 0;

const isLineTerminator = (character: string): boolean =>
  character === "\n" || character === "\r" || character === "\u2028" || character === "\u2029";

const sqlMarkerEnd = (source: string, selectIndex: number): number | null => {
  const afterSelect = selectIndex + "select".length;
  if (!isWhitespace(source[afterSelect] ?? "")) return null;

  let cursor = afterSelect;
  while (isWhitespace(source[cursor] ?? "")) cursor += 1;

  // The earlier expression could divide a run of two or more whitespace characters
  // between its leading and trailing groups when SELECT was followed directly by FROM.
  if (cursor - afterSelect >= 2 && source.startsWith("from", cursor)) {
    return cursor + "from".length;
  }

  while (cursor < source.length) {
    if (!isWhitespace(source[cursor] ?? "")) {
      cursor += 1;
      continue;
    }

    let crossedLineTerminator = false;
    while (isWhitespace(source[cursor] ?? "")) {
      if (isLineTerminator(source[cursor] ?? "")) crossedLineTerminator = true;
      cursor += 1;
    }
    if (source.startsWith("from", cursor)) return cursor + "from".length;
    if (crossedLineTerminator) return null;
  }
  return null;
};

/** Matches the prior case-insensitive SELECT whitespace content whitespace FROM
 * lexical signal, including its bounded multiline form, without regex backtracking. */
const countSqlSelectFromMarkers = (source: string): number => {
  const lower = source.toLowerCase();
  let total = 0;
  let searchFrom = 0;
  while (searchFrom < lower.length) {
    const selectIndex = lower.indexOf("select", searchFrom);
    if (selectIndex < 0) break;
    const before = selectIndex === 0 ? "" : (lower[selectIndex - 1] ?? "");
    if (selectIndex === 0 || !isWordCharacter(before)) {
      const markerEnd = sqlMarkerEnd(lower, selectIndex);
      if (markerEnd !== null) {
        total += 1;
        searchFrom = markerEnd;
        continue;
      }
    }
    searchFrom = selectIndex + "select".length;
  }
  return total;
};

export function extractSourceFeatures(path: string, source: string): SourceFeatures {
  const language = featureLanguageOf(path);
  const supported = language !== "unknown";
  const lines = source.split("\n");
  const nonBlank = lines.filter((line) => line.trim() !== "");
  const lengths = nonBlank.map((line) => line.length);
  const comments = commentLineCount(lines, language);

  const functionPattern = FUNCTION_PATTERNS[language];
  const classPattern = CLASS_PATTERNS[language];
  const configurationLines = count(source, CONFIGURATION_LINE);

  return {
    language,
    languageSupported: supported,
    totalLines: lines.length,
    nonBlankLines: nonBlank.length,
    commentLines: comments,
    commentRatio: ratio(comments, nonBlank.length),
    averageLineLength:
      lengths.length === 0
        ? 0
        : Math.round(lengths.reduce((total, value) => total + value, 0) / lengths.length),
    maximumLineLength: lengths.length === 0 ? 0 : Math.max(...lengths),
    importCount: count(source, IMPORT_PATTERN),
    functionCount: functionPattern === undefined ? 0 : count(source, functionPattern),
    classOrTypeCount: classPattern === undefined ? 0 : count(source, classPattern),
    typeAnnotationCount: count(source, TYPE_ANNOTATION),
    validationMarkers: count(source, VALIDATION_MARKER),
    guardMarkers: count(source, GUARD_MARKER),
    errorHandlingMarkers: count(source, ERROR_MARKER),
    asyncMarkers: count(source, ASYNC_MARKER),
    maximumNestingDepth: nestingDepth(lines, language),
    genericMarkers: count(source, GENERIC_MARKER),
    factoryMarkers: count(source, FACTORY_MARKER),
    protocolMarkers: count(source, PROTOCOL_MARKER),
    dataLibraryMarkers: count(source, DATA_MARKER) + countSqlSelectFromMarkers(source),
    algorithmMarkers: count(source, ALGORITHM_MARKER),
    testMarkers: count(source, TEST_MARKER),
    configurationLines,
    configurationRatio: ratio(configurationLines, nonBlank.length),
  };
}

/** Element-wise sum across samples, with ratios recomputed from the totals. */
export function mergeSourceFeatures(
  features: readonly SourceFeatures[],
): SourceFeatures & { readonly sampleCount: number; readonly supportedShare: number } {
  const total = <K extends keyof SourceFeatures>(key: K): number =>
    features.reduce((sum, entry) => sum + (entry[key] as number), 0);
  const nonBlankLines = total("nonBlankLines");
  const commentLines = total("commentLines");
  const configurationLines = total("configurationLines");
  const supported = features.filter((entry) => entry.languageSupported).length;

  return {
    language: features[0]?.language ?? "unknown",
    languageSupported: supported > 0,
    totalLines: total("totalLines"),
    nonBlankLines,
    commentLines,
    commentRatio: ratio(commentLines, nonBlankLines),
    averageLineLength:
      features.length === 0 ? 0 : Math.round(total("averageLineLength") / features.length),
    maximumLineLength: features.reduce(
      (largest, entry) => Math.max(largest, entry.maximumLineLength),
      0,
    ),
    importCount: total("importCount"),
    functionCount: total("functionCount"),
    classOrTypeCount: total("classOrTypeCount"),
    typeAnnotationCount: total("typeAnnotationCount"),
    validationMarkers: total("validationMarkers"),
    guardMarkers: total("guardMarkers"),
    errorHandlingMarkers: total("errorHandlingMarkers"),
    asyncMarkers: total("asyncMarkers"),
    maximumNestingDepth: features.reduce(
      (deepest, entry) => Math.max(deepest, entry.maximumNestingDepth),
      0,
    ),
    genericMarkers: total("genericMarkers"),
    factoryMarkers: total("factoryMarkers"),
    protocolMarkers: total("protocolMarkers"),
    dataLibraryMarkers: total("dataLibraryMarkers"),
    algorithmMarkers: total("algorithmMarkers"),
    testMarkers: total("testMarkers"),
    configurationLines,
    configurationRatio: ratio(configurationLines, nonBlankLines),
    sampleCount: features.length,
    supportedShare: ratio(supported, features.length),
  };
}

export type MergedSourceFeatures = ReturnType<typeof mergeSourceFeatures>;
