import { describe, expect, it } from "vitest";

import {
  CATEGORY_DEFINITIONS,
  FAST_SCAN_SCORING_VERSION,
  METRIC_DEFINITIONS,
  UNMEASURABLE_IN_FAST_SCAN,
  gradeForScore,
} from "../src/fast-scan/catalog.js";
import { FAST_SCAN_CONFIDENCE_CAP, MAXIMUM_FAST_SCAN_BASIS } from "../src/fast-scan/confidence.js";
import { scoreProfileFastScan } from "../src/fast-scan/scorecard.js";
import { PERSONAS, scorecardFor, snapshotFor } from "./helpers.js";

describe("fast-scan catalog", () => {
  it("transcribes SCORECARD.md: metric weights sum to 100", () => {
    const total = METRIC_DEFINITIONS.reduce((sum, metric) => sum + metric.weight, 0);
    expect(total).toBe(100);
  });

  it("keeps SHIP at 50 and CRAFT at 50", () => {
    const dimension = (prefix: string) =>
      METRIC_DEFINITIONS.filter((metric) => metric.id.startsWith(prefix)).reduce(
        (sum, metric) => sum + metric.weight,
        0,
      );
    expect(dimension("ship.")).toBe(50);
    expect(dimension("craft.")).toBe(50);
  });

  it("gives every category the weight of the metrics inside it", () => {
    for (const category of CATEGORY_DEFINITIONS) {
      const owned = METRIC_DEFINITIONS.filter((metric) => metric.category === category.id).reduce(
        (sum, metric) => sum + metric.weight,
        0,
      );
      expect(owned, category.id).toBe(category.weight);
    }
  });

  it("excludes exactly the weight ADR 0004 says it excludes", () => {
    const excluded = Object.keys(UNMEASURABLE_IN_FAST_SCAN).reduce((sum, id) => {
      const metric = METRIC_DEFINITIONS.find((candidate) => candidate.id === id);
      expect(metric, id).toBeDefined();
      return sum + (metric?.weight ?? 0);
    }, 0);
    expect(excluded).toBe(100 - MAXIMUM_FAST_SCAN_BASIS);
  });

  it("gives every category a meme label and a literal subtitle", () => {
    for (const category of CATEGORY_DEFINITIONS) {
      expect(category.memeLabel, category.id).toMatch(/^[A-Z ]+$/);
      expect(category.subtitle.length, category.id).toBeGreaterThan(20);
      expect(category.scorecardSection, category.id).toMatch(/^(SHIP|CRAFT) [A-E] —/);
    }
  });

  it("applies the SCORECARD.md grade table", () => {
    expect(gradeForScore(100)).toBe("S+");
    expect(gradeForScore(90)).toBe("S");
    expect(gradeForScore(75)).toBe("A−");
    expect(gradeForScore(60)).toBe("B−");
    expect(gradeForScore(39)).toBe("F");
  });
});

describe("scoreProfileFastScan", () => {
  it("is deterministic for a fixed snapshot", async () => {
    const snapshot = await snapshotFor(PERSONAS.strongMaintainer);
    const first = scoreProfileFastScan(snapshot);
    const second = scoreProfileFastScan(snapshot);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.scoringVersion).toBe(FAST_SCAN_SCORING_VERSION);
    expect(first.scanType).toBe("fast");
  });

  it("never assigns zero to an unmeasurable metric, it removes it from the basis", async () => {
    const card = await scorecardFor("strongMaintainer");
    for (const id of Object.keys(UNMEASURABLE_IN_FAST_SCAN)) {
      const metric = card.metrics.find((candidate) => candidate.id === id);
      expect(metric?.availability, id).toBe("unavailable");
      expect(metric?.earned, id).toBe(0);
    }
    const basis = card.metrics
      .filter((metric) => metric.availability !== "unavailable")
      .reduce((sum, metric) => sum + metric.weight, 0);
    expect(card.confidence.measuredWeight).toBe(basis);
    expect(basis).toBeLessThanOrEqual(MAXIMUM_FAST_SCAN_BASIS);
    expect(basis).toBeGreaterThan(0);
  });

  it("scores a strong maintainer above a high-activity low-substance profile", async () => {
    const strong = await scorecardFor("strongMaintainer");
    const grinder = await scorecardFor("highActivityLowImpact");
    expect(strong.overallScore).toBeGreaterThan(grinder.overallScore);
  });

  it("does not treat an eleven-year-old two-file repository as substantial", async () => {
    const card = await scorecardFor("lowPublicEvidence");
    expect(card.diagnostics.substantialRepositories).toBe(0);
  });

  it("treats archived repositories as finished, never abandoned", async () => {
    const card = await scorecardFor("archivedPortfolio");
    expect(card.diagnostics.archivedRepositories).toBeGreaterThanOrEqual(3);
    expect(card.diagnostics.abandonedSubstantialRepositories).toBe(0);
    const abandonment = card.metrics.find((metric) => metric.id === "craft.hygiene.abandonment");
    expect(abandonment?.ratio).toBe(1);
  });

  it("lowers coverage for unsupported languages without applying a penalty", async () => {
    const card = await scorecardFor("unsupportedLanguages");
    expect(card.diagnostics.unsupportedLanguages.length).toBeGreaterThan(0);
    expect(card.confidence.limitations.join(" ")).toContain("Unsupported languages seen");
    expect(card.confidence.limitations.join(" ")).toContain("no penalty is applied");
    // No metric may be zeroed because a language is unsupported.
    const testing = card.metrics.find((metric) => metric.id === "craft.testing.exists");
    expect(testing?.availability).toBe("available");
    expect(testing?.ratio).toBeGreaterThan(0);
  });

  it("excludes a type checker from the basis when the language does not use one", async () => {
    const card = await scorecardFor("unsupportedLanguages");
    const typing = card.metrics.find((metric) => metric.id === "craft.tooling.typing");
    expect(typing?.availability).toBe("unavailable");
    expect(typing?.limitation).toContain("gradually typed");
  });

  it("caps fast-scan confidence and reports thin evidence honestly", async () => {
    const strong = await scorecardFor("strongMaintainer");
    const ghost = await scorecardFor("lowPublicEvidence");
    expect(strong.confidence.score).toBeLessThanOrEqual(FAST_SCAN_CONFIDENCE_CAP);
    expect(strong.confidence.grade).not.toBe("high");
    expect(ghost.confidence.score).toBeLessThan(strong.confidence.score);
    expect(ghost.confidence.limitations.length).toBeGreaterThan(0);
  });

  it("never reports more active weeks than the stated observation window", async () => {
    const card = await scorecardFor("sustainedGrinder");
    expect(card.diagnostics.activeWeeksObserved).toBeLessThanOrEqual(
      card.diagnostics.activeWeeksWindow,
    );
  });

  it("degrades coverage when a repository tree cannot be read", async () => {
    const card = await scorecardFor("partialTreeFailure");
    expect(card.confidence.treeCoverage).toBeLessThan(1);
    expect(card.confidence.analyzedRepositories).toBeLessThan(card.confidence.eligibleRepositories);
  });

  it("links every metric that scored to at least one evidence item", async () => {
    const card = await scorecardFor("strongMaintainer");
    const evidenceIds = new Set(card.evidence.map((item) => item.id));
    for (const metric of card.metrics.filter((entry) => entry.availability !== "unavailable")) {
      expect(metric.evidenceIds.length, metric.id).toBeGreaterThan(0);
      for (const id of metric.evidenceIds) expect(evidenceIds.has(id), id).toBe(true);
    }
  });

  it("gives every evidence item a GitHub source link", async () => {
    const card = await scorecardFor("strongMaintainer");
    expect(card.evidence.length).toBeGreaterThan(10);
    for (const item of card.evidence) {
      expect(item.sourceUrl, item.id).toMatch(/^https:\/\/github\.com\//);
      expect(item.title.length, item.id).toBeGreaterThan(5);
    }
  });

  it("ignores stars entirely: popularity cannot move the score", async () => {
    const snapshot = await snapshotFor(PERSONAS.strongMaintainer);
    const inflated = {
      ...snapshot,
      repositories: snapshot.repositories.map((repository) => ({
        ...repository,
        stars: repository.stars + 250_000,
        forks: repository.forks + 90_000,
      })),
    };
    expect(scoreProfileFastScan(inflated).overallScore).toBe(
      scoreProfileFastScan(snapshot).overallScore,
    );
  });
});
