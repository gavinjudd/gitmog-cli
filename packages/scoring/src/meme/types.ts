import type { ProfileScorecard, RoastMode, Side } from "../fast-scan/types.js";

/** Presentation version for the narrative director, motifs, atoms and templates. Joins
 * the battle key (ADR 0008 D6). Bumping it never implies the numeric score moved. */
export const MEME_ENGINE_VERSION = "1.5.0-human-readability-copy";

/** The default Spicy lane is the product voice, so it carries a higher editorial
 * floor than mere schema validity. Short card variants keep their own compact floor. */
export const SPICY_FULL_COPY_MINIMUM = 30;
export const SPICY_SHORT_COPY_MINIMUM = 20;

export type MemeSlot =
  "finisher" | "round" | "strength" | "weakness" | "summary" | "low-evidence" | "matchup";

export type SafetyCategory =
  | "output"
  | "tooling"
  | "maintenance"
  | "collaboration"
  | "structure"
  | "coverage"
  | "margin"
  | "identity";

/** The theme the whole battle is told through (ADR 0010 D1). */
export type NarrativeTheme =
  | "shipping"
  | "testing"
  | "tooling"
  | "grindset"
  | "commit-discipline"
  | "maintenance"
  | "open-source"
  | "repo-graveyard"
  | "one-repo"
  | "low-evidence"
  | "balanced";

export const NARRATIVE_THEMES = Object.freeze([
  "shipping",
  "testing",
  "tooling",
  "grindset",
  "commit-discipline",
  "maintenance",
  "open-source",
  "repo-graveyard",
  "one-repo",
  "low-evidence",
  "balanced",
] as const);

export interface AtomFacts {
  /** How strongly the atom fired. Used only for ranking, never printed raw. */
  readonly intensity: number;
  /** Token values a template may interpolate. A template cannot print a number the
   * atom did not supply (ADR 0005 D4). */
  readonly tokens: Readonly<Record<string, string>>;
  readonly evidenceIds: readonly string[];
}

export interface AtomContext {
  readonly subject: ProfileScorecard;
  readonly opponent: ProfileScorecard;
  readonly subjectSide: Side;
  readonly margin: number;
}

export interface MemeAtom {
  readonly id: string;
  readonly slots: readonly MemeSlot[];
  readonly polarity: "positive" | "negative" | "neutral";
  /** Scorecard category the claim belongs to, or `overall`. */
  readonly category: string;
  readonly requiredSignals: readonly string[];
  readonly minimumThreshold: number;
  readonly roastModes: readonly RoastMode[];
  readonly maxRepetitions: number;
  readonly safety: SafetyCategory;
  /** The narrative themes this atom can be the dominant evidence for. */
  readonly themes: readonly NarrativeTheme[];
  readonly limits: { readonly web: number; readonly card: number };
  readonly evaluate: (context: AtomContext) => AtomFacts | null;
}

export interface MemeTemplate {
  readonly id: string;
  readonly slot: MemeSlot;
  readonly atoms: readonly string[];
  /** Restricts a round template to particular categories. Absent means any. */
  readonly categories?: readonly string[];
  /**
   * The comedic premise. Tracked across the whole battle so the same joke cannot be told
   * four times in four sections (ADR 0010 D2). Two templates sharing a motif are two
   * phrasings of one idea, not two ideas.
   */
  readonly motif: string;
  /** 1 deadpan, 2 sharp, 3 unhinged. Used to spread intensity across sections. */
  readonly energy: 1 | 2 | 3;
  readonly voice: "deadpan" | "fight-card" | "terminal" | "brainrot";
  readonly text: Readonly<Record<RoastMode, string>>;
  /** Shorter phrasing used when the surface budget cannot fit `text`. */
  readonly short?: Readonly<Record<RoastMode, string>>;
}
