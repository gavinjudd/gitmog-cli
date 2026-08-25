import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

import { parseHandles, runBattle, runProfile, type BattleError } from "@gitmog/battle";
import {
  authorizeGithubDevice,
  GithubHttpClient,
  normalizeGithubLogin,
  type AuthenticationState,
  type GithubAllowanceResult,
  type GithubRequestPlan,
} from "@gitmog/github";
import {
  authorizePrivateGithubDevice,
  mixedPrivateArtifactIsSafe,
  runPrivateContext,
  validatePrivateContextAppConfig,
  type PrivateContextAppConfig,
  type PrivateContextError,
  type PrivateContextResult,
} from "@gitmog/private-context";
import { createFileCodeDnaCache, createFileDerivedFeatureCache } from "@gitmog/source-analysis";
import { createFileQualityResultCache } from "@gitmog/quality-judge";
import { parseRoastMode } from "@gitmog/scoring";

import { createPalette, parseColorMode, shouldUseColor } from "./color.js";
import { PLAIN_PALETTE } from "./color.js";
import {
  clearCache,
  CACHE_MARKER_NAME,
  enforceCacheCeiling,
  inspectCache,
  prepareCacheRoot,
  type CacheInspection,
  type CacheRootOptions,
} from "./cache-control.js";
import { createTerminalProgress, shouldRenderProgress, type ProgressClock } from "./progress.js";
import {
  prepareExportDestination,
  writeBattleExport,
  type ExportDestination,
} from "./export-artifact.js";
import { derivePresentationVerdict } from "./presentation-verdict.js";
import { renderBattle, renderCard, renderError, renderProfile } from "./render.js";
import { parseSharePreset, renderShare } from "./share.js";
import { createFileSnapshotCache, resolveCacheDirectory } from "./snapshot-store.js";
import { formatLocalReset, planGithubInvocation, resolveExplicitGithubToken } from "./preflight.js";

export interface CliContext {
  readonly invokedAs: string;
  readonly version: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: typeof globalThis.fetch | undefined;
  readonly now?: (() => number) | undefined;
  /** `process.stdout.isTTY`; final human output is written here. */
  readonly isTty?: boolean | undefined;
  /** Progress has a separate stderr boundary and never falls back to stdout. */
  readonly stderrIsTty?: boolean | undefined;
  readonly stdinIsTty?: boolean | undefined;
  readonly terminalColumns?: number | undefined;
  readonly writeProgress?: ((value: string) => void) | undefined;
  readonly progressClock?: ProgressClock | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly writeOutput?: ((value: string) => void) | undefined;
  readonly prompt?: ((question: string) => Promise<string>) | undefined;
  readonly readAllowance?:
    | ((options: {
        readonly token?: string | undefined;
        readonly fetchImpl?: typeof globalThis.fetch | undefined;
        readonly signal?: AbortSignal | undefined;
      }) => Promise<GithubAllowanceResult>)
    | undefined;
  readonly authorizeDevice?: typeof authorizeGithubDevice | undefined;
  readonly authorizePrivateDevice?: typeof authorizePrivateGithubDevice | undefined;
  readonly runPrivateContext?: typeof runPrivateContext | undefined;
  readonly privateContextAppConfig?: PrivateContextAppConfig | undefined;
  readonly home?: string | undefined;
  readonly cwd?: string | undefined;
  readonly platform?: string | undefined;
  /** Test-only formatting seam; public bins omit it so reset times use the local zone. */
  readonly timeZone?: string | undefined;
  /** Test-only boundary. Public bins never set this. */
  readonly skipBudgetPreflight?: boolean | undefined;
  readonly useFilesystem?: boolean | undefined;
}
export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function resolveInvocationName(
  executable: string | undefined,
  _env: Readonly<Record<string, string | undefined>>,
): string {
  const name = basename(executable ?? "gitmog").toLowerCase();
  return name.startsWith("git-mog") ? "git mog" : "gitmog";
}

export function usage(invokedAs = "gitmog"): string {
  const command = invokedAs === "git mog" ? "git mog" : "gitmog";
  return [
    "GIT MOG",
    "Compare public GitHub work for fun.",
    "",
    "Run a battle:",
    "  npx -y gitmog <left> <right>",
    "",
    "Check one profile:",
    "  npx -y gitmog <username>",
    "",
    "Paste a username, @handle, or https://github.com/profile URL.",
    `Installed: ${command} <left> <right>`,
    "",
    "Try a famous matchup:",
    "  npx -y gitmog torvalds gvanrossum",
    "  npx -y gitmog karpathy geohot",
    "  Public profiles. No affiliation or endorsement implied.",
    "",
    "Common options:",
    "  --card       Compact battle card",
    "  --share      Share-ready text",
    "  --details    Full score breakdown",
    "  --receipts   Every supporting receipt",
    "  --export     Self-contained .html or .svg battle",
    "  --no-quality Disable the automatic code-quality preview",
    "  --private-context  Add selected private repositories separately",
    "  --public-only      Suppress every private prompt and endpoint",
    "",
    "Coverage is the share of the public scorecard Git Mog could measure.",
    "If GitHub's anonymous limit is low, Git Mog may offer one-time sign-in.",
    "Code Quality Preview is parser-backed and never affects the winner.",
    "Entertainment based on public evidence—not a hiring score.",
    `More options: ${command} --help-all`,
    "",
  ].join("\n");
}

export function advancedUsage(invokedAs = "gitmog"): string {
  const command = invokedAs === "git mog" ? "git mog" : "gitmog";
  return [
    "GIT MOG // ALL OPTIONS",
    "",
    `Usage: ${command} <username>`,
    `       ${command} <left> <right>`,
    "",
    "Output:",
    "  --card                       Compact battle card",
    "  --share plain|x|discord|linkedin",
    "  --caption                    Alias for --share plain",
    "  --details                    Full score breakdown",
    "  --receipts                   Every supporting receipt",
    "  --export <path.html|path.svg> Self-contained battle file",
    "  --json                       JSON only",
    "  --roast clean|spicy|unhinged",
    "  --color auto|always|never",
    "  --no-motion                  Static progress updates",
    "  --quality                    Require the full request tier; fail closed if unavailable",
    "  --no-quality                 Disable Code Quality Preview",
    "",
    "GitHub and cache:",
    "  --sign-in                    One-time GitHub sign-in for this run",
    "  --anonymous                  Never prompt; allow an honest limited read",
    "  --private-context            Add selected private repositories separately",
    "  --public-only                Suppress every private prompt and endpoint",
    "  --no-prompt                  Return instead of prompting",
    "  --refresh                    Refresh stable cached evidence",
    "  --no-cache                   Read and write no Git Mog cache",
    "  --cache-info                 Show Git Mog cache usage",
    "  --clear-cache                Clear only the Git Mog cache",
    "",
    "Local:",
    "  --version",
    "  --help, -h",
    "  --help-all",
    "",
  ].join("\n");
}

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  "help-all": { type: "boolean" },
  version: { type: "boolean" },
  json: { type: "boolean" },
  card: { type: "boolean" },
  caption: { type: "boolean" },
  refresh: { type: "boolean" },
  "no-cache": { type: "boolean" },
  details: { type: "boolean" },
  receipts: { type: "boolean" },
  roast: { type: "string" },
  share: { type: "string" },
  color: { type: "string" },
  "sign-in": { type: "boolean" },
  anonymous: { type: "boolean" },
  "no-prompt": { type: "boolean" },
  "no-motion": { type: "boolean" },
  quality: { type: "boolean" },
  "no-quality": { type: "boolean" },
  "cache-info": { type: "boolean" },
  "clear-cache": { type: "boolean" },
  "private-context": { type: "boolean" },
  "public-only": { type: "boolean" },
  export: { type: "string" },
} as const;

const cacheRootOptions = (context: CliContext): CacheRootOptions => {
  const platform = context.platform ?? process.platform;
  const home = context.home;
  const directory = resolveCacheDirectory(context.env, home, platform);
  return {
    directory,
    ...(home === undefined ? {} : { home }),
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
    platform,
    allowLegacy: context.env.GITMOG_CACHE_DIR?.trim() ? false : true,
    npmCacheDirectories: [context.env.npm_config_cache, context.env.NPM_CONFIG_CACHE].filter(
      (value): value is string => value !== undefined && value.trim() !== "",
    ),
  };
};

const renderCacheInfo = (info: CacheInspection): string =>
  [
    "GIT MOG CACHE",
    `Path: ${info.path}`,
    `Usage: ${String(info.totalBytes)} bytes across ${String(info.fileCount)} files`,
    `Maximum: ${String(info.maximumBytes)} bytes (25 MiB)`,
    `Entries: ${String(info.snapshotEntries)} snapshots · ${String(info.analysisEntries)} analyses · ${String(info.derivedFeatureEntries)} derived · ${String(info.qualityEntries)} quality`,
    `Oldest valid entry: ${info.oldestValidEntryAt ?? "none"}`,
    `Newest valid entry: ${info.newestValidEntryAt ?? "none"}`,
    `Removed during inspection: ${String(info.expiredOrCorruptEntriesRemoved)} expired/corrupt`,
    "Raw source is never stored.",
    "Private Context source and results are never stored.",
    "npm's cache is separate and is not controlled by Git Mog.",
    "",
  ].join("\n");

const cacheCommandFailure = (message: string, json: boolean): CliResult =>
  json
    ? {
        exitCode: 2,
        stdout: `${JSON.stringify(
          { error: { code: "cache_path_refused", message, retryable: false } },
          null,
          2,
        )}\n`,
        stderr: "",
      }
    : { exitCode: 2, stdout: "", stderr: `CACHE PATH REFUSED\n\n${message}\n` };

export type JsonErrorCode =
  | "invalid_handle"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "upstream_failure"
  | "export_failed"
  | "usage";

const privateContextFailure = (
  error: PrivateContextError,
  jsonRequested: boolean,
  publicStdout = "",
): CliResult =>
  jsonRequested
    ? {
        exitCode: 1,
        stdout: `${JSON.stringify({ error: { ...error, retryable: false } }, null, 2)}\n`,
        stderr: "",
      }
    : {
        exitCode: 1,
        stdout: publicStdout,
        stderr: `${
          error.code === "private_context_identity_mismatch"
            ? "PRIVATE CONTEXT NOT AVAILABLE"
            : error.code === "private_context_installation_required"
              ? "PRIVATE CONTEXT · OPTIONAL"
              : error.code === "private_context_selected_repositories_required"
                ? "PRIVATE CONTEXT REQUIRES SELECTED REPOSITORIES"
                : "PRIVATE CONTEXT NOT AVAILABLE"
        }\n\n${error.signedInAs === undefined ? "" : `Signed in as @${error.signedInAs}.\n`}${error.message}${error.installationUrl === undefined ? "" : `\n\nOpen:\n${error.installationUrl}\n\nReturn here after installation.`}\n`,
      };

const jsonFailure = (
  code: JsonErrorCode,
  message: string,
  retryable: boolean,
  exitCode: 1 | 2,
): CliResult => ({
  exitCode,
  stdout: `${JSON.stringify({ error: { code, message, retryable } }, null, 2)}\n`,
  stderr: "",
});

const mixedJson = (value: unknown, privateContext?: PrivateContextResult): string => {
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  if (privateContext !== undefined && !mixedPrivateArtifactIsSafe(rendered, privateContext)) {
    throw new Error("Mixed-context JSON failed its privacy boundary.");
  }
  return rendered;
};

const invalid = (message: string, invokedAs: string, jsonRequested = false): CliResult =>
  jsonRequested
    ? jsonFailure("usage", message, false, 2)
    : {
        exitCode: 2,
        stdout: "",
        stderr: renderError({ code: "invalid_handle", message }, { invokedAs }),
      };

const budgetFailure = (
  plan: GithubRequestPlan,
  invokedAs: string,
  jsonRequested: boolean,
  code: "github_limit_reached" | "github_budget_limited" | "github_preflight_failed",
  message: string,
  timeZone?: string,
): CliResult => {
  if (jsonRequested) {
    return {
      exitCode: 1,
      stdout: `${JSON.stringify(
        {
          error: {
            code,
            message,
            retryable: true,
            authenticationState: plan.authenticationState,
            rateLimitClass: plan.rateLimitClass,
            remaining: plan.remaining,
            resetAt: plan.resetAt,
            retryAfterSeconds: plan.retryAfterSeconds,
            limitedRunPossible: plan.limitedRunPossible,
            collectionBegan: false,
          },
          requestPlan: plan,
        },
        null,
        2,
      )}\n`,
      stderr: "",
    };
  }
  const reset = formatLocalReset(plan.resetAt, timeZone);
  return {
    exitCode: 1,
    stdout: "",
    stderr: [
      code === "github_limit_reached" ? "GITHUB LIMIT REACHED" : "GITHUB CHECK NEEDED",
      "",
      message,
      `Resets: ${reset}`,
      `Retry: ${invokedAs} ${plan.profileCount === 1 ? "<username>" : "<left> <right>"}`,
      `Sign in once: ${invokedAs} --sign-in ${
        plan.profileCount === 1 ? "<username>" : "<left> <right>"
      }`,
      "",
    ].join("\n"),
  };
};

export const qualityPreflightMessage = (plan: GithubRequestPlan["quality"]): string => {
  switch (plan.limitationReason) {
    case "request-budget-limited":
      return "More GitHub requests may improve Code Quality Preview.\nComplete coverage also depends on supported TypeScript/JavaScript source.";
    case "mixed":
      return "More GitHub requests may help, but supported-source coverage will still be limited.";
    case "supported-language-limited":
    case "eligible-source-limited":
      return "Code Quality Preview is limited by supported source, not GitHub request capacity. Sign-in will not change this result.";
    case "attribution-limited":
      return "Code Quality Preview is limited by user-linked attribution, not GitHub request capacity.";
    default:
      return "Code Quality Preview coverage is limited; the current evidence does not show that sign-in would improve it.";
  }
};

const authorizeOnce = async (
  context: CliContext,
): Promise<
  { readonly ok: true; readonly token: string } | { readonly ok: false; readonly message: string }
> => {
  const authorize = context.authorizeDevice ?? authorizeGithubDevice;
  const result = await authorize({
    ...(context.fetchImpl === undefined ? {} : { fetchImpl: context.fetchImpl }),
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    onPrompt: (prompt) => {
      context.writeOutput?.(
        [
          "SIGN IN TO GITHUB FOR THIS RUN",
          "",
          `Open: ${prompt.verificationUri}`,
          `Code: ${prompt.userCode}`,
          "",
          "Git Mog will continue here after approval. The token stays in memory only.",
          "",
        ].join("\n"),
      );
    },
  });
  if (!result.ok) {
    const messages = {
      access_denied: "GitHub sign-in was denied.",
      expired: "The GitHub sign-in code expired.",
      cancelled: "GitHub sign-in was cancelled.",
      network: "GitHub sign-in could not reach GitHub.",
      timeout: "GitHub sign-in timed out.",
      malformed: "GitHub returned an unreadable sign-in response.",
      configuration: "GitHub sign-in is not configured for this build.",
    } as const;
    return { ok: false, message: messages[result.error] };
  }
  if (result.scopes.length !== 0) {
    return { ok: false, message: "GitHub returned permissions Git Mog did not request." };
  }
  return { ok: true, token: result.token };
};

const authenticatedPublicLogin = async (
  token: string,
  context: CliContext,
): Promise<string | null> => {
  const client = new GithubHttpClient({
    token,
    ...(context.fetchImpl === undefined ? {} : { fetchImpl: context.fetchImpl }),
    maxRequests: 1,
    userAgent: "gitmog-public-capacity-identity",
  });
  const response = await client.get<unknown>("/user");
  if (!response.ok || typeof response.data !== "object" || response.data === null) return null;
  const login = (response.data as { readonly login?: unknown }).login;
  return typeof login === "string" ? normalizeGithubLogin(login) : null;
};

const collectPrivateContext = async (
  handles: readonly [string] | readonly [string, string],
  publicToken: string | undefined,
  context: CliContext,
): Promise<{ readonly result?: PrivateContextResult; readonly error?: PrivateContextError }> => {
  const validated = validatePrivateContextAppConfig(context.privateContextAppConfig);
  if (!validated.ok) {
    return {
      error: {
        code: "private_context_configuration_invalid",
        message: "This build does not contain a valid Private Context GitHub App contract.",
      },
    };
  }
  const authorize = context.authorizePrivateDevice ?? authorizePrivateGithubDevice;
  const authorized = await authorize({
    config: validated.config,
    ...(publicToken === undefined ? {} : { forbiddenTokens: [publicToken] }),
    ...(context.fetchImpl === undefined ? {} : { fetchImpl: context.fetchImpl }),
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    onPrompt: (prompt) => {
      context.writeOutput?.(
        [
          "PRIVATE CONTEXT SIGN-IN",
          "",
          "Git Mog will request read-only metadata and contents access for the private",
          "repositories selected in the GitHub App installation.",
          "",
          "It cannot write, administer, read secrets, or execute repository code.",
          "The token stays in memory for this run.",
          "",
          `Open: ${prompt.verificationUri}`,
          `Code: ${prompt.userCode}`,
          "",
        ].join("\n"),
      );
    },
  });
  if (!authorized.ok) {
    const code =
      authorized.error === "conflicting_token_boundary"
        ? "private_context_conflicting_token_boundaries"
        : authorized.error === "access_denied"
          ? "private_context_auth_denied"
          : authorized.error === "expired"
            ? "private_context_auth_expired"
            : "private_context_auth_failed";
    return {
      error: {
        code,
        message: "Private Context authorization did not complete. The public result is unchanged.",
      },
    };
  }
  const privateRunner = context.runPrivateContext ?? runPrivateContext;
  const outcome = await authorized.lease.use((token) =>
    privateRunner({
      handles,
      token,
      config: validated.config,
      ...(context.fetchImpl === undefined ? {} : { fetchImpl: context.fetchImpl }),
      ...(context.signal === undefined ? {} : { signal: context.signal }),
      ...(context.now === undefined ? {} : { now: context.now }),
    }),
  );
  authorized.lease.dispose();
  return outcome.ok ? { result: outcome.result } : { error: outcome.error };
};

const machineErrorCode = (error: BattleError): JsonErrorCode =>
  error.code === "invalid_handle" ||
  error.code === "not_found" ||
  error.code === "rate_limited" ||
  error.code === "timeout"
    ? error.code
    : "upstream_failure";

const serviceFailure = (
  error: BattleError,
  jsonRequested: boolean,
  handles: readonly string[],
  context: Pick<CliContext, "invokedAs" | "terminalColumns" | "timeZone">,
  authenticationState: AuthenticationState,
): CliResult =>
  jsonRequested
    ? {
        exitCode: 1,
        stdout: `${JSON.stringify(
          {
            error: {
              code: machineErrorCode(error),
              message: error.message,
              retryable: [
                "rate_limited",
                "timeout",
                "network_error",
                "upstream_error",
                "internal_error",
              ].includes(error.code),
              authenticationState,
              rateLimitClass: error.rateLimitClass ?? "none",
              remaining: error.remaining ?? null,
              resetAt: error.resetAt ?? null,
              retryAfterSeconds: error.retryAfterSeconds ?? null,
              limitedRunPossible: error.limitedRunPossible ?? false,
              collectionBegan: error.collectionBegan ?? true,
            },
          },
          null,
          2,
        )}\n`,
        stderr: "",
      }
    : {
        exitCode: 1,
        stdout: "",
        stderr: renderError(error, {
          handles,
          invokedAs: context.invokedAs,
          columns: context.terminalColumns,
          timeZone: context.timeZone,
        }),
      };
const withoutScanType = <T extends { readonly scanType: unknown }>(
  value: T,
): Omit<T, "scanType"> => {
  const { scanType: _scanType, ...publicValue } = value;
  return publicValue;
};
const battleJson = (battle: Awaited<ReturnType<typeof runBattle>> & { readonly ok: true }) => ({
  ...withoutScanType(battle.battle),
  left: withoutScanType(battle.battle.left),
  right: withoutScanType(battle.battle.right),
});

export async function run(argv: readonly string[], context: CliContext): Promise<CliResult> {
  const jsonRequested = argv.slice(2).includes("--json");
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv.slice(2),
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    return invalid(
      error instanceof Error ? error.message : "Invalid command line.",
      context.invokedAs,
      jsonRequested,
    );
  }
  const values = parsed.values;
  const roastValue = typeof values.roast === "string" ? values.roast : undefined;
  const colorValue = typeof values.color === "string" ? values.color : undefined;
  const shareValue = typeof values.share === "string" ? values.share : undefined;
  const exportValue = typeof values.export === "string" ? values.export : undefined;
  let positionals = [...parsed.positionals];
  const cacheInfoRequested = values["cache-info"] === true;
  const clearCacheRequested = values["clear-cache"] === true;
  if (cacheInfoRequested || clearCacheRequested) {
    const allowed = new Set(["cache-info", "clear-cache", "json"]);
    const incompatible = Object.entries(values).some(
      ([name, value]) => value !== undefined && value !== false && !allowed.has(name),
    );
    if (cacheInfoRequested === clearCacheRequested || positionals.length !== 0 || incompatible) {
      return invalid(
        "Use exactly one cache command with no profile handles; --json is optional.",
        context.invokedAs,
        values.json === true,
      );
    }
    const rootOptions = cacheRootOptions(context);
    if (cacheInfoRequested) {
      const inspected = inspectCache(rootOptions);
      if (!inspected.ok) return cacheCommandFailure(inspected.error, values.json === true);
      return values.json === true
        ? {
            exitCode: 0,
            stdout: `${JSON.stringify(
              { cache: { action: "info", ...inspected.value } },
              null,
              2,
            )}\n`,
            stderr: "",
          }
        : { exitCode: 0, stdout: renderCacheInfo(inspected.value), stderr: "" };
    }
    const cleared = clearCache(rootOptions);
    if (!cleared.ok) return cacheCommandFailure(cleared.error, values.json === true);
    return values.json === true
      ? {
          exitCode: 0,
          stdout: `${JSON.stringify({ cache: { action: "clear", ...cleared.value } }, null, 2)}\n`,
          stderr: "",
        }
      : {
          exitCode: 0,
          stdout: [
            "GIT MOG CACHE CLEARED",
            `Path: ${cleared.value.path}`,
            `Removed: ${String(cleared.value.bytesRemoved)} bytes across ${String(cleared.value.filesRemoved)} files`,
            "npm's cache was not touched.",
            "Private Context stores no cache and had nothing to clear.",
            "",
          ].join("\n"),
          stderr: "",
        };
  }
  if (values["help-all"] === true) {
    return { exitCode: 0, stdout: advancedUsage(context.invokedAs), stderr: "" };
  }
  if (
    values.help === true ||
    argv.slice(2).length === 0 ||
    (positionals.length === 1 && positionals[0]?.toLowerCase() === "help")
  ) {
    return { exitCode: 0, stdout: usage(context.invokedAs), stderr: "" };
  }
  if (
    values.version === true ||
    (positionals.length === 1 && positionals[0]?.toLowerCase() === "version")
  ) {
    return { exitCode: 0, stdout: `${context.version}\n`, stderr: "" };
  }
  if (positionals.length < 1 || positionals.length > 2) {
    return invalid(
      "Current usage accepts one profile or exactly two battle handles.",
      context.invokedAs,
      values.json === true,
    );
  }
  const roast = parseRoastMode(roastValue ?? null);
  if (values.roast !== undefined && roast === null)
    return invalid("Invalid --roast value.", context.invokedAs, values.json === true);
  const color = parseColorMode(colorValue ?? "auto");
  if (color === null)
    return invalid("Invalid --color value.", context.invokedAs, values.json === true);
  const parsedShare = shareValue === undefined ? null : parseSharePreset(shareValue);
  if (shareValue !== undefined && parsedShare === null)
    return invalid("Invalid --share value.", context.invokedAs, values.json === true);
  if (values.caption === true && shareValue !== undefined) {
    return invalid(
      "--caption cannot be combined with --share.",
      context.invokedAs,
      values.json === true,
    );
  }
  const share = values.caption === true ? "plain" : parsedShare;
  const exportRequested = exportValue !== undefined;
  const outputModeCount =
    Number(values.json === true && !exportRequested) +
    Number(values.card === true) +
    Number(share !== null) +
    Number(exportRequested);
  if (outputModeCount > 1) {
    return invalid(
      "Choose only one primary output mode: terminal, --json, --card, --share, or --export.",
      context.invokedAs,
      values.json === true,
    );
  }
  if (values.receipts === true && outputModeCount > 0) {
    return invalid(
      "--receipts is available only for normal terminal output.",
      context.invokedAs,
      values.json === true,
    );
  }
  if (values.details === true && outputModeCount > 0) {
    return invalid(
      "--details is available only for normal terminal output.",
      context.invokedAs,
      values.json === true,
    );
  }
  if (positionals.length === 1 && (values.card === true || share !== null || exportRequested)) {
    return invalid(
      "--card, --share, and --export require two battle handles.",
      context.invokedAs,
      values.json === true,
    );
  }
  if (values["sign-in"] === true && values.anonymous === true) {
    return invalid(
      "--sign-in cannot be combined with --anonymous.",
      context.invokedAs,
      values.json === true,
    );
  }
  if (values["private-context"] === true && values.anonymous === true) {
    return invalid(
      "--private-context cannot be combined with --anonymous; anonymous runs are public-only.",
      context.invokedAs,
      values.json === true,
    );
  }
  if (values["private-context"] === true && values["public-only"] === true) {
    return invalid(
      "--private-context cannot be combined with --public-only.",
      context.invokedAs,
      values.json === true,
    );
  }
  const publicOnly = values["public-only"] === true || values.anonymous === true;
  let privateContextRequested = values["private-context"] === true;
  if (
    privateContextRequested &&
    (values["no-prompt"] === true || context.prompt === undefined || context.stdinIsTty === false)
  ) {
    return privateContextFailure(
      {
        code: "private_context_auth_required",
        message: "Private Context requires an interactive, session-only GitHub App sign-in.",
      },
      values.json === true,
    );
  }
  if (values.quality === true && values["no-quality"] === true) {
    return invalid(
      "--quality cannot be combined with --no-quality.",
      context.invokedAs,
      values.json === true,
    );
  }
  if (values.quality === true && values.anonymous === true) {
    return invalid(
      "--quality cannot be combined with --anonymous because a complete preview may require sign-in.",
      context.invokedAs,
      values.json === true,
    );
  }
  let qualityEnabledForRun = values["no-quality"] !== true;
  if (values["sign-in"] === true && values.json === true) {
    return invalid(
      "--sign-in is interactive and cannot be combined with --json.",
      context.invokedAs,
      true,
    );
  }
  let exportDestination: ExportDestination | null = null;
  if (exportValue !== undefined) {
    const prepared = prepareExportDestination(exportValue, context.cwd ?? process.cwd());
    if (!prepared.ok) return invalid(prepared.error, context.invokedAs, values.json === true);
    exportDestination = prepared.value;
  }
  if (positionals.length === 1) {
    const handle = normalizeGithubLogin(positionals[0] as string);
    if (handle === null) {
      return invalid(
        "Enter a GitHub username or profile URL.",
        context.invokedAs,
        values.json === true,
      );
    }
    positionals = [handle];
  } else if (positionals.length === 2) {
    const handles = parseHandles(positionals[0] as string, positionals[1] as string);
    if (!handles.ok) {
      return invalid(handles.error.message, context.invokedAs, values.json === true);
    }
    positionals = [handles.left, handles.right];
  }

  const explicitToken = resolveExplicitGithubToken(context.env);
  if (!explicitToken.ok) {
    return invalid(
      "GITHUB_TOKEN and GH_TOKEN are both set to different values. Keep only one.",
      context.invokedAs,
      values.json === true,
    );
  }
  if (values["sign-in"] === true && explicitToken.token !== undefined) {
    return invalid(
      "--sign-in cannot be combined with GITHUB_TOKEN or GH_TOKEN.",
      context.invokedAs,
      values.json === true,
    );
  }
  if (values.anonymous === true && explicitToken.token !== undefined) {
    return invalid(
      "--anonymous cannot be combined with GITHUB_TOKEN or GH_TOKEN.",
      context.invokedAs,
      values.json === true,
    );
  }

  const noCache = values["no-cache"] === true;
  const useFilesystem = context.useFilesystem !== false;
  const rootOptions = cacheRootOptions(context);
  const canOfferSecondaryPrivateContext =
    !publicOnly &&
    values.anonymous !== true &&
    values["no-prompt"] !== true &&
    values.json !== true &&
    context.prompt !== undefined &&
    context.stdinIsTty !== false;
  const cacheMarkerExists = existsSync(join(rootOptions.directory, CACHE_MARKER_NAME));
  const deferNewCacheRoot =
    !noCache &&
    useFilesystem &&
    !cacheMarkerExists &&
    (privateContextRequested || canOfferSecondaryPrivateContext);
  let cacheDirectory = rootOptions.directory;
  const afterCacheWrite = (): void => {
    enforceCacheCeiling({ ...rootOptions, directory: cacheDirectory });
  };
  let snapshotCache: ReturnType<typeof createFileSnapshotCache> | null = null;
  let sourceCache: ReturnType<typeof createFileCodeDnaCache> | null = null;
  let derivedCache: ReturnType<typeof createFileDerivedFeatureCache> | null = null;
  let qualityCache: ReturnType<typeof createFileQualityResultCache> | null = null;
  const initializePersistentCache = (): void => {
    if (noCache || !useFilesystem || snapshotCache !== null) return;
    const prepared = prepareCacheRoot(rootOptions);
    if (!prepared.ok) return;
    cacheDirectory = prepared.value;
    snapshotCache = createFileSnapshotCache({
      directory: join(cacheDirectory, "snapshots"),
      afterWrite: afterCacheWrite,
    });
    sourceCache = createFileCodeDnaCache({
      directory: join(cacheDirectory, "analysis"),
      afterWrite: afterCacheWrite,
    });
    derivedCache = createFileDerivedFeatureCache({
      directory: join(cacheDirectory, "features"),
      afterWrite: afterCacheWrite,
    });
    qualityCache = createFileQualityResultCache({
      directory: join(cacheDirectory, "quality"),
      afterWrite: afterCacheWrite,
    });
  };
  if (!deferNewCacheRoot) initializePersistentCache();
  let cachePolicy: { read: boolean; write: boolean } = {
    read: !noCache && values.refresh !== true,
    write: !noCache && !privateContextRequested,
  };
  let invocationToken = explicitToken.token;
  let invocationAuthenticationState: AuthenticationState =
    invocationToken === undefined ? "anonymous" : "explicit";
  let requestPlan: GithubRequestPlan | null = null;
  let publicSignInJustSucceeded = false;
  if (context.skipBudgetPreflight !== true) {
    let authenticationState: AuthenticationState = invocationAuthenticationState;
    if (values["sign-in"] === true) {
      const authorized = await authorizeOnce(context);
      if (!authorized.ok) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `GITHUB SIGN-IN STOPPED\n\n${authorized.message}\n`,
        };
      }
      invocationToken = authorized.token;
      authenticationState = "device";
      invocationAuthenticationState = "device";
      publicSignInJustSucceeded = true;
      context.writeOutput?.(
        "Signed in for public API capacity. Private repositories are still excluded.\n",
      );
    }

    const makePlan = async () =>
      planGithubInvocation({
        handles: positionals as [string] | [string, string],
        authenticationState,
        ...(invocationToken === undefined ? {} : { token: invocationToken }),
        caches: {
          snapshots: snapshotCache,
          analyses: sourceCache,
          quality: qualityCache,
          read: cachePolicy.read,
        },
        qualityEnabled: qualityEnabledForRun,
        ...(context.fetchImpl === undefined ? {} : { fetchImpl: context.fetchImpl }),
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        ...(context.readAllowance === undefined ? {} : { readAllowance: context.readAllowance }),
      });
    let planned = await makePlan();
    if (!planned.ok) {
      return budgetFailure(
        planned.plan,
        context.invokedAs,
        values.json === true,
        "github_preflight_failed",
        "Git Mog could not check GitHub's current request allowance. No collection began.",
        context.timeZone,
      );
    }
    requestPlan = planned.plan;

    if (
      requestPlan.disposition !== "complete" &&
      invocationToken === undefined &&
      values.anonymous !== true &&
      values["no-prompt"] !== true &&
      values.json !== true &&
      context.isTty === true &&
      context.prompt !== undefined
    ) {
      const remaining = requestPlan.remaining ?? "unknown";
      const need = requestPlan.expectedCurrentRequests;
      const choices = requestPlan.limitedRunPossible
        ? "[s] sign in once, [l] continue with a limited public read, [c] cancel"
        : "[s] sign in once, [c] cancel";
      const answer = (
        await context.prompt(
          `GitHub has ${remaining} requests left; this read can use up to ${need}.\n${choices}: `,
        )
      )
        .trim()
        .toLowerCase();
      if (answer === "s" || answer === "sign in" || answer === "sign-in") {
        const authorized = await authorizeOnce(context);
        if (!authorized.ok) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `GITHUB SIGN-IN STOPPED\n\n${authorized.message}\n`,
          };
        }
        invocationToken = authorized.token;
        authenticationState = "device";
        invocationAuthenticationState = "device";
        publicSignInJustSucceeded = true;
        context.writeOutput?.(
          "Signed in for public API capacity. Private repositories are still excluded.\n",
        );
        planned = await makePlan();
        if (!planned.ok) {
          return budgetFailure(
            planned.plan,
            context.invokedAs,
            false,
            "github_preflight_failed",
            "Git Mog could not verify the signed-in request allowance. No collection began.",
            context.timeZone,
          );
        }
        requestPlan = planned.plan;
      } else if ((answer === "l" || answer === "limited") && requestPlan.limitedRunPossible) {
        // The user explicitly accepted the cache-aware limited request cap.
      } else {
        return budgetFailure(
          requestPlan,
          context.invokedAs,
          false,
          requestPlan.disposition === "blocked" ? "github_limit_reached" : "github_budget_limited",
          "No GitHub profile requests were made.",
          context.timeZone,
        );
      }
    }

    const limitedApproved = requestPlan.disposition === "limited" && values.anonymous === true;
    const interactiveLimitedApproved =
      requestPlan.disposition === "limited" &&
      values.json !== true &&
      context.isTty === true &&
      context.prompt !== undefined &&
      values["no-prompt"] !== true &&
      invocationToken === undefined;
    if (requestPlan.disposition !== "complete" && !limitedApproved && !interactiveLimitedApproved) {
      return budgetFailure(
        requestPlan,
        context.invokedAs,
        values.json === true,
        requestPlan.disposition === "blocked"
          ? "github_limit_reached"
          : requestPlan.disposition === "limited"
            ? "github_budget_limited"
            : "github_preflight_failed",
        requestPlan.disposition === "limited"
          ? "GitHub's current allowance supports only a limited result. No collection began."
          : "GitHub's current allowance cannot support an honest result. No collection began.",
        context.timeZone,
      );
    }
    if (
      qualityEnabledForRun &&
      requestPlan.quality.disposition !== "complete" &&
      requestPlan.quality.signInMayImprove &&
      invocationToken === undefined &&
      values.anonymous !== true &&
      values["no-prompt"] !== true &&
      values.json !== true &&
      context.isTty === true &&
      context.prompt !== undefined
    ) {
      const limited = requestPlan.quality.disposition === "limited";
      const qualityRequired = values.quality === true;
      const choices = qualityRequired
        ? "[s] sign in once, [c] cancel"
        : limited
          ? "[s] sign in once, [l] run the bounded preview, [w] continue without quality"
          : "[s] sign in once, [w] continue without quality";
      const answer = (
        await context.prompt(`${qualityPreflightMessage(requestPlan.quality)}\n${choices}: `)
      )
        .trim()
        .toLowerCase();
      if (answer === "s" || answer === "sign in" || answer === "sign-in") {
        const authorized = await authorizeOnce(context);
        if (authorized.ok) {
          invocationToken = authorized.token;
          authenticationState = "device";
          invocationAuthenticationState = "device";
          publicSignInJustSucceeded = true;
          context.writeOutput?.(
            "Signed in for public API capacity. Private repositories are still excluded.\n",
          );
          const qualityPlanned = await makePlan();
          if (qualityPlanned.ok) requestPlan = qualityPlanned.plan;
          else qualityEnabledForRun = false;
        } else {
          qualityEnabledForRun = false;
        }
      } else if (!qualityRequired && (answer === "l" || answer === "limited") && limited) {
        // The bounded preview remains enabled with explicit coverage limits.
      } else {
        qualityEnabledForRun = false;
      }
    }
    if (
      values.quality === true &&
      (!qualityEnabledForRun || requestPlan.quality.disposition !== "complete")
    ) {
      return budgetFailure(
        requestPlan,
        context.invokedAs,
        values.json === true,
        requestPlan.quality.disposition === "blocked"
          ? "github_limit_reached"
          : "github_budget_limited",
        `${qualityPreflightMessage(requestPlan.quality)} No collection began.`,
        context.timeZone,
      );
    }
  }
  if (
    publicSignInJustSucceeded &&
    invocationToken !== undefined &&
    !publicOnly &&
    !privateContextRequested &&
    values["no-prompt"] !== true &&
    values.json !== true &&
    context.prompt !== undefined &&
    context.stdinIsTty !== false
  ) {
    const login = await authenticatedPublicLogin(invocationToken, context);
    const matches =
      login === null
        ? []
        : positionals.filter((handle) => handle.toLowerCase() === login.toLowerCase());
    if (login !== null && matches.length === 1) {
      const answer = (
        await context.prompt(
          `Private repos are excluded by default.\nAdd selected private repos for @${login}?\n\n[n] public only  [p] private context: `,
        )
      )
        .trim()
        .toLowerCase();
      privateContextRequested =
        answer === "p" || answer === "private" || answer === "private context";
    }
  }
  if (privateContextRequested) {
    cachePolicy = { ...cachePolicy, write: false };
  } else if (deferNewCacheRoot) {
    initializePersistentCache();
  }
  const fetchOptions = {
    ...(invocationToken === undefined ? {} : { token: invocationToken }),
    ...(context.fetchImpl === undefined ? {} : { fetchImpl: context.fetchImpl }),
    ...(context.now === undefined ? {} : { now: context.now }),
    cache: snapshotCache,
    cachePolicy,
  };
  const palette = createPalette(
    shouldUseColor({ mode: color, env: context.env, isTty: context.isTty }),
  );
  const progress = createTerminalProgress({
    mode: positionals.length === 1 ? "profile" : "battle",
    handles: positionals,
    env: values["no-motion"] === true ? { ...context.env, GITMOG_NO_MOTION: "1" } : context.env,
    isTty:
      context.writeProgress !== undefined &&
      shouldRenderProgress({
        stderrIsTty: context.stderrIsTty ?? context.isTty === true,
        env: context.env,
        normalHumanOutput: outputModeCount === 0 && context.isTty === true,
      }),
    columns: context.terminalColumns ?? 80,
    palette,
    cacheMode: noCache ? "no-cache" : values.refresh === true ? "refresh" : "normal",
    write: context.writeProgress ?? (() => undefined),
    ...(context.progressClock === undefined ? {} : { clock: context.progressClock }),
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  });
  progress.update({ type: "command-start" });

  try {
    if (positionals.length === 1) {
      const result = await runProfile({
        handle: positionals[0] as string,
        ...fetchOptions,
        ...(requestPlan === null ? {} : { maxRequests: requestPlan.perProfileRequestCaps[0] }),
        sourceAnalysis: { cache: sourceCache, derivedCache, cachePolicy },
        quality: {
          enabled: qualityEnabledForRun,
          cache: qualityCache,
          cachePolicy,
          sourceRequestCap:
            requestPlan?.quality.perProfileSourceRequestCaps[0] ?? (qualityEnabledForRun ? 21 : 0),
          attributionRequestCap:
            requestPlan?.quality.perProfileAttributionRequestCaps[0] ??
            (qualityEnabledForRun ? 12 : 0),
        },
        onProgress: progress.update,
      });
      if (!result.ok) {
        progress.update({ type: "command-failed", error: result.error });
        return serviceFailure(
          result.error,
          values.json === true,
          positionals,
          context,
          invocationAuthenticationState,
        );
      }
      const privateOutcome = privateContextRequested
        ? await collectPrivateContext(positionals as [string], invocationToken, context)
        : {};
      const privateContext = privateOutcome.result;
      const stdout =
        values.json === true
          ? mixedJson(
              {
                evidenceMode:
                  privateContext === undefined ? "public-only" : "public-with-private-context",
                profile: withoutScanType(result.profile),
                sourceAnalysis: result.sourceAnalysis,
                ...(qualityEnabledForRun ? { qualityPreview: result.qualityPreview } : {}),
                requestBudget: result.requestBudget,
                ...(privateContext === undefined ? {} : { privateContext }),
                ...(privateOutcome.error === undefined
                  ? {}
                  : { privateContextError: privateOutcome.error }),
              },
              privateContext,
            )
          : renderProfile(result.profile, result.sourceAnalysis, {
              palette,
              columns: context.terminalColumns,
              details: values.details === true || values.receipts === true,
              receipts: values.receipts === true,
              ...(qualityEnabledForRun ? { qualityPreview: result.qualityPreview } : {}),
              ...(privateContext === undefined ? {} : { privateContext }),
            });
      progress.update({ type: "command-complete" });
      return privateOutcome.error === undefined
        ? { exitCode: 0, stdout, stderr: "" }
        : values.json === true
          ? { exitCode: 1, stdout, stderr: "" }
          : privateContextFailure(privateOutcome.error, false, stdout);
    }

    const result = await runBattle({
      left: positionals[0] as string,
      right: positionals[1] as string,
      ...(roast === null ? {} : { roast }),
      ...fetchOptions,
      ...(requestPlan === null
        ? {}
        : {
            requestCaps: {
              left: requestPlan.perProfileRequestCaps[0],
              right: requestPlan.perProfileRequestCaps[1] ?? 0,
            },
          }),
      sourceAnalysis: { cache: sourceCache, derivedCache, cachePolicy },
      quality: {
        enabled: qualityEnabledForRun,
        cache: qualityCache,
        cachePolicy,
        sourceRequestCaps: {
          left:
            requestPlan?.quality.perProfileSourceRequestCaps[0] ?? (qualityEnabledForRun ? 21 : 0),
          right:
            requestPlan?.quality.perProfileSourceRequestCaps[1] ?? (qualityEnabledForRun ? 21 : 0),
        },
        attributionRequestCaps: {
          left:
            requestPlan?.quality.perProfileAttributionRequestCaps[0] ??
            (qualityEnabledForRun ? 12 : 0),
          right:
            requestPlan?.quality.perProfileAttributionRequestCaps[1] ??
            (qualityEnabledForRun ? 12 : 0),
        },
      },
      onProgress: progress.update,
    });
    if (!result.ok) {
      progress.update({ type: "command-failed", error: result.error });
      return serviceFailure(
        result.error,
        values.json === true,
        positionals,
        context,
        invocationAuthenticationState,
      );
    }
    const privateOutcome = privateContextRequested
      ? await collectPrivateContext(positionals as [string, string], invocationToken, context)
      : {};
    const privateContext = privateOutcome.result;
    if (privateOutcome.error !== undefined && exportDestination !== null) {
      progress.update({ type: "command-complete" });
      return privateContextFailure(privateOutcome.error, values.json === true);
    }
    if (exportDestination !== null) {
      const exported = writeBattleExport({
        battle: result.battle,
        source: result.sourceAnalysis,
        story: result.story,
        ...(qualityEnabledForRun ? { qualityPreview: result.qualityPreview } : {}),
        ...(privateContext === undefined ? {} : { privateContext }),
        version: context.version,
        format: exportDestination.format,
        destination: exportDestination.path,
        cwd: context.cwd,
      });
      if (!exported.ok) {
        progress.update({
          type: "command-failed",
          error: { code: "internal_error", message: exported.error },
        });
        return values.json === true
          ? jsonFailure("export_failed", exported.error, false, 1)
          : { exitCode: 1, stdout: "", stderr: `EXPORT FAILED\n\n${exported.error}\n` };
      }
      progress.update({ type: "command-complete" });
      return values.json === true
        ? {
            exitCode: 0,
            stdout: mixedJson(
              {
                evidenceMode:
                  privateContext === undefined ? "public-only" : "public-with-private-context",
                export: exported.value,
                ...(privateContext === undefined ? {} : { privateContext }),
              },
              privateContext,
            ),
            stderr: "",
          }
        : {
            exitCode: 0,
            stdout: `Exported ${exported.value.format.toUpperCase()}: ${exported.value.path}\n`,
            stderr: "",
          };
    }
    if (values.json === true) {
      progress.update({ type: "command-complete" });
      return {
        exitCode: privateOutcome.error === undefined ? 0 : 1,
        stdout: mixedJson(
          {
            evidenceMode:
              privateContext === undefined ? "public-only" : "public-with-private-context",
            battle: battleJson(result),
            presentationVerdict: derivePresentationVerdict(result.battle, result.sourceAnalysis),
            sourceAnalysis: result.sourceAnalysis,
            story: result.story,
            ...(qualityEnabledForRun ? { qualityPreview: result.qualityPreview } : {}),
            ...(privateContext === undefined ? {} : { privateContext }),
            ...(privateOutcome.error === undefined
              ? {}
              : { privateContextError: privateOutcome.error }),
          },
          privateContext,
        ),
        stderr: "",
      };
    }
    if (share !== null) {
      progress.update({ type: "command-complete" });
      const shareStdout = `${renderShare(result.battle, share, result.sourceAnalysis, result.story, privateContext)}\n`;
      return privateOutcome.error === undefined
        ? { exitCode: 0, stdout: shareStdout, stderr: "" }
        : privateContextFailure(privateOutcome.error, false, shareStdout);
    }
    const stdout =
      values.card === true
        ? renderCard(result.battle, result.sourceAnalysis, result.story, {
            palette: PLAIN_PALETTE,
            columns: context.terminalColumns,
            ...(qualityEnabledForRun ? { qualityPreview: result.qualityPreview } : {}),
            ...(privateContext === undefined ? {} : { privateContext }),
          })
        : renderBattle(result.battle, result.sourceAnalysis, result.story, {
            palette,
            columns: context.terminalColumns,
            details: values.details === true || values.receipts === true,
            receipts: values.receipts === true,
            ...(qualityEnabledForRun ? { qualityPreview: result.qualityPreview } : {}),
            ...(privateContext === undefined ? {} : { privateContext }),
          });
    progress.update({ type: "command-complete" });
    return privateOutcome.error === undefined
      ? { exitCode: 0, stdout, stderr: "" }
      : privateContextFailure(privateOutcome.error, false, stdout);
  } catch {
    const error: BattleError = {
      code: "internal_error",
      message: "Git Mog could not complete this analysis.",
    };
    progress.update({ type: "command-failed", error });
    return serviceFailure(
      error,
      values.json === true,
      positionals,
      context,
      invocationAuthenticationState,
    );
  } finally {
    progress.dispose();
  }
}
