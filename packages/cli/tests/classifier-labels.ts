import { CODE_DNA_DEFINITIONS } from "@gitmog/personality";
import { AURA_LEAK_DEFINITIONS, MOGSONA_DEFINITIONS } from "@gitmog/scoring";

export const ACTIVE_HUMAN_CLASSIFIER_LABELS: readonly string[] = Object.freeze(
  [
    ...new Set(
      [...CODE_DNA_DEFINITIONS, ...MOGSONA_DEFINITIONS, ...AURA_LEAK_DEFINITIONS].map(
        ({ name }) => name,
      ),
    ),
  ].toSorted((left, right) => right.length - left.length || left.localeCompare(right)),
);

export const classifierLabelsIn = (value: string): readonly string[] => {
  const normalized = value.toUpperCase();
  return ACTIVE_HUMAN_CLASSIFIER_LABELS.filter((label) => normalized.includes(label.toUpperCase()));
};
