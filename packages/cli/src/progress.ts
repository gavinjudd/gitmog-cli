import type { AnalysisProgressEvent, BattleError } from "@gitmog/battle";

import type { Palette } from "./color.js";
import { terminalSafe } from "./terminal-safe.js";

export const PROGRESS_REVEAL_MS = 120;
export const PROGRESS_FRAME_MS = 80;
export const PROGRESS_FRAMES = Object.freeze(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]);

export const PROGRESS_STAGE_LABELS = Object.freeze({
  profiles: "Fetching profiles",
  repositories: "Ranking repositories",
  source: "Reading code samples",
  scoring: "Scoring matchup",
  story: "Building verdict",
  quality: "Reviewing code quality",
});

type ProgressStage = keyof typeof PROGRESS_STAGE_LABELS;
type TimerHandle = ReturnType<typeof setTimeout>;

export interface ProgressClock {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  readonly clearTimeout: (handle: TimerHandle) => void;
}

export interface TerminalProgressOptions {
  readonly mode: "profile" | "battle";
  readonly handles: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly isTty: boolean;
  readonly columns: number;
  readonly palette: Palette;
  readonly cacheMode: "normal" | "refresh" | "no-cache";
  readonly write: (value: string) => void;
  readonly clock?: ProgressClock | undefined;
  readonly signal?: AbortSignal | undefined;
}

export type TerminalProgressEvent =
  | { readonly type: "command-start" }
  | AnalysisProgressEvent
  | { readonly type: "command-complete" }
  | { readonly type: "command-failed"; readonly error: BattleError };

export interface TerminalProgress {
  readonly enabled: boolean;
  readonly update: (event: TerminalProgressEvent) => void;
  /** Ends and clears the transient renderer before any persistent output boundary. */
  readonly settle: () => void;
  readonly dispose: () => void;
}

const defaultClock: ProgressClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

export function shouldRenderProgress(input: {
  readonly stderrIsTty: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly normalHumanOutput: boolean;
}): boolean {
  return (
    input.stderrIsTty &&
    input.normalHumanOutput &&
    (input.env.CI === undefined || input.env.CI === "") &&
    input.env.TERM !== "dumb"
  );
}

const fitPlain = (value: string, width: number): string => {
  const characters = Array.from(terminalSafe(value));
  if (characters.length <= width) return characters.join("");
  if (width <= 1) return "…".slice(0, Math.max(0, width));
  return `${characters.slice(0, width - 1).join("")}…`;
};

/** Kept public for terminal-safety tests; progress itself renders only this one line. */
export function renderProgressHeader(input: {
  readonly mode: "profile" | "battle";
  readonly handles: readonly string[];
  readonly columns: number;
  readonly palette: Palette;
}): string {
  const handles = input.handles.map((handle) => `@${terminalSafe(handle)}`).join(" vs ");
  const value = `${PROGRESS_STAGE_LABELS.profiles} · ${handles}`;
  const width = Math.max(20, input.columns);
  const fitted = fitPlain(value, width);
  return `${fitted}${" ".repeat(Math.max(0, width - Array.from(fitted).length))}`;
}

const noopProgress: TerminalProgress = Object.freeze({
  enabled: false,
  update: () => undefined,
  settle: () => undefined,
  dispose: () => undefined,
});

export function createTerminalProgress(options: TerminalProgressOptions): TerminalProgress {
  if (!options.isTty) return noopProgress;
  const clock = options.clock ?? defaultClock;
  const motion = options.env.GITMOG_NO_MOTION !== "1";
  let current: ProgressStage = "profiles";
  let revealTimer: TimerHandle | null = null;
  let frameTimer: TimerHandle | null = null;
  let frameIndex = 0;
  let revealed = false;
  let cursorHidden = false;
  let finished = false;

  const safeWrite = (value: string): void => {
    try {
      options.write(value);
    } catch {
      // A closed stderr must not alter analysis or canonical stdout.
    }
  };
  const clearTimer = (handle: TimerHandle | null): void => {
    if (handle !== null) clock.clearTimeout(handle);
  };
  const clearLine = (): void => {
    if (revealed) safeWrite("\r\u001B[2K");
  };
  const restoreCursor = (): void => {
    if (!cursorHidden) return;
    safeWrite("\u001B[?25h");
    cursorHidden = false;
  };
  const stageLabel = (): string =>
    current === "scoring" && options.mode === "profile"
      ? "Scoring profile"
      : PROGRESS_STAGE_LABELS[current];
  const renderActive = (): void => {
    if (!revealed || finished) return;
    clearLine();
    const symbol = motion ? (PROGRESS_FRAMES[frameIndex % PROGRESS_FRAMES.length] ?? "⠋") : "·";
    const fitted = fitPlain(`${symbol} ${stageLabel()}`, Math.max(20, options.columns));
    safeWrite(`${options.palette.wrap("cyan", fitted.slice(0, 1))}${fitted.slice(1)}`);
    if (!motion) return;
    frameIndex += 1;
    clearTimer(frameTimer);
    frameTimer = clock.setTimeout(renderActive, PROGRESS_FRAME_MS);
  };
  const reveal = (): void => {
    if (revealed || finished) return;
    revealed = true;
    if (motion) {
      safeWrite("\u001B[?25l");
      cursorHidden = true;
    }
    renderActive();
  };
  const activate = (stage: ProgressStage): void => {
    if (current === stage) return;
    clearTimer(frameTimer);
    current = stage;
    renderActive();
  };
  const finish = (failureText?: string): void => {
    if (finished) return;
    finished = true;
    clearTimer(revealTimer);
    clearTimer(frameTimer);
    if (revealed) clearLine();
    restoreCursor();
    if (revealed && failureText !== undefined) {
      safeWrite(`${options.palette.wrap("yellow", "!")} ${terminalSafe(failureText)}\n`);
    }
    options.signal?.removeEventListener("abort", interrupt);
  };
  const interrupt = (): void => finish("Interrupted");
  options.signal?.addEventListener("abort", interrupt, { once: true });

  const update = (event: TerminalProgressEvent): void => {
    if (finished) return;
    switch (event.type) {
      case "command-start":
        current = "profiles";
        revealTimer = clock.setTimeout(reveal, PROGRESS_REVEAL_MS);
        return;
      case "profile-collection-start":
      case "profile-collection-complete":
      case "repository-ranking-complete":
      case "scoring-complete":
      case "source-analysis-complete":
      case "story-complete":
      case "quality-analysis-complete":
        return;
      case "repository-ranking-start":
        activate("repositories");
        return;
      case "scoring-start":
        activate("scoring");
        return;
      case "source-analysis-start":
        activate("source");
        return;
      case "story-start":
        activate("story");
        return;
      case "quality-analysis-start":
        activate("quality");
        return;
      case "command-complete":
        finish();
        return;
      case "command-failed":
        finish(
          event.error.code === "rate_limited" ? "GitHub rate limit reached" : "Analysis stopped",
        );
    }
  };

  return {
    enabled: true,
    update,
    settle: () => finish(),
    dispose: () => {
      clearTimer(revealTimer);
      clearTimer(frameTimer);
      if (!finished && revealed) clearLine();
      restoreCursor();
      options.signal?.removeEventListener("abort", interrupt);
    },
  };
}
