import { ROAST_MODES, type ProfileScorecard, type RoastMode } from "../fast-scan/types.js";

import type { AtomContext, AtomFacts, MemeAtom, NarrativeTheme } from "./types.js";

const ALL_MODES: readonly RoastMode[] = ROAST_MODES;
const SPICY_UP: readonly RoastMode[] = ["spicy", "unhinged"];

const WEB_LIMIT = 150;
const CARD_LIMIT = 92;
const LIMITS = { web: WEB_LIMIT, card: CARD_LIMIT } as const;

const metric = (card: ProfileScorecard, id: string) =>
  card.metrics.find((entry) => entry.id === id);

/** Ratio for a measured metric, or `null` when the metric left the scoring basis. A
 * `null` never becomes a claim: an atom that needs the signal simply does not fire. */
const ratio = (card: ProfileScorecard, id: string): number | null => {
  const found = metric(card, id);
  return found === undefined || found.availability === "unavailable" ? null : found.ratio;
};

const evidenceFor = (card: ProfileScorecard, ...metricIds: readonly string[]): readonly string[] =>
  card.evidence.filter((item) => metricIds.includes(item.metric)).map((item) => item.id);

const percent = (value: number): string => `${String(Math.round(value * 100))}%`;

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

const facts = (
  intensity: number,
  tokens: Readonly<Record<string, string>>,
  evidenceIds: readonly string[],
): AtomFacts => ({ intensity, tokens, evidenceIds });

const define = (atom: MemeAtom): MemeAtom => atom;

const theme = (...ids: readonly NarrativeTheme[]): readonly NarrativeTheme[] => ids;

/** Substantial repositories over eligible ones. */
const substanceRatio = (card: ProfileScorecard): number => {
  const { eligibleRepositories: eligible, substantialRepositories: substantial } = card.diagnostics;
  return eligible === 0 ? 0 : substantial / eligible;
};

/**
 * Every atom is a trigger with a threshold and a set of evidence ids. Atoms hold no
 * prose; templates hold no thresholds (ADR 0005 D1). An atom that does not fire can
 * never be phrased, which is what keeps every printed line traceable to a number that
 * is rendered in the same response.
 *
 * `themes` names the narrative themes an atom can be the dominant evidence for
 * (ADR 0010 D1). A theme can only be chosen when one of its atoms actually fired.
 */
export const MEME_ATOMS: readonly MemeAtom[] = Object.freeze([
  define({
    id: "tests_gap",
    slots: ["finisher", "round", "strength", "weakness", "summary", "matchup"],
    polarity: "negative",
    category: "craft.testing",
    requiredSignals: ["craft.testing.exists"],
    minimumThreshold: 0.35,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "tooling",
    themes: theme("testing"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const mine = ratio(subject, "craft.testing.exists");
      const theirs = ratio(opponent, "craft.testing.exists");
      if (mine === null || theirs === null) return null;
      if (mine < 0.6 || theirs > 0.25 || mine - theirs < 0.35) return null;
      return facts(
        mine - theirs,
        {
          subjectTests: percent(mine),
          opponentTests: percent(theirs),
          subjectTestFiles: String(subject.diagnostics.repositoriesInspected),
        },
        [
          ...evidenceFor(subject, "craft.testing.exists"),
          ...evidenceFor(opponent, "craft.testing.exists"),
        ],
      );
    },
  }),

  define({
    id: "verification_stack",
    slots: ["strength", "round", "summary", "finisher", "matchup"],
    polarity: "positive",
    category: "craft.testing",
    requiredSignals: ["craft.testing.exists", "craft.testing.workflow"],
    minimumThreshold: 0.7,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "tooling",
    themes: theme("testing"),
    limits: LIMITS,
    evaluate: ({ subject }) => {
      const tests = ratio(subject, "craft.testing.exists");
      const workflow = ratio(subject, "craft.testing.workflow");
      const ci = ratio(subject, "craft.tooling.ci");
      if (tests === null || workflow === null) return null;
      if (tests < 0.7 || workflow < 0.6 || subject.diagnostics.repositoriesInspected < 2)
        return null;
      return facts(
        (tests + workflow) / 2,
        {
          subjectTests: percent(tests),
          subjectWorkflow: percent(workflow),
          subjectCiCoverage: percent(ci ?? workflow),
        },
        [
          ...evidenceFor(subject, "craft.testing.exists"),
          ...evidenceFor(subject, "craft.testing.workflow"),
        ],
      );
    },
  }),

  define({
    id: "ci_gap",
    slots: ["finisher", "round", "strength", "weakness", "summary", "matchup"],
    polarity: "negative",
    category: "craft.tooling",
    requiredSignals: ["craft.tooling.ci"],
    minimumThreshold: 0.35,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "tooling",
    themes: theme("tooling"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const mine = ratio(subject, "craft.tooling.ci");
      const theirs = ratio(opponent, "craft.tooling.ci");
      if (mine === null || theirs === null) return null;
      if (mine < 0.6 || theirs > 0.25 || mine - theirs < 0.35) return null;
      return facts(mine - theirs, { subjectCi: percent(mine), opponentCi: percent(theirs) }, [
        ...evidenceFor(subject, "craft.tooling.ci"),
        ...evidenceFor(opponent, "craft.tooling.ci"),
      ]);
    },
  }),

  define({
    id: "tooling_without_output",
    slots: ["finisher", "weakness", "summary"],
    polarity: "negative",
    category: "craft.tooling",
    requiredSignals: ["craft.tooling.ci", "ship.substance.substantialProjects"],
    minimumThreshold: 0.7,
    roastModes: SPICY_UP,
    maxRepetitions: 1,
    safety: "tooling",
    themes: theme("tooling"),
    limits: LIMITS,
    evaluate: ({ opponent }) => {
      const ci = ratio(opponent, "craft.tooling.ci");
      const substance = ratio(opponent, "ship.substance.substantialProjects");
      if (ci === null || substance === null) return null;
      if (ci < 0.7 || substance > 0.45 || opponent.diagnostics.releaseCount > 1) return null;
      return facts(
        ci - substance,
        {
          opponentCi: percent(ci),
          opponentSubstantial: String(opponent.diagnostics.substantialRepositories),
        },
        [
          ...evidenceFor(opponent, "craft.tooling.ci"),
          ...evidenceFor(opponent, "ship.substance.substantialProjects"),
        ],
      );
    },
  }),

  define({
    id: "release_gap",
    slots: ["finisher", "round", "strength", "summary", "matchup"],
    polarity: "negative",
    category: "ship.breadth",
    requiredSignals: ["ship.breadth.released"],
    minimumThreshold: 1,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("shipping"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const mine = subject.diagnostics.releaseCount;
      const theirs = opponent.diagnostics.releaseCount;
      if (mine < 2 || theirs > 0) return null;
      return facts(mine, { subjectReleases: plural(mine, "release", "releases") }, [
        ...evidenceFor(subject, "ship.breadth.released"),
        ...evidenceFor(opponent, "ship.breadth.released"),
      ]);
    },
  }),

  define({
    id: "release_density_gap",
    slots: ["finisher", "round", "strength", "summary"],
    polarity: "positive",
    category: "ship.breadth",
    requiredSignals: ["ship.breadth.released"],
    minimumThreshold: 2,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("shipping"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const mine = subject.diagnostics.releaseCount;
      const theirs = opponent.diagnostics.releaseCount;
      const projects = Math.max(1, subject.diagnostics.substantialRepositories);
      if (mine < 6 || subject.diagnostics.releaseRepositories < 2 || mine - theirs < 4) return null;
      return facts(
        mine / projects,
        {
          subjectReleaseCount: String(mine),
          subjectReleaseProjects: String(subject.diagnostics.releaseRepositories),
          subjectReleaseDensity: (mine / projects).toFixed(1),
        },
        [
          ...evidenceFor(subject, "ship.breadth.released"),
          ...evidenceFor(subject, "craft.hygiene.releases"),
        ],
      );
    },
  }),

  define({
    id: "ship_to_yap_gap",
    slots: ["finisher", "summary", "matchup"],
    polarity: "negative",
    category: "ship.breadth",
    requiredSignals: ["ship.breadth.released", "craft.hygiene.documentation"],
    minimumThreshold: 2,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("shipping"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const docs = ratio(opponent, "craft.hygiene.documentation");
      if (docs === null || docs < 0.6) return null;
      if (subject.diagnostics.releaseCount < 3 || opponent.diagnostics.releaseCount > 0)
        return null;
      return facts(
        subject.diagnostics.releaseCount,
        {
          subjectReleaseCount: String(subject.diagnostics.releaseCount),
          opponentDocs: percent(docs),
        },
        [
          ...evidenceFor(subject, "ship.breadth.released"),
          ...evidenceFor(opponent, "craft.hygiene.documentation"),
        ],
      );
    },
  }),

  define({
    id: "recent_activity_gap",
    slots: ["finisher", "round", "weakness", "summary", "matchup"],
    polarity: "negative",
    category: "ship.frequency",
    requiredSignals: ["ship.frequency.recency"],
    minimumThreshold: 150,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("grindset"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const mine = subject.diagnostics.daysSinceLastPublicPush;
      const theirs = opponent.diagnostics.daysSinceLastPublicPush;
      if (mine === null || theirs === null) return null;
      if (mine > 30 || theirs < 180) return null;
      return facts(
        theirs - mine,
        {
          subjectDays: String(mine),
          opponentDays: String(theirs),
          opponentMonths: String(Math.round(theirs / 30)),
        },
        [
          ...evidenceFor(subject, "ship.frequency.recency"),
          ...evidenceFor(opponent, "ship.frequency.recency"),
        ],
      );
    },
  }),

  define({
    id: "activity_without_shipping",
    slots: ["finisher", "weakness", "summary", "matchup"],
    polarity: "negative",
    category: "ship.frequency",
    requiredSignals: ["ship.frequency.activeWeeks", "ship.substance.substantialProjects"],
    minimumThreshold: 5,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("grindset"),
    limits: LIMITS,
    evaluate: ({ opponent }) => {
      const weeks = opponent.diagnostics.activeWeeksObserved;
      const substance = ratio(opponent, "ship.substance.substantialProjects");
      if (substance === null) return null;
      if (weeks < 6 || substance > 0.45 || opponent.diagnostics.releaseCount > 0) return null;
      return facts(
        weeks,
        {
          opponentWeeks: String(weeks),
          weekWindow: String(opponent.diagnostics.activeWeeksWindow),
          opponentSubstantial: String(opponent.diagnostics.substantialRepositories),
        },
        [
          ...evidenceFor(opponent, "ship.frequency.activeWeeks"),
          ...evidenceFor(opponent, "ship.substance.substantialProjects"),
        ],
      );
    },
  }),

  define({
    id: "abandoned_project_gap",
    slots: ["finisher", "round", "weakness", "summary"],
    polarity: "negative",
    category: "craft.hygiene",
    requiredSignals: ["craft.hygiene.abandonment"],
    minimumThreshold: 2,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "maintenance",
    themes: theme("repo-graveyard"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const mine = subject.diagnostics.abandonedSubstantialRepositories;
      const theirs = opponent.diagnostics.abandonedSubstantialRepositories;
      if (theirs < 2 || theirs - mine < 2) return null;
      return facts(
        theirs - mine,
        {
          opponentAbandoned: plural(theirs, "abandoned side quest", "abandoned side quests"),
          opponentAbandonedCount: String(theirs),
          subjectReleaseCount: String(subject.diagnostics.releaseCount),
        },
        [
          ...evidenceFor(subject, "craft.hygiene.abandonment"),
          ...evidenceFor(opponent, "craft.hygiene.abandonment"),
        ],
      );
    },
  }),

  define({
    id: "repo_graveyard_density",
    slots: ["finisher", "weakness", "summary", "matchup"],
    polarity: "negative",
    category: "craft.hygiene",
    requiredSignals: ["craft.hygiene.abandonment"],
    minimumThreshold: 0.4,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "maintenance",
    themes: theme("repo-graveyard"),
    limits: LIMITS,
    evaluate: ({ opponent }) => {
      const abandoned = opponent.diagnostics.abandonedSubstantialRepositories;
      const substantial = Math.max(1, opponent.diagnostics.substantialRepositories);
      const density = abandoned / substantial;
      if (abandoned < 3 || density < 0.4) return null;
      return facts(
        density,
        {
          opponentAbandonedCount: String(abandoned),
          opponentGraveyardShare: percent(density),
          opponentArchived: String(opponent.diagnostics.archivedRepositories),
        },
        evidenceFor(opponent, "craft.hygiene.abandonment"),
      );
    },
  }),

  define({
    id: "repo_count_without_substance",
    slots: ["finisher", "weakness", "summary"],
    polarity: "negative",
    category: "ship.substance",
    requiredSignals: ["ship.substance.substantialProjects"],
    minimumThreshold: 8,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("shipping"),
    limits: LIMITS,
    evaluate: ({ opponent }) => {
      const eligible = opponent.diagnostics.eligibleRepositories;
      const substantial = opponent.diagnostics.substantialRepositories;
      if (eligible < 8 || substanceRatio(opponent) >= 0.35) return null;
      return facts(
        eligible - substantial,
        {
          opponentRepos: String(eligible),
          opponentSubstantial: String(substantial),
        },
        evidenceFor(opponent, "ship.substance.substantialProjects"),
      );
    },
  }),

  define({
    id: "substance_ratio_gap",
    slots: ["round", "summary", "matchup"],
    polarity: "positive",
    category: "ship.substance",
    requiredSignals: ["ship.substance.substantialProjects"],
    minimumThreshold: 0.3,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("shipping"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const mine = substanceRatio(subject);
      const theirs = substanceRatio(opponent);
      if (subject.diagnostics.eligibleRepositories < 3) return null;
      if (mine < 0.6 || mine - theirs < 0.3) return null;
      return facts(
        mine - theirs,
        { subjectSubstanceRatio: percent(mine), opponentSubstanceRatio: percent(theirs) },
        [
          ...evidenceFor(subject, "ship.substance.substantialProjects"),
          ...evidenceFor(opponent, "ship.substance.substantialProjects"),
        ],
      );
    },
  }),

  define({
    id: "polyglot_with_depth",
    slots: ["finisher", "round", "strength", "summary"],
    polarity: "positive",
    category: "ship.substance",
    requiredSignals: ["ship.substance.substantialProjects"],
    minimumThreshold: 3,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("balanced"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const mine = subject.diagnostics.substantialLanguages.length;
      const theirs = opponent.diagnostics.substantialLanguages.length;
      if (mine < 3 || mine - theirs < 2) return null;
      if (subject.diagnostics.substantialRepositories < 2) return null;
      const primary = opponent.diagnostics.substantialLanguages[0] ?? "one language";
      return facts(
        mine - theirs,
        {
          subjectLanguages: String(mine),
          opponentLanguages: String(theirs),
          opponentPrimaryLanguage: primary,
        },
        [
          ...evidenceFor(subject, "ship.substance.substantialProjects"),
          ...evidenceFor(subject, "ship.substance.sustainedWork"),
        ],
      );
    },
  }),

  define({
    id: "polyglot_without_depth",
    slots: ["weakness", "summary"],
    polarity: "negative",
    category: "ship.substance",
    requiredSignals: ["ship.substance.substantialProjects", "ship.substance.sustainedWork"],
    minimumThreshold: 4,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("balanced"),
    limits: LIMITS,
    evaluate: ({ opponent }) => {
      const observed = opponent.diagnostics.languagesObserved.length;
      const deep = opponent.diagnostics.substantialLanguages.length;
      const sustained = ratio(opponent, "ship.substance.sustainedWork");
      if (sustained === null) return null;
      if (observed < 4 || deep >= 3 || sustained > 0.5) return null;
      return facts(
        observed - deep,
        {
          opponentLanguages: String(observed),
          opponentDeepLanguages: String(deep),
          opponentSustained: String(opponent.diagnostics.sustainedRepositories),
        },
        [
          ...evidenceFor(opponent, "ship.substance.substantialProjects"),
          ...evidenceFor(opponent, "ship.substance.sustainedWork"),
        ],
      );
    },
  }),

  define({
    id: "impact_concentration",
    slots: ["finisher", "round", "strength", "summary"],
    polarity: "positive",
    category: "ship.substance",
    requiredSignals: ["ship.substance.substantialProjects"],
    minimumThreshold: 3,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("shipping"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const mine = subject.diagnostics.substantialRepositories;
      const theirs = opponent.diagnostics.substantialRepositories;
      if (mine < 4 || theirs > 1 || mine - theirs < 3) return null;
      return facts(
        mine - theirs,
        { subjectSubstantial: String(mine), opponentSubstantial: String(theirs) },
        [
          ...evidenceFor(subject, "ship.substance.substantialProjects"),
          ...evidenceFor(opponent, "ship.substance.substantialProjects"),
        ],
      );
    },
  }),

  define({
    id: "one_repo_final_boss",
    slots: ["finisher", "strength", "summary", "matchup"],
    polarity: "positive",
    category: "ship.substance",
    requiredSignals: ["ship.substance.substantialProjects"],
    minimumThreshold: 1,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("one-repo"),
    limits: LIMITS,
    evaluate: ({ subject }) => {
      if (
        subject.diagnostics.substantialRepositories > 2 ||
        subject.diagnostics.dominantRepositoryShare < 0.7 ||
        (subject.diagnostics.releaseCount < 2 &&
          (ratio(subject, "craft.testing.exists") ?? 0) < 0.6)
      ) {
        return null;
      }
      return facts(
        subject.diagnostics.dominantRepositoryShare,
        {
          subjectSubstantial: String(subject.diagnostics.substantialRepositories),
          subjectDominantShare: percent(subject.diagnostics.dominantRepositoryShare),
        },
        [
          ...evidenceFor(subject, "ship.substance.substantialProjects"),
          ...evidenceFor(subject, "ship.substance.sustainedWork"),
        ],
      );
    },
  }),

  define({
    id: "one_repo_carry",
    slots: ["round", "summary", "weakness", "matchup"],
    polarity: "negative",
    category: "ship.substance",
    requiredSignals: ["ship.substance.substantialProjects"],
    minimumThreshold: 0.8,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("one-repo"),
    limits: LIMITS,
    evaluate: ({ opponent }) => {
      const share = opponent.diagnostics.dominantRepositoryShare;
      const sustained = ratio(opponent, "ship.substance.sustainedWork");
      if (share < 0.8 || opponent.diagnostics.substantialRepositories > 2) return null;
      if (sustained !== null && sustained >= 0.5 && opponent.diagnostics.releaseCount >= 2) {
        return null;
      }
      return facts(
        share,
        {
          opponentDominantShare: percent(share),
          opponentSubstantial: String(opponent.diagnostics.substantialRepositories),
        },
        evidenceFor(opponent, "ship.substance.substantialProjects"),
      );
    },
  }),

  define({
    id: "docs_without_shipping",
    slots: ["finisher", "weakness", "summary"],
    polarity: "negative",
    category: "craft.hygiene",
    requiredSignals: ["craft.hygiene.documentation", "ship.breadth.released"],
    minimumThreshold: 0.8,
    roastModes: SPICY_UP,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("shipping"),
    limits: LIMITS,
    evaluate: ({ opponent }) => {
      const docs = ratio(opponent, "craft.hygiene.documentation");
      const tests = ratio(opponent, "craft.testing.exists");
      if (docs === null || docs < 0.8) return null;
      if (opponent.diagnostics.releaseCount > 0) return null;
      if (tests !== null && tests > 0.25) return null;
      return facts(docs, { opponentDocs: percent(docs) }, [
        ...evidenceFor(opponent, "craft.hygiene.documentation"),
        ...evidenceFor(opponent, "ship.breadth.released"),
      ]);
    },
  }),

  define({
    id: "high_fork_ratio",
    slots: ["finisher", "weakness", "summary"],
    polarity: "negative",
    category: "ship.substance",
    requiredSignals: ["ship.substance.substantialProjects"],
    minimumThreshold: 0.5,
    roastModes: SPICY_UP,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("shipping"),
    limits: LIMITS,
    evaluate: ({ opponent }) => {
      const total = opponent.diagnostics.publicRepositories;
      const forks = opponent.diagnostics.forkedRepositories;
      if (total < 6 || forks / total < 0.5) return null;
      return facts(
        forks / total,
        { opponentForks: String(forks), opponentForkShare: percent(forks / total) },
        evidenceFor(opponent, "ship.substance.substantialProjects"),
      );
    },
  }),

  define({
    id: "strong_maintenance",
    slots: ["finisher", "strength", "round", "summary", "matchup"],
    polarity: "positive",
    category: "ship.breadth",
    requiredSignals: ["ship.breadth.continuity"],
    minimumThreshold: 0.8,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "maintenance",
    themes: theme("maintenance"),
    limits: LIMITS,
    evaluate: ({ subject }) => {
      const continuity = ratio(subject, "ship.breadth.continuity");
      if (continuity === null || continuity < 0.8) return null;
      if (subject.diagnostics.substantialRepositories < 3) return null;
      return facts(
        continuity,
        {
          subjectMaintained: String(subject.diagnostics.substantialRepositories),
          subjectContinuity: percent(continuity),
        },
        evidenceFor(subject, "ship.breadth.continuity"),
      );
    },
  }),

  define({
    id: "external_project_activity",
    slots: ["finisher", "strength", "round", "summary", "matchup"],
    polarity: "positive",
    category: "ship.breadth",
    requiredSignals: ["ship.breadth.external"],
    minimumThreshold: 2,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "collaboration",
    themes: theme("open-source"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const mine = subject.diagnostics.externalRepositoriesTouched;
      const theirs = opponent.diagnostics.externalRepositoriesTouched;
      if (mine < 2 || mine - theirs < 2) return null;
      return facts(
        mine - theirs,
        {
          subjectExternal: String(mine),
          opponentExternal: String(theirs),
          subjectMergedPrs: String(subject.diagnostics.mergedPullRequests),
        },
        [
          ...evidenceFor(subject, "ship.breadth.external"),
          ...evidenceFor(opponent, "ship.breadth.external"),
        ],
      );
    },
  }),

  define({
    id: "monorepo_operating_system",
    slots: ["strength", "round", "summary"],
    polarity: "positive",
    category: "craft.hygiene",
    requiredSignals: ["craft.hygiene.organization"],
    minimumThreshold: 0.7,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "structure",
    themes: theme("tooling"),
    limits: LIMITS,
    // Real workspace detection from the file tree, not an organization score standing in
    // for one. A single incidental workspace file is not a monorepo.
    evaluate: ({ subject }) => {
      const organization = ratio(subject, "craft.hygiene.organization");
      if (organization === null || organization < 0.6) return null;
      if (subject.diagnostics.monorepoRepositories < 1) return null;
      return facts(
        organization,
        {
          subjectOrganization: percent(organization),
          subjectWorkspaces: plural(
            subject.diagnostics.monorepoRepositories,
            "workspace",
            "workspaces",
          ),
        },
        [
          ...evidenceFor(subject, "craft.hygiene.organization"),
          ...evidenceFor(subject, "craft.tooling.build"),
        ],
      );
    },
  }),

  define({
    id: "release_avoidance",
    slots: ["finisher", "weakness", "round", "summary"],
    polarity: "negative",
    category: "craft.hygiene",
    requiredSignals: ["craft.hygiene.releases"],
    minimumThreshold: 0.5,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("shipping"),
    limits: LIMITS,
    evaluate: ({ opponent }) => {
      const releases = ratio(opponent, "craft.hygiene.releases");
      if (releases === null || releases > 0) return null;
      if (opponent.diagnostics.substantialRepositories < 2) return null;
      return facts(
        1,
        { opponentSubstantial: String(opponent.diagnostics.substantialRepositories) },
        evidenceFor(opponent, "craft.hygiene.releases"),
      );
    },
  }),

  define({
    id: "high_tree_coverage",
    slots: ["strength", "summary"],
    polarity: "positive",
    category: "craft.testing",
    requiredSignals: ["craft.testing.exists"],
    minimumThreshold: 1,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "coverage",
    themes: theme("balanced"),
    limits: LIMITS,
    evaluate: ({ subject }) => {
      if (subject.confidence.treeCoverage < 1 || subject.confidence.analyzedRepositories < 3) {
        return null;
      }
      return facts(
        subject.confidence.treeCoverage,
        { subjectInspected: String(subject.confidence.analyzedRepositories) },
        evidenceFor(subject, "craft.testing.exists"),
      );
    },
  }),

  define({
    id: "low_public_evidence",
    slots: ["low-evidence", "summary", "weakness"],
    polarity: "neutral",
    category: "overall",
    requiredSignals: [],
    minimumThreshold: 0,
    roastModes: ALL_MODES,
    maxRepetitions: 2,
    safety: "coverage",
    themes: theme("low-evidence"),
    limits: LIMITS,
    // Negative-slot convention: the claim is about the *opponent* of the evaluation
    // context, so `weakness(side)` and `lowEvidence(side)` both evaluate with the
    // other profile as subject.
    evaluate: ({ opponent }) => {
      if (opponent.confidence.score >= 45 && opponent.confidence.analyzedRepositories >= 2) {
        return null;
      }
      return facts(
        45 - opponent.confidence.score,
        {
          opponentConfidence: String(opponent.confidence.score),
          opponentInspected: String(opponent.confidence.analyzedRepositories),
          opponentInspectable: plural(
            opponent.confidence.analyzedRepositories,
            "inspectable repository",
            "inspectable repositories",
          ),
          opponentEligible: String(opponent.confidence.eligibleRepositories),
        },
        opponent.evidence.map((item) => item.id),
      );
    },
  }),

  define({
    id: "public_evidence_diff",
    slots: ["summary", "matchup"],
    polarity: "neutral",
    category: "overall",
    requiredSignals: [],
    minimumThreshold: 15,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "coverage",
    themes: theme("low-evidence"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const delta = subject.confidence.score - opponent.confidence.score;
      if (delta < 15) return null;
      return facts(
        delta,
        {
          subjectConfidence: String(subject.confidence.score),
          opponentConfidence: String(opponent.confidence.score),
          subjectInspected: String(subject.confidence.analyzedRepositories),
          opponentInspected: String(opponent.confidence.analyzedRepositories),
        },
        [...subject.evidence, ...opponent.evidence].map((item) => item.id),
      );
    },
  }),

  define({
    id: "confidence_mismatch",
    slots: ["summary", "weakness"],
    polarity: "neutral",
    category: "overall",
    requiredSignals: [],
    minimumThreshold: 0,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "coverage",
    themes: theme("low-evidence"),
    limits: LIMITS,
    // A high score on thin evidence is a caveat the product owes the reader.
    evaluate: ({ opponent }) => {
      if (opponent.overallScore < 70 || opponent.confidence.score >= 50) return null;
      return facts(
        opponent.overallScore - opponent.confidence.score,
        {
          opponentScore: String(opponent.overallScore),
          opponentConfidence: String(opponent.confidence.score),
          opponentInspected: String(opponent.confidence.analyzedRepositories),
        },
        opponent.evidence.map((item) => item.id),
      );
    },
  }),

  define({
    id: "commit_manners_gap",
    slots: ["finisher", "round", "weakness", "summary", "matchup"],
    polarity: "negative",
    category: "ship.discipline",
    requiredSignals: ["ship.discipline.messages"],
    minimumThreshold: 0.25,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("commit-discipline"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const mine = ratio(subject, "ship.discipline.messages");
      const theirs = ratio(opponent, "ship.discipline.messages");
      if (mine === null || theirs === null) return null;
      if (opponent.diagnostics.lowEffortCommitMessageRate < 0.25) return null;
      if (subject.diagnostics.lowEffortCommitMessageRate > 0.12) return null;
      return facts(
        opponent.diagnostics.lowEffortCommitMessageRate,
        {
          opponentLowEffort: percent(opponent.diagnostics.lowEffortCommitMessageRate),
          opponentMessageLength: String(opponent.diagnostics.medianCommitMessageLength),
        },
        [
          ...evidenceFor(subject, "ship.discipline.messages"),
          ...evidenceFor(opponent, "ship.discipline.messages"),
        ],
      );
    },
  }),

  define({
    id: "commit_chaos",
    slots: ["finisher", "weakness", "summary", "matchup"],
    polarity: "negative",
    category: "ship.discipline",
    requiredSignals: ["ship.discipline.messages", "ship.discipline.mergeHygiene"],
    minimumThreshold: 0.35,
    roastModes: SPICY_UP,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("commit-discipline"),
    limits: LIMITS,
    evaluate: ({ opponent }) => {
      const lowEffort = opponent.diagnostics.lowEffortCommitMessageRate;
      const reverts = opponent.diagnostics.revertRate;
      if (opponent.diagnostics.commitSampleSize < 20) return null;
      if (lowEffort < 0.35) return null;
      return facts(
        lowEffort + reverts,
        {
          opponentLowEffort: percent(lowEffort),
          opponentReverts: percent(reverts),
          opponentMessageLength: String(opponent.diagnostics.medianCommitMessageLength),
        },
        [
          ...evidenceFor(opponent, "ship.discipline.messages"),
          ...evidenceFor(opponent, "ship.discipline.mergeHygiene"),
        ],
      );
    },
  }),

  define({
    id: "repair_loop_gap",
    slots: ["finisher", "round", "weakness", "summary", "matchup"],
    polarity: "negative",
    category: "ship.discipline",
    requiredSignals: ["ship.discipline.repairLoops"],
    minimumThreshold: 0.25,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("commit-discipline"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const theirs = ratio(opponent, "ship.discipline.repairLoops");
      if (theirs === null) return null;
      if (opponent.diagnostics.repairCommitRate < 0.25) return null;
      if (subject.diagnostics.repairCommitRate > 0.15) return null;
      return facts(
        opponent.diagnostics.repairCommitRate,
        { opponentRepairs: percent(opponent.diagnostics.repairCommitRate) },
        [
          ...evidenceFor(subject, "ship.discipline.repairLoops"),
          ...evidenceFor(opponent, "ship.discipline.repairLoops"),
        ],
      );
    },
  }),

  define({
    id: "main_branch_behavior",
    slots: ["strength", "round", "summary", "finisher", "matchup"],
    polarity: "positive",
    category: "ship.discipline",
    requiredSignals: ["ship.discipline.messages", "ship.frequency.recency"],
    minimumThreshold: 0.7,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("commit-discipline"),
    limits: LIMITS,
    evaluate: ({ subject }) => {
      const messages = ratio(subject, "ship.discipline.messages");
      const repairs = ratio(subject, "ship.discipline.repairLoops");
      const days = subject.diagnostics.daysSinceLastPublicPush;
      if (messages === null || repairs === null || days === null) return null;
      if (messages < 0.75 || days > 30) return null;
      if (subject.diagnostics.repairCommitRate > 0.15 || subject.diagnostics.revertRate > 0.04) {
        return null;
      }
      return facts(
        messages,
        {
          subjectDays: String(days),
          subjectLowEffort: percent(subject.diagnostics.lowEffortCommitMessageRate),
          subjectRepairs: percent(subject.diagnostics.repairCommitRate),
        },
        [
          ...evidenceFor(subject, "ship.discipline.messages"),
          ...evidenceFor(subject, "ship.discipline.repairLoops"),
        ],
      );
    },
  }),

  define({
    id: "sustained_work_gap",
    slots: ["finisher", "round", "strength", "summary", "matchup"],
    polarity: "positive",
    category: "ship.substance",
    requiredSignals: ["ship.substance.sustainedWork"],
    minimumThreshold: 0.5,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("maintenance"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const mine = ratio(subject, "ship.substance.sustainedWork");
      const theirs = ratio(opponent, "ship.substance.sustainedWork");
      if (mine === null || theirs === null) return null;
      if (mine < 0.6 || mine - theirs < 0.4) return null;
      return facts(mine - theirs, { subjectSustained: percent(mine) }, [
        ...evidenceFor(subject, "ship.substance.sustainedWork"),
        ...evidenceFor(opponent, "ship.substance.sustainedWork"),
      ]);
    },
  }),

  define({
    id: "archive_discipline",
    slots: ["strength", "summary", "round"],
    polarity: "positive",
    category: "craft.hygiene",
    requiredSignals: ["craft.hygiene.abandonment"],
    minimumThreshold: 3,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "maintenance",
    themes: theme("maintenance"),
    limits: LIMITS,
    evaluate: ({ subject }) => {
      if (subject.diagnostics.archivedRepositories < 3) return null;
      if (subject.diagnostics.abandonedSubstantialRepositories > 1) return null;
      return facts(
        subject.diagnostics.archivedRepositories,
        {
          subjectArchived: String(subject.diagnostics.archivedRepositories),
          subjectAbandoned: String(subject.diagnostics.abandonedSubstantialRepositories),
        },
        evidenceFor(subject, "craft.hygiene.abandonment"),
      );
    },
  }),

  define({
    id: "structure_gap",
    slots: ["finisher", "round", "strength", "weakness", "summary"],
    polarity: "positive",
    category: "craft.hygiene",
    requiredSignals: ["craft.hygiene.organization"],
    minimumThreshold: 0.3,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "structure",
    themes: theme("tooling"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const mine = ratio(subject, "craft.hygiene.organization");
      const theirs = ratio(opponent, "craft.hygiene.organization");
      if (mine === null || theirs === null) return null;
      if (mine < 0.8 || theirs > 0.5 || mine - theirs < 0.3) return null;
      return facts(
        mine - theirs,
        { subjectOrganization: percent(mine), opponentOrganization: percent(theirs) },
        [
          ...evidenceFor(subject, "craft.hygiene.organization"),
          ...evidenceFor(opponent, "craft.hygiene.organization"),
        ],
      );
    },
  }),

  define({
    id: "grindset_gap",
    slots: ["finisher", "round", "strength", "summary"],
    polarity: "positive",
    category: "ship.frequency",
    requiredSignals: ["ship.frequency.activeWeeks"],
    minimumThreshold: 3,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "output",
    themes: theme("grindset"),
    limits: LIMITS,
    evaluate: ({ subject, opponent }) => {
      const mine = subject.diagnostics.activeWeeksObserved;
      const theirs = opponent.diagnostics.activeWeeksObserved;
      if (mine < 6 || mine - theirs < 3) return null;
      return facts(
        mine - theirs,
        {
          subjectWeeks: String(mine),
          opponentWeeks: String(theirs),
          weekWindow: String(subject.diagnostics.activeWeeksWindow),
        },
        [
          ...evidenceFor(subject, "ship.frequency.activeWeeks"),
          ...evidenceFor(opponent, "ship.frequency.activeWeeks"),
        ],
      );
    },
  }),

  define({
    id: "identity_matchup",
    slots: ["matchup"],
    polarity: "neutral",
    category: "overall",
    requiredSignals: [],
    minimumThreshold: 0,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "identity",
    themes: theme("balanced"),
    limits: LIMITS,
    // Always fires: both sides always have a Mogsona (ADR 0008 D1), so the matchup line
    // has a guaranteed fallback that states two real, evidence-backed assignments.
    evaluate: ({ subject, opponent }) =>
      facts(
        0,
        {
          subjectMogsona: subject.mogsona.name,
          opponentMogsona: opponent.mogsona.name,
          subjectAuraClass: subject.mogsona.auraClass.toUpperCase(),
          opponentAuraClass: opponent.mogsona.auraClass.toUpperCase(),
        },
        [...subject.mogsona.evidenceIds, ...opponent.mogsona.evidenceIds],
      ),
  }),

  define({
    id: "round_clear_win",
    slots: ["round"],
    polarity: "neutral",
    category: "overall",
    requiredSignals: [],
    minimumThreshold: 20,
    roastModes: ALL_MODES,
    maxRepetitions: 8,
    safety: "margin",
    themes: theme("balanced"),
    limits: LIMITS,
    evaluate: ({ margin, subject, opponent }) =>
      margin >= 20
        ? facts(
            margin,
            { margin: String(margin) },
            [...subject.evidence, ...opponent.evidence].map((item) => item.id),
          )
        : null,
  }),

  define({
    id: "round_close_win",
    slots: ["round"],
    polarity: "neutral",
    category: "overall",
    requiredSignals: [],
    minimumThreshold: 0,
    roastModes: ALL_MODES,
    maxRepetitions: 8,
    safety: "margin",
    themes: theme("balanced"),
    limits: LIMITS,
    evaluate: ({ margin, subject, opponent }) =>
      margin > 0 && margin < 20
        ? facts(
            margin,
            { margin: String(margin) },
            [...subject.evidence, ...opponent.evidence].map((item) => item.id),
          )
        : null,
  }),

  define({
    id: "round_tie",
    slots: ["round"],
    polarity: "neutral",
    category: "overall",
    requiredSignals: [],
    minimumThreshold: 0,
    roastModes: ALL_MODES,
    maxRepetitions: 8,
    safety: "margin",
    themes: theme("balanced"),
    limits: LIMITS,
    evaluate: ({ margin, subject, opponent }) =>
      margin === 0
        ? facts(
            0,
            { margin: "0" },
            [...subject.evidence, ...opponent.evidence].map((item) => item.id),
          )
        : null,
  }),

  define({
    id: "photo_finish",
    slots: ["finisher", "summary"],
    polarity: "neutral",
    category: "overall",
    requiredSignals: [],
    minimumThreshold: 0,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "margin",
    themes: theme("balanced"),
    limits: LIMITS,
    evaluate: ({ margin, subject, opponent }) =>
      margin <= 2
        ? facts(
            2 - margin,
            {
              margin: String(margin),
              subjectScore: String(subject.overallScore),
              opponentScore: String(opponent.overallScore),
            },
            [...subject.evidence, ...opponent.evidence].map((item) => item.id),
          )
        : null,
  }),

  define({
    id: "verdict_margin",
    slots: ["finisher", "summary", "matchup"],
    polarity: "neutral",
    category: "overall",
    requiredSignals: [],
    minimumThreshold: 0,
    roastModes: ALL_MODES,
    maxRepetitions: 4,
    safety: "margin",
    themes: theme("balanced"),
    limits: LIMITS,
    // Always fires. It is the lowest-priority atom, so it only supplies a line when no
    // evidence-backed atom qualified — the documented fallback — and it carries the
    // aggregate scoreboard facts the battle-summary lines are written against.
    evaluate: ({ margin, subject, opponent }) =>
      facts(
        0,
        {
          margin: String(margin),
          subjectScore: String(subject.overallScore),
          opponentScore: String(opponent.overallScore),
          subjectGrade: subject.grade,
          opponentGrade: opponent.grade,
          subjectConfidence: String(subject.confidence.score),
          opponentConfidence: String(opponent.confidence.score),
          measuredWeight: String(subject.confidence.measuredWeight),
        },
        [...subject.evidence, ...opponent.evidence].map((item) => item.id),
      ),
  }),

  define({
    id: "nuclear_gap",
    slots: ["finisher", "summary"],
    polarity: "neutral",
    category: "overall",
    requiredSignals: [],
    minimumThreshold: 20,
    roastModes: ALL_MODES,
    maxRepetitions: 1,
    safety: "margin",
    themes: theme("balanced"),
    limits: LIMITS,
    evaluate: ({ margin, subject, opponent }) =>
      margin >= 20
        ? facts(
            margin,
            {
              margin: String(margin),
              subjectScore: String(subject.overallScore),
              opponentScore: String(opponent.overallScore),
            },
            [...subject.evidence, ...opponent.evidence].map((item) => item.id),
          )
        : null,
  }),
]);

export const ATOM_BY_ID: ReadonlyMap<string, MemeAtom> = new Map(
  MEME_ATOMS.map((atom) => [atom.id, atom]),
);

/**
 * The exact token set each atom supplies. A template may interpolate nothing else
 * (ADR 0005 D4), and two tests enforce both directions: every token in every template
 * appears here, and a firing atom produces exactly these keys.
 */
export const ATOM_TOKEN_NAMES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  tests_gap: ["subjectTests", "opponentTests", "subjectTestFiles"],
  verification_stack: ["subjectTests", "subjectWorkflow", "subjectCiCoverage"],
  ci_gap: ["subjectCi", "opponentCi"],
  tooling_without_output: ["opponentCi", "opponentSubstantial"],
  release_gap: ["subjectReleases"],
  release_density_gap: ["subjectReleaseCount", "subjectReleaseProjects", "subjectReleaseDensity"],
  ship_to_yap_gap: ["subjectReleaseCount", "opponentDocs"],
  recent_activity_gap: ["subjectDays", "opponentDays", "opponentMonths"],
  activity_without_shipping: ["opponentWeeks", "weekWindow", "opponentSubstantial"],
  abandoned_project_gap: ["opponentAbandoned", "opponentAbandonedCount", "subjectReleaseCount"],
  repo_graveyard_density: ["opponentAbandonedCount", "opponentGraveyardShare", "opponentArchived"],
  repo_count_without_substance: ["opponentRepos", "opponentSubstantial"],
  substance_ratio_gap: ["subjectSubstanceRatio", "opponentSubstanceRatio"],
  polyglot_with_depth: ["subjectLanguages", "opponentLanguages", "opponentPrimaryLanguage"],
  polyglot_without_depth: ["opponentLanguages", "opponentDeepLanguages", "opponentSustained"],
  impact_concentration: ["subjectSubstantial", "opponentSubstantial"],
  one_repo_final_boss: ["subjectSubstantial", "subjectDominantShare"],
  one_repo_carry: ["opponentDominantShare", "opponentSubstantial"],
  docs_without_shipping: ["opponentDocs"],
  high_fork_ratio: ["opponentForks", "opponentForkShare"],
  strong_maintenance: ["subjectMaintained", "subjectContinuity"],
  external_project_activity: ["subjectExternal", "opponentExternal", "subjectMergedPrs"],
  monorepo_operating_system: ["subjectOrganization", "subjectWorkspaces"],
  release_avoidance: ["opponentSubstantial"],
  high_tree_coverage: ["subjectInspected"],
  low_public_evidence: [
    "opponentConfidence",
    "opponentInspected",
    "opponentInspectable",
    "opponentEligible",
  ],
  public_evidence_diff: [
    "subjectConfidence",
    "opponentConfidence",
    "subjectInspected",
    "opponentInspected",
  ],
  confidence_mismatch: ["opponentScore", "opponentConfidence", "opponentInspected"],
  commit_manners_gap: ["opponentLowEffort", "opponentMessageLength"],
  commit_chaos: ["opponentLowEffort", "opponentReverts", "opponentMessageLength"],
  repair_loop_gap: ["opponentRepairs"],
  main_branch_behavior: ["subjectDays", "subjectLowEffort", "subjectRepairs"],
  sustained_work_gap: ["subjectSustained"],
  archive_discipline: ["subjectArchived", "subjectAbandoned"],
  structure_gap: ["subjectOrganization", "opponentOrganization"],
  grindset_gap: ["subjectWeeks", "opponentWeeks", "weekWindow"],
  identity_matchup: ["subjectMogsona", "opponentMogsona", "subjectAuraClass", "opponentAuraClass"],
  round_clear_win: ["margin"],
  round_close_win: ["margin"],
  round_tie: ["margin"],
  photo_finish: ["margin", "subjectScore", "opponentScore"],
  verdict_margin: [
    "margin",
    "subjectScore",
    "opponentScore",
    "subjectGrade",
    "opponentGrade",
    "subjectConfidence",
    "opponentConfidence",
    "measuredWeight",
  ],
  nuclear_gap: ["margin", "subjectScore", "opponentScore"],
});

/**
 * Ranking priority when several atoms qualify for one slot. Intensities are on
 * different scales and cannot be compared directly, so ordering is by priority first
 * and intensity only inside a priority band.
 */
const DEFAULT_PRIORITY = 50;

export const ATOM_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  low_public_evidence: 95,
  // Coverage is a caveat, not an achievement: it may only supply a line when no
  // engineering signal qualified.
  high_tree_coverage: 25,
  tests_gap: 70,
  release_gap: 68,
  ship_to_yap_gap: 69,
  ci_gap: 66,
  repo_graveyard_density: 65,
  abandoned_project_gap: 64,
  recent_activity_gap: 62,
  commit_chaos: 60,
  commit_manners_gap: 58,
  repair_loop_gap: 56,
  release_density_gap: 55,
  verification_stack: 54,
  activity_without_shipping: 53,
  tooling_without_output: 52,
  one_repo_carry: 51,
  main_branch_behavior: 49,
  substance_ratio_gap: 48,
  polyglot_without_depth: 47,
  confidence_mismatch: 44,
  public_evidence_diff: 42,
  nuclear_gap: 40,
  photo_finish: 35,
  identity_matchup: 30,
  round_clear_win: 20,
  round_close_win: 20,
  round_tie: 20,
  verdict_margin: 5,
});

export const atomPriority = (atomId: string): number => ATOM_PRIORITY[atomId] ?? DEFAULT_PRIORITY;

export function evaluateAtoms(
  context: AtomContext,
  roast: RoastMode,
): ReadonlyMap<string, AtomFacts> {
  const fired = new Map<string, AtomFacts>();
  for (const atom of MEME_ATOMS) {
    if (!atom.roastModes.includes(roast)) continue;
    const result = atom.evaluate(context);
    if (result !== null) fired.set(atom.id, result);
  }
  return fired;
}
