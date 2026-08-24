/**
 * Every count-based metric passes through a saturating curve (PLANNING.md §4.1).
 * Curves are declared as anchor points and interpolated linearly between them: the
 * shape is readable in the source, a reviewer can check an anchor against
 * SCORECARD.md by eye, and there is no hidden exponent to argue about.
 */
export type Anchor = readonly [input: number, output: number];

export function interpolate(value: number, anchors: readonly Anchor[]): number {
  if (anchors.length === 0) return 0;
  const first = anchors[0] as Anchor;
  if (value <= first[0]) return first[1];
  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1] as Anchor;
    const current = anchors[index] as Anchor;
    if (value <= current[0]) {
      const span = current[0] - previous[0];
      if (span <= 0) return current[1];
      const position = (value - previous[0]) / span;
      return previous[1] + position * (current[1] - previous[1]);
    }
  }
  return (anchors[anchors.length - 1] as Anchor)[1];
}

export const clampUnit = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/** Half-up at a fixed precision, stated explicitly so golden files cannot drift with
 * a change of rounding helper. */
export function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.floor(value * factor + 0.5) / factor;
}

/** A penalty that saturates: no signal at all is full marks, `ceiling` or worse is
 * zero, and nothing in between falls off a cliff. */
export const inversePenalty = (rate: number, ceiling: number): number =>
  clampUnit(1 - clampUnit(rate / ceiling));

export const DAY_MS = 86_400_000;

export function daysBetween(fromIso: string | null, toMs: number): number | null {
  if (fromIso === null || fromIso === "") return null;
  const at = Date.parse(fromIso);
  if (Number.isNaN(at)) return null;
  return Math.max(0, (toMs - at) / DAY_MS);
}

/** ISO week key, used to count active weeks without a locale or a timezone. */
export function isoWeekKey(iso: string): string {
  const date = new Date(Date.parse(iso));
  if (Number.isNaN(date.getTime())) return "";
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${String(target.getUTCFullYear())}-W${String(week).padStart(2, "0")}`;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}
