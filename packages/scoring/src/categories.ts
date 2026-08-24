/** Transcribed from the weight table in PLANNING.md §4. */
export const CATEGORY_WEIGHTS = Object.freeze({
  craft: 30,
  activity: 25,
  collaboration: 20,
  projectHealth: 15,
  impact: 10,
});

export type ScoreCategory = keyof typeof CATEGORY_WEIGHTS;

export const SCORE_CATEGORIES = Object.freeze(Object.keys(CATEGORY_WEIGHTS) as ScoreCategory[]);

export const MAXIMUM_SCORE = 100;
