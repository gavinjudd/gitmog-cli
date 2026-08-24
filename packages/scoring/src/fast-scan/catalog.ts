import type { Dimension } from "./types.js";

/** Fast-scan scoring version. A stored result produced by any other version is not
 * comparable to one produced by this version. See ADR 0004. */
export const FAST_SCAN_SCORING_VERSION = "0.1.0-fast-scan";

export const SCAN_TYPE = "fast" as const;

export interface CategoryDefinition {
  readonly id: string;
  readonly dimension: Dimension;
  /** The section of SCORECARD.md this transcribes, verbatim. */
  readonly scorecardSection: string;
  readonly memeLabel: string;
  /** Shown under the meme label on every render, so the joke never hides the
   * measurement. */
  readonly subtitle: string;
  readonly weight: number;
  readonly displayOrder: number;
}

export const CATEGORY_DEFINITIONS: readonly CategoryDefinition[] = Object.freeze([
  {
    id: "craft.testing",
    dimension: "craft",
    scorecardSection: "CRAFT B — Testing",
    // Not CODE AURA: this category measures test evidence, and a fast scan explicitly
    // cannot review source (ADR 0010 D4).
    memeLabel: "TEST AURA",
    subtitle: "Tests, test breadth, tests wired into CI",
    weight: 10,
    displayOrder: 1,
  },
  {
    id: "ship.frequency",
    dimension: "ship",
    scorecardSection: "SHIP A — Development Frequency",
    memeLabel: "GRINDSET",
    subtitle: "Active weeks, recency, public development cadence",
    weight: 18,
    displayOrder: 2,
  },
  {
    id: "craft.tooling",
    dimension: "craft",
    scorecardSection: "CRAFT D — Engineering Tooling",
    memeLabel: "SHIP DISCIPLINE",
    subtitle: "CI, linting, typing, reproducible builds",
    weight: 6,
    displayOrder: 3,
  },
  {
    id: "craft.hygiene",
    dimension: "craft",
    scorecardSection: "CRAFT E — Repository Hygiene",
    // Not SQUAD VALUE: this category measures repository hygiene, not collaboration.
    memeLabel: "REPO ETIQUETTE",
    subtitle: "Docs, licence, dependency and release hygiene",
    weight: 6,
    displayOrder: 4,
  },
  {
    id: "ship.breadth",
    dimension: "ship",
    scorecardSection: "SHIP D — Shipping Breadth & External Work",
    memeLabel: "OSS CLOUT",
    subtitle: "External contributions, releases, repository continuity — not stars",
    weight: 8,
    displayOrder: 5,
  },
  {
    id: "ship.substance",
    dimension: "ship",
    scorecardSection: "SHIP B — Output Substance",
    memeLabel: "SHIP AURA",
    subtitle: "Substantial projects and sustained work",
    weight: 12,
    displayOrder: 6,
  },
  {
    id: "ship.discipline",
    dimension: "ship",
    scorecardSection: "SHIP C — Commit Discipline",
    memeLabel: "COMMIT MANNERS",
    subtitle: "Commit messages, repair loops, revert noise",
    weight: 12,
    displayOrder: 7,
  },
  {
    id: "craft.maintainability",
    dimension: "craft",
    scorecardSection: "CRAFT C — Static Maintainability",
    memeLabel: "STRUCTURE AURA",
    subtitle: "File-size pathologies visible in the repository tree",
    weight: 8,
    displayOrder: 8,
  },
  {
    id: "craft.quality",
    dimension: "craft",
    scorecardSection: "CRAFT A — Code Quality Judge",
    memeLabel: "SOURCE REVIEW",
    subtitle: "Source style has a separate versioned contract.",
    weight: 20,
    displayOrder: 9,
  },
]);

export const CATEGORY_BY_ID: ReadonlyMap<string, CategoryDefinition> = new Map(
  CATEGORY_DEFINITIONS.map((category) => [category.id, category]),
);

export interface MetricDefinition {
  readonly id: string;
  readonly category: string;
  readonly label: string;
  readonly weight: number;
}

/** Weights are transcribed from SCORECARD.md and must continue to sum to 100. A test
 * asserts both that total and each section's subtotal. */
export const METRIC_DEFINITIONS: readonly MetricDefinition[] = Object.freeze([
  {
    id: "ship.frequency.commits",
    category: "ship.frequency",
    label: "Qualifying commits",
    weight: 10,
  },
  {
    id: "ship.frequency.activeWeeks",
    category: "ship.frequency",
    label: "Active weeks",
    weight: 5,
  },
  { id: "ship.frequency.recency", category: "ship.frequency", label: "Recency", weight: 3 },
  {
    id: "ship.substance.changeVolume",
    category: "ship.substance",
    label: "Meaningful change volume",
    weight: 5,
  },
  {
    id: "ship.substance.substantialProjects",
    category: "ship.substance",
    label: "Substantial projects",
    weight: 4,
  },
  {
    id: "ship.substance.sustainedWork",
    category: "ship.substance",
    label: "Sustained project work",
    weight: 3,
  },
  { id: "ship.discipline.sizing", category: "ship.discipline", label: "Commit sizing", weight: 4 },
  {
    id: "ship.discipline.coherence",
    category: "ship.discipline",
    label: "Commit coherence",
    weight: 3,
  },
  {
    id: "ship.discipline.messages",
    category: "ship.discipline",
    label: "Commit message hygiene",
    weight: 2,
  },
  {
    id: "ship.discipline.repairLoops",
    category: "ship.discipline",
    label: "Repair loops",
    weight: 2,
  },
  {
    id: "ship.discipline.mergeHygiene",
    category: "ship.discipline",
    label: "Merge and revert hygiene",
    weight: 1,
  },
  {
    id: "ship.breadth.external",
    category: "ship.breadth",
    label: "Work outside owned repositories",
    weight: 4,
  },
  {
    id: "ship.breadth.released",
    category: "ship.breadth",
    label: "Completed and released work",
    weight: 2,
  },
  {
    id: "ship.breadth.continuity",
    category: "ship.breadth",
    label: "Repository continuity",
    weight: 2,
  },
  { id: "craft.quality.judge", category: "craft.quality", label: "Code quality judge", weight: 20 },
  {
    id: "craft.testing.exists",
    category: "craft.testing",
    label: "Tests exist and are meaningful",
    weight: 4,
  },
  { id: "craft.testing.breadth", category: "craft.testing", label: "Test breadth", weight: 2 },
  { id: "craft.testing.quality", category: "craft.testing", label: "Test quality", weight: 2 },
  {
    id: "craft.testing.workflow",
    category: "craft.testing",
    label: "Tests integrated into workflow",
    weight: 2,
  },
  {
    id: "craft.maintainability.complexity",
    category: "craft.maintainability",
    label: "Complexity",
    weight: 3,
  },
  {
    id: "craft.maintainability.duplication",
    category: "craft.maintainability",
    label: "Duplication",
    weight: 2,
  },
  {
    id: "craft.maintainability.fileSize",
    category: "craft.maintainability",
    label: "File-size pathologies",
    weight: 1,
  },
  {
    id: "craft.maintainability.deadCode",
    category: "craft.maintainability",
    label: "Dead and unreachable patterns",
    weight: 1,
  },
  {
    id: "craft.maintainability.coupling",
    category: "craft.maintainability",
    label: "Dependency and coupling indicators",
    weight: 1,
  },
  { id: "craft.tooling.ci", category: "craft.tooling", label: "Continuous integration", weight: 2 },
  {
    id: "craft.tooling.lint",
    category: "craft.tooling",
    label: "Linting and formatting",
    weight: 1,
  },
  {
    id: "craft.tooling.typing",
    category: "craft.tooling",
    label: "Type and static checking",
    weight: 1,
  },
  {
    id: "craft.tooling.build",
    category: "craft.tooling",
    label: "Reproducible build configuration",
    weight: 1,
  },
  {
    id: "craft.tooling.automation",
    category: "craft.tooling",
    label: "Project automation",
    weight: 1,
  },
  {
    id: "craft.hygiene.organization",
    category: "craft.hygiene",
    label: "Repository organisation",
    weight: 2,
  },
  {
    id: "craft.hygiene.documentation",
    category: "craft.hygiene",
    label: "Documentation",
    weight: 1,
  },
  {
    id: "craft.hygiene.dependencies",
    category: "craft.hygiene",
    label: "Dependency hygiene",
    weight: 1,
  },
  { id: "craft.hygiene.releases", category: "craft.hygiene", label: "Release hygiene", weight: 1 },
  {
    id: "craft.hygiene.abandonment",
    category: "craft.hygiene",
    label: "Abandonment behaviour",
    weight: 1,
  },
]);

export const METRIC_BY_ID: ReadonlyMap<string, MetricDefinition> = new Map(
  METRIC_DEFINITIONS.map((metric) => [metric.id, metric]),
);

/**
 * Metrics a fast scan structurally cannot measure. Each one leaves the scoring basis
 * entirely (ADR 0004 D1) and is displayed with this reason attached, so the product
 * never implies the profile scored zero on it.
 */
export const UNMEASURABLE_IN_FAST_SCAN: Readonly<Record<string, string>> = Object.freeze({
  "ship.substance.changeVolume": "This public score does not collect per-commit line counts.",
  "ship.discipline.sizing": "This public score does not collect per-commit diff sizes.",
  "ship.discipline.coherence": "This public score does not collect the file set of each commit.",
  "craft.quality.judge": "Source style remains separate from this numeric score version.",
  "craft.testing.quality": "Test contents are outside this numeric score version.",
  "craft.maintainability.complexity": "Source complexity is outside this numeric score version.",
  "craft.maintainability.duplication": "Source duplication is outside this numeric score version.",
  "craft.maintainability.deadCode": "Dead-code analysis is outside this numeric score version.",
  "craft.maintainability.coupling": "Needs parsed manifests, not just the presence of one.",
});

/** SCORECARD.md "Overall grades". */
const GRADE_TABLE: readonly (readonly [minimum: number, grade: string])[] = Object.freeze([
  [95, "S+"],
  [90, "S"],
  [85, "A+"],
  [80, "A"],
  [75, "A−"],
  [70, "B+"],
  [65, "B"],
  [60, "B−"],
  [50, "C"],
  [40, "D"],
]);

export function gradeForScore(score: number): string {
  for (const [minimum, grade] of GRADE_TABLE) {
    if (score >= minimum) return grade;
  }
  return "F";
}
