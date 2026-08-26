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
import type {
  AuthorizationInputController,
  AuthorizationInputSession,
} from "./authorization-input.js";
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
import {
  privateAppInstallationDestination,
  privateAppSettingsDestination,
  validateExternalDestination,
  type OpenExternalResult,
  type ValidatedExternalDestination,
} from "./open-external.js";

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
  readonly openExternal?:
    ((destination: ValidatedExternalDestination) => Promise<OpenExternalResult>) | undefined;
  readonly authorizationInput?: AuthorizationInputController | undefined;
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

export const CLI_INTERACTION_VERSION = "2.0.0-frictionless-github-authorization";
export const CLI_TERMINAL_PRESENTATION_VERSION = "2.0.0-first-screen-editorial";
export const CLI_COPY_CONTRACT_VERSION = "1.0.0-surface-aware-copy-gate";

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
    "",
    "Battle two GitHub profiles:",
    "  npx -y gitmog <left> <right>",
    "",
    "Check one profile:",
    "  npx -y gitmog <username>",
    "",
    "Paste a username, @handle, or GitHub profile link.",
    "",
    "TRY IT",
    "  npx -y gitmog torvalds gvanrossum",
    "  npx -y gitmog karpathy geohot",
    "",
    "USEFUL",
    "  --card       Screenshot-ready result",
    "  --details    Full score breakdown",
    "  --receipts   Every supporting receipt",
    "  --share x    X-ready result",
    "",
    "PRIVATE REPOS",
    "  Add --private-context. They never change the public winner.",
    "",
    `More options: ${command} --help-all`,
    "",
    "Entertainment based on GitHub evidence—not a hiring score.",
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
    "  --no-open                    Do not open a browser automatically",
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
  "no-open": { type: "boolean" },
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

const publicPrivateContextError = (error: PrivateContextError): PrivateContextError => ({
  code: error.code,
  message: error.message,
  ...(error.signedInAs === undefined ? {} : { signedInAs: error.signedInAs }),
  ...(error.installationUrl === undefined ? {} : { installationUrl: error.installationUrl }),
});

const privateContextFailure = (
  error: PrivateContextError,
  jsonRequested: boolean,
  publicStdout = "",
): CliResult =>
  jsonRequested
    ? {
        exitCode: 1,
        stdout: `${JSON.stringify(
          { error: { ...publicPrivateContextError(error), retryable: false } },
          null,
          2,
        )}\n`,
        stderr: "",
      }
    : {
        exitCode: 1,
        stdout: publicStdout,
        stderr: `${
          error.code === "private_context_identity_mismatch"
            ? "IDENTITY MISMATCH"
            : error.code === "private_context_auth_denied"
              ? "AUTH DENIED"
              : error.code === "private_context_auth_expired"
                ? "AUTH EXPIRED"
                : error.code === "private_context_installation_required"
                  ? "INSTALLATION MISSING"
                  : error.code === "private_context_selected_repositories_required"
                    ? "PRIVATE REPOS SETUP"
                    : "PRIVATE REPOS NOT AVAILABLE"
        }\n\n${
          error.signedInAs === undefined
            ? ""
            : `Signed in as @${error.signedInAs}.\nPrivate repos can only be added to the matching person in this battle.\n`
        }${error.signedInAs === undefined ? error.message : ""}${
          error.installationUrl === undefined
            ? ""
            : `\n\nOpen GitHub, choose the private repos, then press Enter here.\nOpen this link: ${error.installationUrl}`
        }\n`,
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
      return "More GitHub lookups may improve the code-quality sample.\nSupported TypeScript/JavaScript source can still limit it.";
    case "mixed":
      return "More GitHub lookups may help, but the available code sample is still limited.";
    case "supported-language-limited":
    case "eligible-source-limited":
      return "Code quality is limited by the available TypeScript/JavaScript sample.\nSigning in would not change that.";
    case "attribution-limited":
      return "The code sample does not establish enough authorship for a complete read.";
    default:
      return "The available code sample is limited. Signing in may not change it.";
  }
};

const truthy = (value: string | undefined): boolean =>
  value !== undefined && /^(?:1|true|yes|on)$/iu.test(value.trim());

const browserOpeningAllowed = (
  context: CliContext,
  input: {
    readonly explicitAuthorization: boolean;
    readonly noOpen: boolean;
    readonly json: boolean;
    readonly anonymous: boolean;
    readonly promptingAllowed: boolean;
  },
): boolean =>
  input.explicitAuthorization &&
  !input.noOpen &&
  !input.json &&
  !input.anonymous &&
  input.promptingAllowed &&
  context.stdinIsTty === true &&
  context.stderrIsTty === true &&
  context.isTty === true &&
  context.openExternal !== undefined &&
  context.authorizationInput !== undefined &&
  !truthy(context.env.GITMOG_NO_BROWSER) &&
  !truthy(context.env.CI);

interface DevicePromptShape {
  readonly userCode: string;
  readonly verificationUri: string;
}

interface DeviceInteraction {
  readonly signal: AbortSignal;
  readonly onPrompt: (prompt: DevicePromptShape) => Promise<void>;
  readonly close: () => void;
}

const createDeviceInteraction = (
  context: CliContext,
  input: {
    readonly title: string;
    readonly reason: readonly string[];
    readonly allowBrowser: boolean;
    readonly palette: ReturnType<typeof createPalette>;
  },
): DeviceInteraction => {
  const cancellation = new AbortController();
  const signal =
    context.signal === undefined
      ? cancellation.signal
      : AbortSignal.any([context.signal, cancellation.signal]);
  const now = context.now ?? Date.now;
  const write = context.writeOutput ?? (() => undefined);
  let session: AuthorizationInputSession | null = null;
  let destination: ValidatedExternalDestination | null = null;
  let openedAt = Number.NEGATIVE_INFINITY;
  let manualAttempts = 0;
  let opening = false;
  let closed = false;
  let fallbackShown = false;

  const showFallback = (): void => {
    if (fallbackShown || destination === null || closed) return;
    fallbackShown = true;
    write(`\nThe browser did not open.\nOpen this link: ${destination.url}\n`);
  };
  const manualOpen = async (): Promise<void> => {
    if (
      closed ||
      destination === null ||
      !input.allowBrowser ||
      context.openExternal === undefined ||
      opening
    ) {
      return;
    }
    if (manualAttempts >= 5) {
      showFallback();
      return;
    }
    const current = now();
    if (current - openedAt < 1_000) return;
    manualAttempts += 1;
    openedAt = current;
    opening = true;
    const result = await context
      .openExternal(destination)
      .catch((): OpenExternalResult => ({ status: "failed" }));
    opening = false;
    if (result.status !== "opened") showFallback();
    if (manualAttempts >= 5) showFallback();
  };

  return {
    signal,
    onPrompt: async (prompt) => {
      destination = validateExternalDestination({
        kind: "github-device",
        url: prompt.verificationUri,
      });
      if (destination === null) throw new Error("GitHub device destination was refused.");
      let result: OpenExternalResult = { status: "unsupported" };
      if (input.allowBrowser && context.openExternal !== undefined) {
        openedAt = now();
        opening = true;
        result = await context
          .openExternal(destination)
          .catch((): OpenExternalResult => ({ status: "failed" }));
        opening = false;
      }
      const opened = result.status === "opened";
      const controls =
        input.allowBrowser && context.authorizationInput !== undefined
          ? `${input.palette.wrap("cyan", `[Enter] ${opened ? "open again" : "try again"}`)} ${input.palette.wrap("dim", "· [q] cancel")}`
          : input.palette.wrap("dim", "[q] cancel");
      write(
        [
          input.title,
          "",
          ...input.reason,
          "",
          opened ? "Browser opened." : "The browser did not open.",
          ...(opened ? [] : [`Open this link: ${destination.url}`]),
          `Enter this code: ${input.palette.wrap("bold", prompt.userCode)}`,
          "",
          controls,
          "",
        ].join("\n"),
      );
      fallbackShown = !opened;
      if (context.authorizationInput !== undefined) {
        session = context.authorizationInput.start({
          onEnter: manualOpen,
          onCancel: () => cancellation.abort(),
        });
      }
    },
    close: () => {
      closed = true;
      session?.close();
      session = null;
    },
  };
};

const authorizeOnce = async (
  context: CliContext,
  options: {
    readonly privateContextFollows: boolean;
    readonly allowBrowser: boolean;
    readonly palette: ReturnType<typeof createPalette>;
  },
): Promise<
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly title: string; readonly message: string }
> => {
  const authorize = context.authorizeDevice ?? authorizeGithubDevice;
  const interaction = createDeviceInteraction(context, {
    title: options.privateContextFollows ? "GITHUB SIGN-IN · 1 OF 2" : "GITHUB SIGN-IN",
    reason: [
      "GitHub is almost out of anonymous lookups for this hour.",
      "Sign in once so Git Mog can finish the full public read.",
      "",
      options.privateContextFollows
        ? "Private repos are not included in this step."
        : "Private repos are not included.",
    ],
    allowBrowser: options.allowBrowser,
    palette: options.palette,
  });
  let result: Awaited<ReturnType<typeof authorizeGithubDevice>>;
  try {
    result = await authorize({
      ...(context.fetchImpl === undefined ? {} : { fetchImpl: context.fetchImpl }),
      signal: interaction.signal,
      onPrompt: interaction.onPrompt,
    });
  } finally {
    interaction.close();
  }
  if (!result.ok) {
    const messages = {
      access_denied: "GitHub sign-in was cancelled.\nRun the command again when you’re ready.",
      expired: "That code expired.\nRun the command again for a new one.",
      cancelled: "GitHub sign-in was cancelled.",
      network: "GitHub sign-in could not reach GitHub.",
      timeout: "GitHub sign-in timed out.",
      malformed: "GitHub returned an unreadable sign-in response.",
      configuration: "GitHub sign-in is not configured for this build.",
    } as const;
    return {
      ok: false,
      title:
        result.error === "access_denied" || result.error === "cancelled"
          ? "AUTH DENIED"
          : result.error === "expired"
            ? "AUTH EXPIRED"
            : "GITHUB SIGN-IN FAILED",
      message: messages[result.error],
    };
  }
  if (result.scopes.length !== 0) {
    return {
      ok: false,
      title: "GITHUB SIGN-IN FAILED",
      message: "GitHub returned permissions Git Mog did not request.",
    };
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
  followsPublicAuthorization: boolean,
  interactionOptions: {
    readonly allowBrowser: boolean;
    readonly palette: ReturnType<typeof createPalette>;
  },
): Promise<{
  readonly result?: PrivateContextResult;
  readonly error?: PrivateContextError;
  readonly continuedPublicOnly?: true;
}> => {
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
  const interaction = createDeviceInteraction(context, {
    title: followsPublicAuthorization ? "PRIVATE REPOS · 2 OF 2" : "PRIVATE REPOS",
    reason: [
      "Git Mog can read only the private repos you selected on GitHub.",
      "",
      "No write access.",
      "No GitHub Secrets access.",
      "No code execution.",
      "Access ends when this run ends.",
    ],
    allowBrowser: interactionOptions.allowBrowser,
    palette: interactionOptions.palette,
  });
  let authorized: Awaited<ReturnType<typeof authorizePrivateGithubDevice>>;
  try {
    authorized = await authorize({
      config: validated.config,
      ...(publicToken === undefined ? {} : { forbiddenTokens: [publicToken] }),
      ...(context.fetchImpl === undefined ? {} : { fetchImpl: context.fetchImpl }),
      signal: interaction.signal,
      onPrompt: interaction.onPrompt,
    });
  } finally {
    interaction.close();
  }
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
        message:
          authorized.error === "access_denied" || authorized.error === "cancelled"
            ? "GitHub sign-in was cancelled.\nRun the command again when you’re ready."
            : authorized.error === "expired"
              ? "That code expired.\nRun the command again for a new one."
              : "Private repo sign-in did not complete. The public result is still available.",
      },
    };
  }
  const privateRunner = context.runPrivateContext ?? runPrivateContext;
  const runWithToken = (token: string) =>
    privateRunner({
      handles,
      token,
      config: validated.config,
      ...(context.fetchImpl === undefined ? {} : { fetchImpl: context.fetchImpl }),
      ...(context.signal === undefined ? {} : { signal: context.signal }),
      ...(context.now === undefined ? {} : { now: context.now }),
    });
  const outcome = await authorized.lease.use(async (token) => {
    let current = await runWithToken(token);
    for (let rechecks = 0; !current.ok && rechecks < 3; rechecks += 1) {
      const setupKind =
        current.error.code === "private_context_installation_required"
          ? "install"
          : current.error.code === "private_context_selected_repositories_required"
            ? "settings"
            : null;
      if (setupKind === null || context.prompt === undefined) return current;
      const destination =
        setupKind === "install"
          ? privateAppInstallationDestination()
          : current.error.settingsUrl === undefined
            ? null
            : privateAppSettingsDestination(current.error.settingsUrl);
      const openResult =
        interactionOptions.allowBrowser &&
        context.openExternal !== undefined &&
        destination !== null
          ? await context
              .openExternal(destination)
              .catch((): OpenExternalResult => ({ status: "failed" }))
          : ({ status: "unsupported" } as const);
      const browserLine =
        openResult.status === "opened" ? "Browser opened." : "The browser did not open.";
      const instructions =
        setupKind === "install"
          ? [
              "Choose “Only select repositories” on GitHub, then pick the private repos you",
              "want Git Mog to read.",
            ]
          : [
              "Git Mog requires “Only select repositories.”",
              "",
              "Switch the installation from “All repositories” to the private repos you want",
              "included.",
            ];
      const fallback =
        openResult.status === "opened"
          ? []
          : setupKind === "install"
            ? [`Open this link: ${privateAppInstallationDestination().url}`]
            : ["Open GitHub’s Installed GitHub Apps settings."];
      const answer = (
        await context.prompt(
          [
            "PRIVATE REPOS SETUP",
            "",
            ...instructions,
            "",
            browserLine,
            ...fallback,
            "",
            setupKind === "install"
              ? "[Enter] I’m finished · [p] continue public-only · [q] cancel"
              : "[Enter] I’ve changed it · [p] continue public-only · [q] cancel",
            "",
          ].join("\n"),
        )
      )
        .trim()
        .toLowerCase();
      if (answer === "p" || answer === "public" || answer === "public-only") {
        return { continuedPublicOnly: true } as const;
      }
      if (answer === "q" || answer === "quit" || answer === "cancel") {
        return { cancelled: true } as const;
      }
      current = await runWithToken(token);
    }
    return current;
  });
  authorized.lease.dispose();
  if ("continuedPublicOnly" in outcome) return { continuedPublicOnly: true };
  if ("cancelled" in outcome)
    return {
      error: {
        code: "private_context_auth_denied",
        message: "Private repos were cancelled.",
      },
    };
  if (outcome.ok) {
    context.writeOutput?.(`Private repos connected for @${outcome.result.subject}.\n`);
    return { result: outcome.result };
  }
  return { error: outcome.error };
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
  const authorizationPalette = createPalette(
    shouldUseColor({
      mode: color,
      env: context.env,
      isTty: context.stderrIsTty === true,
    }),
  );
  const allowBrowserForAuthorization = (): boolean =>
    browserOpeningAllowed(context, {
      explicitAuthorization: true,
      noOpen: values["no-open"] === true,
      json: values.json === true,
      anonymous: values.anonymous === true,
      promptingAllowed: values["no-prompt"] !== true,
    });
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
  const explicitPrivateContextRequested = privateContextRequested;
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
      const authorized = await authorizeOnce(context, {
        privateContextFollows: explicitPrivateContextRequested,
        allowBrowser: allowBrowserForAuthorization(),
        palette: authorizationPalette,
      });
      if (!authorized.ok) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `${authorized.title}\n\n${authorized.message}\n`,
        };
      }
      invocationToken = authorized.token;
      authenticationState = "device";
      invocationAuthenticationState = "device";
      publicSignInJustSucceeded = true;
      context.writeOutput?.(
        "Connected for public GitHub data.\nPrivate repos are still excluded.\n",
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
        ? "[Enter] sign in once · [l] smaller read · [q] cancel"
        : "[Enter] sign in once · [q] cancel";
      const answer = (
        await context.prompt(
          `GITHUB LIMIT\n\nGitHub is almost out of anonymous lookups for this hour.\n${remaining} left · the full read may need ${String(need)}\n\n${choices}\n`,
        )
      )
        .trim()
        .toLowerCase();
      if (answer === "" || answer === "s" || answer === "sign in" || answer === "sign-in") {
        const authorized = await authorizeOnce(context, {
          privateContextFollows: explicitPrivateContextRequested,
          allowBrowser: allowBrowserForAuthorization(),
          palette: authorizationPalette,
        });
        if (!authorized.ok) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `${authorized.title}\n\n${authorized.message}\n`,
          };
        }
        invocationToken = authorized.token;
        authenticationState = "device";
        invocationAuthenticationState = "device";
        publicSignInJustSucceeded = true;
        context.writeOutput?.(
          "Connected for public GitHub data.\nPrivate repos are still excluded.\n",
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
        ? "[Enter] sign in once · [q] cancel"
        : limited
          ? "[Enter] use this sample · [s] sign in once · [w] skip code quality"
          : "[Enter] sign in once · [w] skip code quality";
      const answer = (
        await context.prompt(
          `CODE QUALITY\n\n${qualityPreflightMessage(requestPlan.quality)}\n\n${choices}\n`,
        )
      )
        .trim()
        .toLowerCase();
      if (
        answer === "s" ||
        answer === "sign in" ||
        answer === "sign-in" ||
        (answer === "" && (qualityRequired || !limited))
      ) {
        const authorized = await authorizeOnce(context, {
          privateContextFollows: explicitPrivateContextRequested,
          allowBrowser: allowBrowserForAuthorization(),
          palette: authorizationPalette,
        });
        if (authorized.ok) {
          invocationToken = authorized.token;
          authenticationState = "device";
          invocationAuthenticationState = "device";
          publicSignInJustSucceeded = true;
          context.writeOutput?.(
            "Connected for public GitHub data.\nPrivate repos are still excluded.\n",
          );
          const qualityPlanned = await makePlan();
          if (qualityPlanned.ok) requestPlan = qualityPlanned.plan;
          else qualityEnabledForRun = false;
        } else {
          qualityEnabledForRun = false;
        }
      } else if (
        !qualityRequired &&
        (answer === "" || answer === "l" || answer === "limited") &&
        limited
      ) {
        // The smaller preview remains enabled with explicit coverage limits.
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
          `PRIVATE REPOS · OPTIONAL\n\nPrivate repos are excluded.\nAdd selected private repos for @${login}?\n\n[Enter] public only · [p] add private repos · [q] cancel\n`,
        )
      )
        .trim()
        .toLowerCase();
      if (answer === "q" || answer === "quit" || answer === "cancel") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "CANCELLED\n\nNo GitHub profile read began.\n",
        };
      }
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
      if (privateContextRequested) progress.settle();
      const privateOutcome = privateContextRequested
        ? await collectPrivateContext(
            positionals as [string],
            invocationToken,
            context,
            explicitPrivateContextRequested && publicSignInJustSucceeded,
            {
              allowBrowser: allowBrowserForAuthorization(),
              palette: authorizationPalette,
            },
          )
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
                  : { privateContextError: publicPrivateContextError(privateOutcome.error) }),
              },
              privateContext,
            )
          : renderProfile(result.profile, result.sourceAnalysis, {
              palette,
              columns: context.terminalColumns,
              details: values.details === true,
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
    if (privateContextRequested) progress.settle();
    const privateOutcome = privateContextRequested
      ? await collectPrivateContext(
          positionals as [string, string],
          invocationToken,
          context,
          explicitPrivateContextRequested && publicSignInJustSucceeded,
          {
            allowBrowser: allowBrowserForAuthorization(),
            palette: authorizationPalette,
          },
        )
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
              : { privateContextError: publicPrivateContextError(privateOutcome.error) }),
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
            details: values.details === true,
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
