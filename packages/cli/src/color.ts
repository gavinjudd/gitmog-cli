/**
 * ANSI styling with no dependency.
 *
 * `auto` is the default: colour on an interactive TTY, never when piped, and `NO_COLOR`
 * always wins (ADR 0010 D5). ANSI never reaches `--json`, a share caption, or a fixture,
 * because those paths construct a disabled palette rather than stripping escapes later.
 */

export type ColorMode = "auto" | "always" | "never";

export const COLOR_MODES: readonly ColorMode[] = Object.freeze(["auto", "always", "never"]);

export function parseColorMode(value: string | null | undefined): ColorMode | null {
  const candidate = (value ?? "").trim().toLowerCase();
  return (COLOR_MODES as readonly string[]).includes(candidate) ? (candidate as ColorMode) : null;
}

export interface ColorSupportInput {
  readonly mode: ColorMode;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** `process.stdout.isTTY`. Absent or false means the output is being piped. */
  readonly isTty?: boolean | undefined;
}

/** Pure, so a test can assert every combination without touching a real stream. */
export function shouldUseColor(input: ColorSupportInput): boolean {
  if (input.mode === "never") return false;
  // NO_COLOR is honoured even under --color always: it is the user's global preference,
  // and the informational value of colour never outweighs an explicit opt-out.
  if (input.env["NO_COLOR"] !== undefined) return false;
  if (input.mode === "always") return true;
  if (input.env["TERM"] === "dumb") return false;
  if (input.env["CI"] !== undefined && input.env["CI"] !== "") return false;
  return input.isTty === true;
}

const CODES = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  red: "\u001B[31m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  cyan: "\u001B[36m",
  magenta: "\u001B[35m",
  white: "\u001B[97m",
} as const;

export type PaletteKey = Exclude<keyof typeof CODES, "reset">;

export interface Palette {
  readonly enabled: boolean;
  readonly wrap: (key: PaletteKey, text: string) => string;
}

export function createPalette(enabled: boolean): Palette {
  if (!enabled) {
    return { enabled: false, wrap: (_key, text) => text };
  }
  return {
    enabled: true,
    wrap: (key, text) => `${CODES[key]}${text}${CODES.reset}`,
  };
}

/** The disabled palette, used by every machine-readable surface. */
export const PLAIN_PALETTE: Palette = createPalette(false);

/** Matches every ANSI escape this module can emit. Used by tests, never in a code path. */
// eslint-disable-next-line no-control-regex
export const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

export const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, "");
