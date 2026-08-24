import { CODE_DNA_DEFINITIONS } from "@gitmog/personality";
import { AURA_LEAK_DEFINITIONS, MOGSONA_DEFINITIONS } from "@gitmog/scoring";

const INTERNAL_TAXONOMY_MARKERS = Object.freeze(["AURA LEAK", "MOGSONA", "CODE DNA"]);

export const HUMAN_CLASSIFIER_IDENTITIES: readonly string[] = Object.freeze(
  [
    ...new Set(
      [...CODE_DNA_DEFINITIONS, ...MOGSONA_DEFINITIONS, ...AURA_LEAK_DEFINITIONS].map(
        (definition) => definition.name.toUpperCase(),
      ),
    ),
  ].toSorted((left, right) => right.length - left.length || left.localeCompare(right)),
);

export const containsHumanClassifierIdentity = (value: string): boolean => {
  const normalized = value.toUpperCase();
  return [...INTERNAL_TAXONOMY_MARKERS, ...HUMAN_CLASSIFIER_IDENTITIES].some((label) =>
    normalized.includes(label),
  );
};
