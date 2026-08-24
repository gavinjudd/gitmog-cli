import {
  CATEGORY_WEIGHTS,
  MAXIMUM_SCORE,
  SCORE_CATEGORIES,
  type ScoreCategory,
} from "./categories.js";
import { SCORING_VERSION } from "./version.js";

export type CategorySubscores = Readonly<Record<ScoreCategory, number>>;

export interface FoundationScorecard {
  readonly scoringVersion: string;
  readonly total: number;
  readonly categories: Readonly<Record<ScoreCategory, number>>;
}

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

/** Half-up rounding, stated explicitly so the golden fixture cannot drift with a
 * change of rounding helper. */
const roundHalfUp = (value: number): number => Math.floor(value + 0.5);

/**
 * @internal Foundation Wave 0 package-linkage fixture. Not the scoring contract.
 * Replaced by the Phase 1 scoring specification.
 *
 * Takes explicit per-category subscores in the range 0–1 and applies the declared
 * weights. No I/O, no clock, no randomness, so the output is deterministic for a
 * fixed input and scoring version.
 */
export function foundationScoreFixture(subscores: CategorySubscores): FoundationScorecard {
  const categories = {} as Record<ScoreCategory, number>;
  let total = 0;
  for (const category of SCORE_CATEGORIES) {
    const weighted = roundHalfUp(clampUnit(subscores[category]) * CATEGORY_WEIGHTS[category]);
    categories[category] = weighted;
    total += weighted;
  }
  return {
    scoringVersion: SCORING_VERSION,
    total: Math.min(MAXIMUM_SCORE, total),
    categories,
  };
}
