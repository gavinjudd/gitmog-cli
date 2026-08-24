import type { VerdictClass } from "./types.js";

export interface VerdictDefinition {
  readonly id: VerdictClass;
  readonly label: string;
  readonly minimumMargin: number;
  readonly description: string;
}

/**
 * SCORECARD.md defines no margin classes and no tie rule, so these thresholds come
 * from the Meme MVP brief unchanged. They are presentation only: the winner is always
 * the higher canonical score, and a zero margin is a tie rather than a coin flip.
 */
export const VERDICT_CLASSES: readonly VerdictDefinition[] = Object.freeze([
  {
    id: "nuclear-repo-gap",
    label: "NUCLEAR REPO GAP",
    minimumMargin: 20,
    description: "Twenty points or more between them on the measured basis.",
  },
  {
    id: "extreme-diff",
    label: "EXTREME DIFF",
    minimumMargin: 12,
    description: "Twelve to nineteen points apart.",
  },
  {
    id: "clean-mog",
    label: "CLEAN MOG",
    minimumMargin: 6,
    description: "Six to eleven points apart.",
  },
  {
    id: "aura-edge",
    label: "AURA EDGE",
    minimumMargin: 3,
    description: "Three to five points apart.",
  },
  {
    id: "photo-finish",
    label: "PHOTO FINISH",
    minimumMargin: 1,
    description: "One or two points apart.",
  },
  {
    id: "mutual-aura",
    label: "MUTUAL AURA",
    minimumMargin: 0,
    description: "Identical scores on the measured basis.",
  },
]);

export function classifyVerdict(margin: number): VerdictDefinition {
  const absolute = Math.abs(margin);
  for (const verdict of VERDICT_CLASSES) {
    if (absolute >= verdict.minimumMargin) return verdict;
  }
  return VERDICT_CLASSES[VERDICT_CLASSES.length - 1] as VerdictDefinition;
}
