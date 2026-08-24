import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";

import { digest } from "@gitmog/github";
import ts from "typescript";

import {
  QUALITY_PARSER_CONTRACT_VERSION,
  type ParsedLocationMetric,
  type ParseQualityResult,
  type QualityLanguage,
} from "./types.js";

export const QUALITY_MAX_DECODED_BYTES_PER_FILE = 20 * 1024;
export const QUALITY_MAX_AST_NODES = 12_000;
export const QUALITY_MAX_NESTING_DEPTH = 128;
export const QUALITY_MAX_IMPORTS = 256;
export const QUALITY_MAX_SYMBOLS = 2_048;
export const QUALITY_MAX_TOKENS = 24_000;
export const QUALITY_PARSER_WALL_TIME_MS = 150;
const MAX_METRICS = 48;
const MAX_SHINGLES = 2_048;
const SHINGLE_SIZE = 12;

interface ParseOptions {
  readonly now?: (() => number) | undefined;
  readonly timeoutMs?: number | undefined;
}

const languageFor = (path: string): QualityLanguage | null => {
  const lower = path.toLowerCase();
  if (/\.(?:ts|tsx|mts|cts)$/u.test(lower)) return "typescript";
  if (/\.(?:js|jsx|mjs|cjs)$/u.test(lower)) return "javascript";
  return null;
};

const scriptKindFor = (path: string): ts.ScriptKind => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(?:js|mjs|cjs)$/u.test(lower)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
};

const lineRange = (file: ts.SourceFile, node: ts.Node): readonly [number, number] => {
  const start =
    file.getLineAndCharacterOfPosition(Math.max(0, node.getStart(file, false))).line + 1;
  const end = file.getLineAndCharacterOfPosition(Math.max(0, node.getEnd())).line + 1;
  return [start, Math.max(start, end)];
};

const callName = (expression: ts.Expression): string => {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return "";
};

const declarationIsExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
    false);

const isFunctionLike = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node);

const createsBranch = (node: ts.Node): boolean =>
  ts.isIfStatement(node) ||
  ts.isForStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isForOfStatement(node) ||
  ts.isWhileStatement(node) ||
  ts.isDoStatement(node) ||
  ts.isCaseClause(node) ||
  ts.isConditionalExpression(node) ||
  ts.isCatchClause(node) ||
  node.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
  node.kind === ts.SyntaxKind.BarBarToken ||
  node.kind === ts.SyntaxKind.QuestionQuestionToken;

const createsNesting = (node: ts.Node): boolean =>
  isFunctionLike(node) ||
  ts.isIfStatement(node) ||
  ts.isSwitchStatement(node) ||
  ts.isForStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isForOfStatement(node) ||
  ts.isWhileStatement(node) ||
  ts.isDoStatement(node) ||
  ts.isTryStatement(node) ||
  ts.isCatchClause(node);

const hasTypeContract = (node: ts.FunctionLikeDeclaration): boolean =>
  node.type !== undefined || node.parameters.some((parameter) => parameter.type !== undefined);

const isTerminalStatement = (node: ts.Statement): boolean =>
  ts.isReturnStatement(node) ||
  ts.isThrowStatement(node) ||
  ts.isBreakStatement(node) ||
  ts.isContinueStatement(node);

const normalizedTokens = (
  language: QualityLanguage,
  source: string,
):
  | { readonly ok: true; readonly tokens: readonly string[] }
  | { readonly ok: false; readonly reason: "token-limit" } => {
  const target = ts.ScriptTarget.ES2024;
  const scanner = ts.createScanner(
    target,
    true,
    language === "javascript" ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    source,
  );
  const values: string[] = [];
  while (true) {
    const token = scanner.scan();
    if (token === ts.SyntaxKind.EndOfFileToken) break;
    if (values.length >= QUALITY_MAX_TOKENS) return { ok: false, reason: "token-limit" };
    if (token === ts.SyntaxKind.Identifier || token === ts.SyntaxKind.PrivateIdentifier)
      values.push("id");
    else if (token === ts.SyntaxKind.NumericLiteral || token === ts.SyntaxKind.BigIntLiteral)
      values.push("num");
    else if (
      token === ts.SyntaxKind.StringLiteral ||
      token === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      token === ts.SyntaxKind.TemplateHead ||
      token === ts.SyntaxKind.TemplateMiddle ||
      token === ts.SyntaxKind.TemplateTail
    )
      values.push("str");
    else values.push(String(token));
  }
  return { ok: true, tokens: values };
};

const tokenShingles = (tokens: readonly string[]): readonly string[] => {
  const shingles = new Set<string>();
  for (
    let index = 0;
    index + SHINGLE_SIZE <= tokens.length && shingles.size < MAX_SHINGLES;
    index += 1
  ) {
    shingles.add(digest(tokens.slice(index, index + SHINGLE_SIZE).join("|")).slice(0, 20));
  }
  return [...shingles].sort();
};

/** Real TypeScript compiler AST parsing. Source lives only in this call and is never returned. */
export function parseQualitySource(
  path: string,
  source: string,
  options: ParseOptions = {},
): ParseQualityResult {
  const language = languageFor(path);
  if (language === null) return { ok: false, reason: "unsupported-language" };
  const byteLength = Buffer.byteLength(source, "utf8");
  if (byteLength > QUALITY_MAX_DECODED_BYTES_PER_FILE) return { ok: false, reason: "oversized" };
  const now = options.now ?? performance.now.bind(performance);
  const timeoutMs = options.timeoutMs ?? QUALITY_PARSER_WALL_TIME_MS;
  const started = now();
  const expired = (): boolean => now() - started > timeoutMs;

  let file: ts.SourceFile;
  try {
    file = ts.createSourceFile(path, source, ts.ScriptTarget.ES2024, true, scriptKindFor(path));
  } catch {
    return { ok: false, reason: "malformed-source" };
  }
  if (expired()) return { ok: false, reason: "timeout" };
  const diagnostics =
    (file as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? [];
  if (diagnostics.length > 0) return { ok: false, reason: "malformed-source" };

  const tokenized = normalizedTokens(language, source);
  if (!tokenized.ok) return tokenized;
  const tokens = tokenized.tokens;
  if (expired()) return { ok: false, reason: "timeout" };

  let nodeCount = 0;
  let importCount = 0;
  let symbolCount = 0;
  let functionCount = 0;
  let highComplexityFunctions = 0;
  let longFunctions = 0;
  let maximumComplexity = 0;
  let maximumNesting = 0;
  let validationCount = 0;
  let errorHandlingCount = 0;
  let swallowedErrors = 0;
  let assertionCount = 0;
  let testCaseCount = 0;
  let failurePathAssertions = 0;
  let skippedTestCount = 0;
  let exportedContractCount = 0;
  let typedContractCount = 0;
  let unsafeAnyCount = 0;
  let dynamicEvaluationCount = 0;
  let unsafeShellCount = 0;
  let secretLiteralCount = 0;
  let unreachableStatementCount = 0;
  const localImports: string[] = [];
  const metrics: ParsedLocationMetric[] = [];
  const functionComplexity = new Map<ts.FunctionLikeDeclaration, number>();
  const functionNodes = new Map<ts.FunctionLikeDeclaration, number>();
  const stack: Array<{
    readonly node: ts.Node;
    readonly depth: number;
    readonly nesting: number;
    readonly fn: ts.FunctionLikeDeclaration | null;
  }> = [{ node: file, depth: 0, nesting: 0, fn: null }];
  const addMetric = (
    metric: string,
    observed: number,
    node: ts.Node,
    applicability: string,
  ): void => {
    if (metrics.length >= MAX_METRICS) return;
    const [lineStart, lineEnd] = lineRange(file, node);
    metrics.push({ metric, observed, lineStart, lineEnd, applicability });
  };

  while (stack.length > 0) {
    if ((nodeCount & 127) === 0 && expired()) return { ok: false, reason: "timeout" };
    const current = stack.pop();
    if (current === undefined) break;
    nodeCount += 1;
    if (nodeCount > QUALITY_MAX_AST_NODES) return { ok: false, reason: "node-limit" };
    if (current.depth > QUALITY_MAX_NESTING_DEPTH) return { ok: false, reason: "depth-limit" };
    maximumNesting = Math.max(maximumNesting, current.nesting);
    const node = current.node;
    const activeFunction = isFunctionLike(node) ? node : current.fn;
    if (isFunctionLike(node)) {
      functionCount += 1;
      functionComplexity.set(node, 1);
      functionNodes.set(node, 0);
      if (hasTypeContract(node)) typedContractCount += 1;
      if (declarationIsExported(node)) exportedContractCount += 1;
    }
    if (activeFunction !== null && createsBranch(node)) {
      functionComplexity.set(activeFunction, (functionComplexity.get(activeFunction) ?? 1) + 1);
    }
    if (activeFunction !== null) {
      functionNodes.set(activeFunction, (functionNodes.get(activeFunction) ?? 0) + 1);
    }
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      importCount += 1;
      if (importCount > QUALITY_MAX_IMPORTS) return { ok: false, reason: "import-limit" };
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.startsWith(".")
      ) {
        localImports.push(node.moduleSpecifier.text.normalize("NFC"));
      }
    }
    if (
      ts.isVariableDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      symbolCount += 1;
      if (symbolCount > QUALITY_MAX_SYMBOLS) return { ok: false, reason: "symbol-limit" };
    }
    if (node.kind === ts.SyntaxKind.AnyKeyword) unsafeAnyCount += 1;
    if (ts.isThrowStatement(node) || ts.isTryStatement(node) || ts.isCatchClause(node))
      errorHandlingCount += 1;
    if (ts.isCatchClause(node) && node.block.statements.length === 0) {
      swallowedErrors += 1;
      addMetric("empty-catch", 1, node, "catch clause");
    }
    if (ts.isBlock(node)) {
      let terminalSeen = false;
      for (const statement of node.statements) {
        if (terminalSeen) {
          unreachableStatementCount += 1;
          addMetric("unreachable-after-terminal", 1, statement, "block statement");
        }
        if (isTerminalStatement(statement)) terminalSeen = true;
      }
    }
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      if (["validate", "parse", "safeParse", "assert", "assertEquals", "ensure"].includes(name))
        validationCount += 1;
      if (["expect", "assert", "assertEquals", "strictEqual", "deepEqual", "ok"].includes(name))
        assertionCount += 1;
      if (["test", "it"].includes(name)) testCaseCount += 1;
      if (["skip", "todo", "xit", "xtest"].includes(name)) skippedTestCount += 1;
      if (["toThrow", "rejects", "throws", "assertRejects"].includes(name))
        failurePathAssertions += 1;
      if (name === "eval" || name === "Function") {
        dynamicEvaluationCount += 1;
        addMetric("dynamic-evaluation", 1, node, "call expression");
      }
      if (
        ["exec", "execSync", "spawn", "spawnSync"].includes(name) &&
        node.arguments.some((argument) => ts.isTemplateExpression(argument))
      ) {
        unsafeShellCount += 1;
        addMetric("shell-template-construction", 1, node, "process invocation");
      }
    }
    if (
      ts.isStringLiteralLike(node) &&
      node.text.length <= 256 &&
      /(?:ghp_|github_pat_|sk-[A-Za-z0-9]|-----BEGIN [A-Z ]+PRIVATE KEY-----)/u.test(node.text)
    ) {
      secretLiteralCount += 1;
      addMetric("secret-shaped-literal", 1, node, "string literal");
    }
    const children: ts.Node[] = [];
    node.forEachChild((child) => {
      children.push(child);
    });
    const nextNesting = current.nesting + (createsNesting(node) ? 1 : 0);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined)
        stack.push({
          node: child,
          depth: current.depth + 1,
          nesting: nextNesting,
          fn: activeFunction,
        });
    }
  }

  for (const [fn, complexity] of functionComplexity) {
    maximumComplexity = Math.max(maximumComplexity, complexity);
    if (complexity > 10) {
      highComplexityFunctions += 1;
      addMetric("high-complexity-function", complexity, fn, "function or method");
    }
  }
  for (const [fn, nodes] of functionNodes) {
    if (nodes > 240) {
      longFunctions += 1;
      addMetric("long-function", nodes, fn, "function or method AST nodes");
    }
  }
  if (dynamicEvaluationCount > 0)
    addMetric("dynamic-evaluation-total", dynamicEvaluationCount, file, "implementation file");
  if (assertionCount > 0) addMetric("assertions", assertionCount, file, "test file");
  if (expired()) return { ok: false, reason: "timeout" };

  const nonBlankLines = source.split(/\r?\n/u).filter((line) => line.trim() !== "").length;
  return {
    ok: true,
    features: {
      language,
      parserVersion: `${QUALITY_PARSER_CONTRACT_VERSION}:typescript-${ts.version}`,
      byteLength,
      nonBlankLines,
      nodeCount,
      tokenCount: tokens.length,
      importCount,
      symbolCount,
      functionCount,
      highComplexityFunctions,
      longFunctions,
      maximumComplexity,
      maximumNesting,
      validationCount,
      errorHandlingCount,
      swallowedErrors,
      assertionCount,
      testCaseCount,
      failurePathAssertions,
      skippedTestCount,
      exportedContractCount,
      typedContractCount,
      unsafeAnyCount,
      dynamicEvaluationCount,
      unsafeShellCount,
      secretLiteralCount,
      unreachableStatementCount,
      localImports: [...new Set(localImports)].sort(),
      tokenShingles: tokenShingles(tokens),
      metrics,
    },
  };
}
