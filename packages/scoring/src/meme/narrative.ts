import type { ProfileScorecard, RoastMode } from "../fast-scan/types.js";

import { ATOM_BY_ID, atomPriority, evaluateAtoms } from "./atoms.js";
import type { AtomContext, AtomFacts, NarrativeTheme } from "./types.js";

export interface ThemeSelection {
  readonly themeId: NarrativeTheme;
  readonly dominantAtomId: string;
  readonly supportingAtomIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

interface Ranked {
  readonly atomId: string;
  readonly facts: AtomFacts;
  readonly themes: readonly NarrativeTheme[];
  readonly priority: number;
}

/**
 * The theme is derived from atoms that actually fired, so a battle can never be *about*
 * something the scan did not measure. `verdict_margin` and the round-margin atoms are
 * excluded from the contest: they always fire and carry no subject-matter evidence, so
 * letting them win would make every theme `balanced` (ADR 0010 D1).
 */
const THEMELESS = new Set(["verdict_margin", "round_clear_win", "round_close_win", "round_tie"]);

function rankFired(context: AtomContext, roast: RoastMode): readonly Ranked[] {
  const fired = evaluateAtoms(context, roast);
  const ranked: Ranked[] = [];
  for (const [atomId, facts] of fired) {
    if (THEMELESS.has(atomId)) continue;
    const atom = ATOM_BY_ID.get(atomId);
    if (atom === undefined) continue;
    ranked.push({ atomId, facts, themes: atom.themes, priority: atomPriority(atomId) });
  }
  return ranked.sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    return left.atomId.localeCompare(right.atomId);
  });
}

/**
 * Pure and deterministic: the same two scorecards and roast mode always produce the same
 * theme. Both sides are ranked, and the strongest single contrast wins — so the theme is
 * a property of the matchup rather than of whoever happens to be on the left.
 */
export function selectTheme(
  left: ProfileScorecard,
  right: ProfileScorecard,
  margin: number,
  roast: RoastMode,
): ThemeSelection {
  const contexts: readonly AtomContext[] = [
    { subject: left, opponent: right, subjectSide: "left", margin },
    { subject: right, opponent: left, subjectSide: "right", margin },
  ];
  const ranked = contexts.flatMap((context) => rankFired(context, roast));
  const ordered = [...ranked].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.atomId.localeCompare(b.atomId);
  });

  const dominant = ordered[0];
  if (dominant === undefined) {
    const lowEvidence =
      left.confidence.score < 45 || right.confidence.score < 45 ? "low-evidence" : "balanced";
    return {
      themeId: lowEvidence,
      dominantAtomId: "verdict_margin",
      supportingAtomIds: [],
      evidenceIds: [],
    };
  }

  const themeId = dominant.themes[0] ?? "balanced";
  const supporting = ordered
    .slice(1)
    .filter((entry) => entry.themes.includes(themeId))
    .map((entry) => entry.atomId);

  return {
    themeId,
    dominantAtomId: dominant.atomId,
    supportingAtomIds: [...new Set(supporting)].slice(0, 4),
    evidenceIds: dominant.facts.evidenceIds,
  };
}

/**
 * How strongly an on-theme atom is favoured inside a slot. Large enough to keep a battle
 * coherent, small enough that a higher-priority off-theme claim still wins — the theme
 * directs the story, it does not censor the evidence.
 */
export const THEME_BOOST = 12;

export const themeBoostFor = (atomId: string, themeId: NarrativeTheme): number => {
  const atom = ATOM_BY_ID.get(atomId);
  return atom !== undefined && atom.themes.includes(themeId) ? THEME_BOOST : 0;
};
