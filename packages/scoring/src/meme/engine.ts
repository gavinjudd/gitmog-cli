import type { MemeLine, ProfileScorecard, RoastMode, Side } from "../fast-scan/types.js";

import { ATOM_BY_ID, atomPriority, evaluateAtoms } from "./atoms.js";
import { themeBoostFor } from "./narrative.js";
import { MEME_TEMPLATES } from "./templates.js";
import type { AtomContext, AtomFacts, MemeSlot, MemeTemplate, NarrativeTheme } from "./types.js";

export type Surface = "web" | "card";

/** FNV-1a. Deterministic, order-independent, and dependency-free. There is no PRNG in
 * this package: selection is a pure function of the battle key (ADR 0005 D2). */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export interface MemeEngineOptions {
  readonly left: ProfileScorecard;
  readonly right: ProfileScorecard;
  readonly battleKey: string;
  readonly roast: RoastMode;
  readonly themeId: NarrativeTheme;
  /** Premises already visible in the two Mogsona/Aura Leak lines. */
  readonly reservedMotifs?: readonly string[] | undefined;
}

export interface SelectedLine {
  readonly line: MemeLine;
  readonly cardText: string;
  readonly motif: string;
}

interface Candidate {
  readonly atomId: string;
  readonly facts: AtomFacts;
  readonly templates: readonly MemeTemplate[];
  readonly rank: number;
}

/**
 * How many times one comedic premise may appear across a whole battle. Two is the
 * difference between a running theme and the same joke told four times (ADR 0010 D2).
 */
export const MOTIF_BUDGET = 2;

const handleOf = (card: ProfileScorecard): string => card.username;

function renderTemplate(
  template: MemeTemplate,
  roast: RoastMode,
  tokens: Readonly<Record<string, string>>,
  useShort: boolean,
): string {
  const source = useShort && template.short !== undefined ? template.short : template.text;
  const raw = source[roast];
  return raw.replace(/\{(\w+)\}/g, (_match, token: string) => {
    const value = tokens[token];
    if (value === undefined) {
      throw new Error(`Template ${template.id} interpolates unknown token {${token}}`);
    }
    return value;
  });
}

/**
 * Turns a scored battle into commentary. Holds the used-template set, the per-atom
 * repetition budget and the motif counter for the whole battle, so no line, no claim and
 * no comedic premise repeats past its budget.
 */
export class MemeEngine {
  readonly #options: MemeEngineOptions;
  readonly #usedTemplates = new Set<string>();
  readonly #atomUses = new Map<string, number>();
  readonly #motifUses = new Map<string, number>();

  constructor(options: MemeEngineOptions) {
    this.#options = options;
    for (const motif of options.reservedMotifs ?? []) {
      this.#motifUses.set(motif, (this.#motifUses.get(motif) ?? 0) + 1);
    }
  }

  /** Motif usage after the battle is built. The copy lint asserts against it. */
  motifUsage(): ReadonlyMap<string, number> {
    return new Map(this.#motifUses);
  }

  #card(side: Side): ProfileScorecard {
    return side === "left" ? this.#options.left : this.#options.right;
  }

  #context(subjectSide: Side, margin: number): AtomContext {
    const other: Side = subjectSide === "left" ? "right" : "left";
    return {
      subject: this.#card(subjectSide),
      opponent: this.#card(other),
      subjectSide,
      margin,
    };
  }

  #candidates(
    slot: MemeSlot,
    context: AtomContext,
    categoryId: string | null,
  ): readonly Candidate[] {
    const fired = evaluateAtoms(context, this.#options.roast);
    const candidates: Candidate[] = [];
    for (const [atomId, facts] of fired) {
      const atom = ATOM_BY_ID.get(atomId);
      if (atom === undefined || !atom.slots.includes(slot)) continue;
      // Repetition budget is global to the battle. One atom is one factual claim, so a
      // claim used as the finisher cannot reappear as a strength and a summary merely
      // because those are different slots (ADR 0010 D2).
      if ((this.#atomUses.get(atomId) ?? 0) >= atom.maxRepetitions) continue;
      const matching = MEME_TEMPLATES.filter(
        (template) =>
          template.slot === slot &&
          template.atoms.includes(atomId) &&
          !this.#usedTemplates.has(template.id) &&
          (this.#motifUses.get(template.motif) ?? 0) < MOTIF_BUDGET &&
          (template.categories === undefined ||
            (categoryId !== null && template.categories.includes(categoryId))),
      ).sort((left, right) => left.id.localeCompare(right.id));
      // A category-specific editor wrote a line for this round. Do not put the generic
      // line back into the hash pool and let it win by chance (ADR 0010 D1).
      const specific =
        categoryId === null
          ? []
          : matching.filter((template) => template.categories?.includes(categoryId) === true);
      const templates = specific.length > 0 ? specific : matching;
      if (templates.length > 0) {
        candidates.push({
          atomId,
          facts,
          templates,
          rank: atomPriority(atomId) + themeBoostFor(atomId, this.#options.themeId),
        });
      }
    }
    return candidates.sort((left, right) => {
      if (right.rank !== left.rank) return right.rank - left.rank;
      if (right.facts.intensity !== left.facts.intensity) {
        return right.facts.intensity - left.facts.intensity;
      }
      return left.atomId.localeCompare(right.atomId);
    });
  }

  #select(
    slot: MemeSlot,
    context: AtomContext,
    options: { readonly categoryId?: string | null; readonly slotKey: string },
  ): SelectedLine | null {
    const categoryId = options.categoryId ?? null;
    const candidates = this.#candidates(slot, context, categoryId);
    const chosen = candidates[0];
    if (chosen === undefined) return null;

    const atom = ATOM_BY_ID.get(chosen.atomId);
    if (atom === undefined) return null;

    const seed = `${this.#options.battleKey}:${options.slotKey}:${chosen.atomId}`;
    const index = fnv1a32(seed) % chosen.templates.length;
    const template = chosen.templates[index] as MemeTemplate;

    const tokens: Record<string, string> = {
      ...chosen.facts.tokens,
      subject: handleOf(context.subject),
      opponent: handleOf(context.opponent),
    };

    let text = renderTemplate(template, this.#options.roast, tokens, false);
    if (text.length > atom.limits.web) {
      text = renderTemplate(template, this.#options.roast, tokens, true);
    }
    let cardText = renderTemplate(template, this.#options.roast, tokens, true);
    if (cardText.length > atom.limits.card) {
      cardText = `${cardText.slice(0, atom.limits.card - 1).trimEnd()}\u2026`;
    }

    this.#usedTemplates.add(template.id);
    this.#atomUses.set(chosen.atomId, (this.#atomUses.get(chosen.atomId) ?? 0) + 1);
    this.#motifUses.set(template.motif, (this.#motifUses.get(template.motif) ?? 0) + 1);

    return {
      line: {
        text,
        templateId: template.id,
        atomId: chosen.atomId,
        evidenceIds: chosen.facts.evidenceIds,
      },
      cardText,
      motif: template.motif,
    };
  }

  /** Never null: `identity_matchup` always fires, and both sides always have a Mogsona. */
  matchup(subjectSide: Side, margin: number): SelectedLine {
    const selected = this.#select("matchup", this.#context(subjectSide, margin), {
      slotKey: "matchup",
    });
    if (selected === null) {
      throw new Error("No matchup template qualified; identity_matchup should always fire");
    }
    return selected;
  }

  /** Never null: `verdict_margin` always fires, so a battle always has a finisher. */
  finisher(subjectSide: Side, margin: number): SelectedLine {
    const selected = this.#select("finisher", this.#context(subjectSide, margin), {
      slotKey: "finisher",
    });
    if (selected === null) {
      throw new Error("No finisher template qualified; verdict_margin should always fire");
    }
    return selected;
  }

  round(categoryId: string, subjectSide: Side, margin: number): SelectedLine | null {
    return this.#select("round", this.#context(subjectSide, margin), {
      categoryId,
      slotKey: `round:${categoryId}`,
    });
  }

  strength(side: Side, margin: number): SelectedLine | null {
    return this.#select("strength", this.#context(side, margin), { slotKey: `strength:${side}` });
  }

  /** Evaluated from the *other* profile's perspective, because a negative atom makes
   * its claim about the opponent. */
  weakness(side: Side, margin: number): SelectedLine | null {
    const other: Side = side === "left" ? "right" : "left";
    return this.#select("weakness", this.#context(other, margin), { slotKey: `weakness:${side}` });
  }

  lowEvidence(side: Side, margin: number): SelectedLine | null {
    const other: Side = side === "left" ? "right" : "left";
    return this.#select("low-evidence", this.#context(other, margin), {
      slotKey: `low-evidence:${side}`,
    });
  }

  summary(subjectSide: Side, margin: number, limit: number): readonly MemeLine[] {
    const lines: MemeLine[] = [];
    for (let index = 0; index < limit; index += 1) {
      const selected = this.#select("summary", this.#context(subjectSide, margin), {
        slotKey: `summary:${String(index)}`,
      });
      if (selected === null) break;
      lines.push(selected.line);
    }
    return lines;
  }
}
