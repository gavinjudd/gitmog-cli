import type { MergedSourceFeatures } from "@gitmog/analyzers";

import type { CodeAxes, CodeAxisId, CodeDnaLabel, SourceStyleFeatureId } from "./types.js";

/**
 * Code DNA labels.
 *
 * **Local code derives the label.** That
 * is what stops a label being talked into existing, and it is why each entry declares the
 * deterministic source features that make its name honest — `TYPE INQUISITOR` needs real
 * type markers, not merely a high ritual score.
 *
 * There is no rarity. Code DNA is a style reading, and there is nothing to be rare
 * against.
 */

export interface CodeDnaDefinition extends Omit<
  CodeDnaLabel,
  "axisEngineVersion" | "confidence" | "featureIds" | "sampleIds"
> {
  /** Target position on each axis, 0–100. Distance to this point ranks the label. */
  readonly centroid: {
    readonly directAbstract: number;
    readonly vibeRitual: number;
    readonly compactCeremonial: number;
    readonly applicationSystems: number;
  };
  /** Deterministic feature requirement. Returns false and the label is ineligible. */
  readonly requiresFeatures: (features: MergedSourceFeatures) => boolean;
  /** Each group is OR; all groups are AND. These are measured feature ids, never prose tags. */
  readonly requiredFeatureGroups: readonly (readonly SourceStyleFeatureId[])[];
  /** Hard semantic compatibility. A centroid may rank only after every gate passes. */
  readonly axisGates: readonly {
    readonly axis: CodeAxisId;
    readonly minimum?: number | undefined;
    readonly maximum?: number | undefined;
    readonly reason: string;
  }[];
  readonly blocks: (features: MergedSourceFeatures, axes: CodeAxes) => boolean;
  /** Inspectable descriptions paired with the executable blocking predicate. */
  readonly blockingConditions: readonly string[];
  readonly minimumConfidence: number;
  readonly hybrid?: boolean | undefined;
}

const definition = (entry: CodeDnaDefinition): CodeDnaDefinition => entry;

/** Rate per hundred non-blank lines, so a long file does not qualify on length alone. */
const per100 = (count: number, features: MergedSourceFeatures): number =>
  features.nonBlankLines === 0 ? 0 : (count / features.nonBlankLines) * 100;

const never = (): boolean => false;

export const CODE_DNA_DEFINITIONS: readonly CodeDnaDefinition[] = Object.freeze([
  definition({
    id: "straight-shooter",
    name: "STRAIGHT SHOOTER",
    centroid: { directAbstract: 18, vibeRitual: 45, compactCeremonial: 30, applicationSystems: 35 },
    requiresFeatures: (f) => f.functionCount >= 3 && per100(f.factoryMarkers, f) < 3,
    requiredFeatureGroups: [["compact-control-flow", "thin-wrapper"]],
    axisGates: [
      {
        axis: "directAbstract",
        maximum: 42,
        reason: "STRAIGHT SHOOTER requires a meaningfully Direct reading",
      },
      {
        axis: "compactCeremonial",
        maximum: 55,
        reason: "STRAIGHT SHOOTER cannot be strongly Ceremonial",
      },
    ],
    blocks: (f) => f.maximumNestingDepth > 9,
    blockingConditions: ["maximum nesting depth above 9"],
    minimumConfidence: 45,
    copy: {
      clean: "Direct, compact code that says what it does.",
      spicy: "No ceremony. No cathedral. Just the function.",
      unhinged: "Writes the code and leaves. No layers, no apology.",
    },
  }),

  definition({
    id: "guardrail-goblin",
    name: "GUARDRAIL GOBLIN",
    centroid: { directAbstract: 32, vibeRitual: 84, compactCeremonial: 45, applicationSystems: 35 },
    requiresFeatures: (f) => per100(f.guardMarkers + f.errorHandlingMarkers, f) >= 3,
    requiredFeatureGroups: [["guard-heavy", "explicit-validation", "error-boundary"]],
    axisGates: [
      {
        axis: "vibeRitual",
        minimum: 65,
        reason: "GUARDRAIL GOBLIN requires a meaningfully Ritual reading",
      },
    ],
    blocks: never,
    blockingConditions: [],
    minimumConfidence: 45,
    copy: {
      clean: "Explicit checks and early returns throughout.",
      spicy: "Every input is treated as hostile until proven otherwise.",
      unhinged: "Guards on the guards. Nothing gets in without paperwork.",
    },
  }),

  definition({
    id: "vibe-merchant",
    name: "VIBE MERCHANT",
    centroid: { directAbstract: 30, vibeRitual: 14, compactCeremonial: 26, applicationSystems: 30 },
    requiresFeatures: (f) => per100(f.guardMarkers + f.validationMarkers, f) < 2,
    requiredFeatureGroups: [["implicit-assumptions"], ["compact-control-flow", "thin-wrapper"]],
    axisGates: [
      {
        axis: "vibeRitual",
        maximum: 38,
        reason: "VIBE MERCHANT requires a meaningfully Vibe reading",
      },
      {
        axis: "compactCeremonial",
        maximum: 58,
        reason: "VIBE MERCHANT cannot be strongly Ceremonial",
      },
    ],
    blocks: (f) => per100(f.typeAnnotationCount, f) > 12,
    blockingConditions: ["type-annotation rate above 12 per 100 lines"],
    minimumConfidence: 45,
    copy: {
      clean: "Leans on implicit assumptions rather than explicit contracts.",
      spicy: "Runs on trust. The happy path is the only path.",
      unhinged: "Zero guards. Ships on instinct and a good feeling.",
    },
  }),

  definition({
    id: "abstraction-astronaut",
    name: "ABSTRACTION ASTRONAUT",
    centroid: { directAbstract: 88, vibeRitual: 60, compactCeremonial: 80, applicationSystems: 40 },
    // Needs abstraction *and* ceremony. A merely large file is not this.
    requiresFeatures: (f) =>
      per100(f.genericMarkers + f.factoryMarkers, f) >= 4 && f.classOrTypeCount >= 4,
    requiredFeatureGroups: [
      ["layered-abstraction"],
      ["generic-framework", "ceremonial-boilerplate"],
    ],
    axisGates: [
      {
        axis: "directAbstract",
        minimum: 72,
        reason: "ABSTRACTION ASTRONAUT requires a strongly Abstract reading",
      },
      {
        axis: "compactCeremonial",
        minimum: 65,
        reason: "ABSTRACTION ASTRONAUT requires a strongly Ceremonial reading",
      },
    ],
    blocks: (f) => f.functionCount < 3,
    blockingConditions: ["fewer than three measured functions"],
    minimumConfidence: 50,
    copy: {
      clean: "Heavy layering and generalisation across the sampled code.",
      spicy: "Four layers of indirection before anything happens.",
      unhinged: "Abstracted so far up that the runway is no longer visible.",
    },
  }),

  definition({
    id: "framework-priest",
    name: "FRAMEWORK PRIEST",
    centroid: { directAbstract: 74, vibeRitual: 72, compactCeremonial: 82, applicationSystems: 34 },
    requiresFeatures: (f) => per100(f.factoryMarkers, f) >= 3 && f.importCount >= 6,
    requiredFeatureGroups: [
      ["generic-framework"],
      ["ceremonial-boilerplate", "layered-abstraction"],
    ],
    axisGates: [
      {
        axis: "directAbstract",
        minimum: 62,
        reason: "FRAMEWORK PRIEST requires a meaningfully Abstract reading",
      },
      {
        axis: "vibeRitual",
        minimum: 50,
        reason: "FRAMEWORK PRIEST requires explicit framework Ritual",
      },
      {
        axis: "compactCeremonial",
        minimum: 68,
        reason: "FRAMEWORK PRIEST requires a strongly Ceremonial reading",
      },
    ],
    blocks: never,
    blockingConditions: [],
    minimumConfidence: 50,
    copy: {
      clean: "Framework conventions carry most of the structure.",
      spicy: "Builds the framework, then builds inside it.",
      unhinged: "Every problem gets a provider, a registry and a lifecycle hook.",
    },
  }),

  definition({
    id: "systems-maxxer",
    name: "SYSTEMS MAXXER",
    centroid: { directAbstract: 30, vibeRitual: 62, compactCeremonial: 40, applicationSystems: 88 },
    requiresFeatures: (f) => per100(f.protocolMarkers, f) >= 2,
    requiredFeatureGroups: [["systems-primitives", "protocol-handling"]],
    axisGates: [
      {
        axis: "applicationSystems",
        minimum: 70,
        reason: "SYSTEMS MAXXER requires a meaningfully Systems reading",
      },
    ],
    blocks: never,
    blockingConditions: [],
    minimumConfidence: 50,
    copy: {
      clean: "Works close to protocols, buffers and low-level primitives.",
      spicy: "Counts bytes on purpose. Enjoys it.",
      unhinged: "Down where the allocator lives. Voluntarily.",
    },
  }),

  definition({
    id: "api-plumber",
    name: "API PLUMBER",
    centroid: { directAbstract: 42, vibeRitual: 55, compactCeremonial: 52, applicationSystems: 22 },
    requiresFeatures: (f) => f.importCount >= 4 && per100(f.asyncMarkers, f) >= 2,
    requiredFeatureGroups: [
      ["application-orchestration", "stateful-orchestration"],
      ["error-boundary", "explicit-validation", "guard-heavy"],
    ],
    axisGates: [
      {
        axis: "applicationSystems",
        maximum: 40,
        reason: "API PLUMBER requires Application and integration evidence",
      },
    ],
    blocks: (f) => per100(f.protocolMarkers, f) >= 4,
    blockingConditions: ["protocol-marker rate at or above 4 per 100 lines"],
    minimumConfidence: 45,
    copy: {
      clean: "Connects services and moves data between them.",
      spicy: "Wires one system to another and keeps the pipes clean.",
      unhinged: "The whole product is joints and sealant, and it holds.",
    },
  }),

  definition({
    id: "type-inquisitor",
    name: "TYPE INQUISITOR",
    centroid: { directAbstract: 62, vibeRitual: 90, compactCeremonial: 58, applicationSystems: 40 },
    // Ritual alone is not enough: this needs real type or contract markers.
    requiresFeatures: (f) =>
      (f.typeAnnotationCount >= 6 && f.classOrTypeCount >= 2) ||
      (f.classOrTypeCount >= 5 && f.genericMarkers >= 3),
    requiredFeatureGroups: [["typed-contracts"], ["explicit-validation", "guard-heavy"]],
    axisGates: [
      {
        axis: "vibeRitual",
        minimum: 70,
        reason: "TYPE INQUISITOR requires a strongly Ritual contract reading",
      },
    ],
    blocks: never,
    blockingConditions: [],
    minimumConfidence: 50,
    copy: {
      clean: "Types and contracts stated explicitly at every boundary.",
      spicy: "The compiler is a colleague and it is not a nice one.",
      unhinged: "Nothing crosses a boundary without producing documentation.",
    },
  }),

  definition({
    id: "minimalist",
    name: "MINIMALIST",
    centroid: { directAbstract: 22, vibeRitual: 40, compactCeremonial: 8, applicationSystems: 40 },
    requiresFeatures: (f) =>
      f.functionCount >= 2 && f.averageLineLength <= 60 && per100(f.factoryMarkers, f) < 2,
    requiredFeatureGroups: [["compact-control-flow"], ["thin-wrapper"]],
    axisGates: [
      {
        axis: "compactCeremonial",
        maximum: 30,
        reason: "MINIMALIST requires a meaningfully Compact reading",
      },
      {
        axis: "directAbstract",
        maximum: 60,
        reason: "MINIMALIST cannot be strongly Abstract",
      },
    ],
    blocks: (f) => f.maximumNestingDepth > 8,
    blockingConditions: ["maximum nesting depth above 8"],
    minimumConfidence: 45,
    copy: {
      clean: "Short files, short functions, very little scaffolding.",
      spicy: "Deletes more than most people write.",
      unhinged: "The whole module fits on one screen and still does the job.",
    },
  }),

  definition({
    id: "layer-cake",
    name: "LAYER CAKE",
    centroid: { directAbstract: 80, vibeRitual: 68, compactCeremonial: 66, applicationSystems: 42 },
    requiresFeatures: (f) => f.maximumNestingDepth >= 7 || f.classOrTypeCount >= 6,
    requiredFeatureGroups: [
      ["layered-abstraction"],
      ["stateful-orchestration", "generic-framework"],
    ],
    axisGates: [
      {
        axis: "directAbstract",
        minimum: 68,
        reason: "LAYER CAKE requires a meaningfully Abstract reading",
      },
      {
        axis: "compactCeremonial",
        minimum: 58,
        reason: "LAYER CAKE requires a meaningfully Ceremonial reading",
      },
    ],
    blocks: never,
    blockingConditions: [],
    minimumConfidence: 45,
    copy: {
      clean: "Deep composition, with behaviour spread across layers.",
      spicy: "Follow the call stack and pack a lunch.",
      unhinged: "Layers all the way down, and every one of them is load-bearing.",
    },
  }),

  definition({
    id: "data-shaman",
    name: "DATA SHAMAN",
    centroid: { directAbstract: 28, vibeRitual: 50, compactCeremonial: 28, applicationSystems: 58 },
    requiresFeatures: (f) => per100(f.dataLibraryMarkers, f) >= 2,
    requiredFeatureGroups: [["data-pipeline"]],
    axisGates: [
      {
        axis: "applicationSystems",
        minimum: 45,
        reason: "DATA SHAMAN requires visible data-processing depth",
      },
    ],
    blocks: never,
    blockingConditions: [],
    minimumConfidence: 45,
    copy: {
      clean: "Numerical and data-pipeline work dominates the sample.",
      spicy: "Transforms one shape of data into another, repeatedly, on purpose.",
      unhinged: "Speaks fluent dataframe. The columns obey.",
    },
  }),

  definition({
    id: "leetcode-monk",
    name: "LEETCODE MONK",
    centroid: { directAbstract: 34, vibeRitual: 34, compactCeremonial: 20, applicationSystems: 76 },
    requiresFeatures: (f) => per100(f.algorithmMarkers, f) >= 2,
    requiredFeatureGroups: [["algorithmic-core"], ["compact-control-flow"]],
    axisGates: [
      {
        axis: "applicationSystems",
        minimum: 60,
        reason: "LEETCODE MONK requires an algorithmic Systems-side reading",
      },
      {
        axis: "compactCeremonial",
        maximum: 45,
        reason: "LEETCODE MONK requires a compact algorithmic core",
      },
    ],
    // Weak orchestration evidence is part of the definition, not a nice-to-have.
    blocks: (f) => per100(f.asyncMarkers, f) >= 3 || f.importCount >= 8,
    blockingConditions: [
      "async-marker rate at or above 3 per 100 lines",
      "eight or more imports in the bounded sample",
    ],
    minimumConfidence: 50,
    copy: {
      clean: "Algorithmic core with very little surrounding plumbing.",
      spicy: "Solves the problem. Declines to build the product around it.",
      unhinged: "Pure algorithm. No framework. No mercy.",
    },
  }),

  definition({
    id: "code-chimera",
    name: "CODE CHIMERA",
    centroid: { directAbstract: 50, vibeRitual: 50, compactCeremonial: 50, applicationSystems: 50 },
    requiresFeatures: () => true,
    requiredFeatureGroups: [
      [
        "thin-wrapper",
        "layered-abstraction",
        "generic-framework",
        "compact-control-flow",
        "ceremonial-boilerplate",
      ],
      [
        "explicit-validation",
        "typed-contracts",
        "guard-heavy",
        "implicit-assumptions",
        "error-boundary",
      ],
      [
        "application-orchestration",
        "protocol-handling",
        "systems-primitives",
        "algorithmic-core",
        "data-pipeline",
      ],
    ],
    axisGates: [
      {
        axis: "directAbstract",
        minimum: 20,
        maximum: 80,
        reason: "CODE CHIMERA requires a non-extreme Direct/Abstract blend",
      },
      {
        axis: "vibeRitual",
        minimum: 20,
        maximum: 85,
        reason: "CODE CHIMERA requires a non-extreme Vibe/Ritual blend",
      },
      {
        axis: "compactCeremonial",
        minimum: 20,
        maximum: 80,
        reason: "CODE CHIMERA requires a non-extreme Compact/Ceremonial blend",
      },
      {
        axis: "applicationSystems",
        minimum: 20,
        maximum: 80,
        reason: "CODE CHIMERA requires a non-extreme Application/Systems blend",
      },
    ],
    blocks: never,
    blockingConditions: [
      "fewer than two repositories",
      "fewer than three strong feature families",
      "a specialist identity clearly wins",
      "any axis confidence below 65",
    ],
    minimumConfidence: 65,
    hybrid: true,
    copy: {
      clean:
        "A high-confidence blend of several measured styles, with no single specialist dominating.",
      spicy: "Three code instincts in one trench coat, and every one brought receipts.",
      unhinged: "The style scanner found several creatures and they are cooperating somehow.",
    },
  }),
]);

export const CODE_DNA_BY_ID: ReadonlyMap<string, CodeDnaDefinition> = new Map(
  CODE_DNA_DEFINITIONS.map((entry) => [entry.id, entry]),
);

export const CODE_DNA_IDS: readonly string[] = Object.freeze(
  CODE_DNA_DEFINITIONS.map((entry) => entry.id),
);
