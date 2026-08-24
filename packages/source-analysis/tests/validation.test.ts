import { describe, expect, it } from "vitest";

import { validateBattleRead, type ClaimEvidenceIndex } from "../src/validation.js";

const index: ClaimEvidenceIndex = {
  leftEvidenceIds: new Set(["shared", "left-release"]),
  rightEvidenceIds: new Set(["shared", "right-tests"]),
  leftSampleIds: new Set(["sample-left"]),
  rightSampleIds: new Set(["sample-right"]),
  leftHandle: "alice",
  rightHandle: "bob",
  roast: "spicy",
};

const valid = () => ({
  matchupThesis: {
    text: "Release discipline meets a test-heavy source style in this matchup.",
    primaryEvidenceId: "left-release",
    evidenceIds: ["left-release", "right-tests"],
    sampleIds: ["sample-left", "sample-right"],
    target: "matchup",
    slot: "matchup-thesis",
  },
  leftRead: {
    text: "@alice pairs public release hygiene with compact implementation samples.",
    primaryEvidenceId: "left-release",
    evidenceIds: ["left-release"],
    sampleIds: ["sample-left"],
    target: "left",
    slot: "left-read",
  },
  rightRead: {
    text: "@bob backs the public test signal with explicit source contracts.",
    primaryEvidenceId: "right-tests",
    evidenceIds: ["right-tests"],
    sampleIds: ["sample-right"],
    target: "right",
    slot: "right-read",
  },
  finisher: {
    text: "One ships the tags; the other makes every branch bring paperwork.",
    primaryEvidenceId: "left-release",
    evidenceIds: ["left-release", "right-tests"],
    sampleIds: ["sample-left", "sample-right"],
    target: "matchup",
    slot: "finisher",
  },
  alternates: [
    {
      text: "The release log brought dates; the source sample brought guardrails.",
      primaryEvidenceId: "shared",
      evidenceIds: ["shared"],
      sampleIds: [],
      target: "matchup",
      slot: "alternate",
    },
  ],
});

describe("generated claim validation", () => {
  it("accepts strict supported claims", () => {
    expect(validateBattleRead(valid(), index)).toMatchObject({ ok: true });
  });

  it.each([
    [
      "unknown evidence",
      (value: ReturnType<typeof valid>) => value.leftRead.evidenceIds.push("made-up"),
    ],
    [
      "no support",
      (value: ReturnType<typeof valid>) => {
        value.rightRead.evidenceIds = [];
        value.rightRead.sampleIds = [];
      },
    ],
    [
      "winner claim",
      (value: ReturnType<typeof valid>) => {
        value.finisher.text = "@alice wins because the score says so.";
      },
    ],
    [
      "identity claim",
      (value: ReturnType<typeof valid>) => {
        value.leftRead.text = "@alice is a genius senior engineer.";
      },
    ],
    [
      "generic profile identity claim",
      (value: ReturnType<typeof valid>) => {
        value.leftRead.text = "@alice is a backend engineer with compact samples.";
      },
    ],
    [
      "identity-label override",
      (value: ReturnType<typeof valid>) => {
        value.leftRead.text = "@alice's real Mogsona is RELEASE GOBLIN.";
      },
    ],
    [
      "appearance claim",
      (value: ReturnType<typeof valid>) => {
        value.leftRead.text = "@alice is handsome because the release log is tidy.";
      },
    ],
    [
      "employability claim",
      (value: ReturnType<typeof valid>) => {
        value.rightRead.text = "@bob looks intelligent and has strong job prospects.";
      },
    ],
    [
      "personal-life claim",
      (value: ReturnType<typeof valid>) => {
        value.rightRead.text = "@bob's family must enjoy those explicit source contracts.";
      },
    ],
    [
      "dishonesty claim",
      (value: ReturnType<typeof valid>) => {
        value.leftRead.text = "@alice is lying about what the public release record shows.";
      },
    ],
    [
      "protected identity claim",
      (value: ReturnType<typeof valid>) => {
        value.leftRead.text = "@alice's gender explains the compact source samples.";
      },
    ],
    [
      "wrongdoing claim",
      (value: ReturnType<typeof valid>) => {
        value.finisher.text = "@alice brought compact flow; @bob brought a scam.";
      },
    ],
    [
      "bare score claim",
      (value: ReturnType<typeof valid>) => {
        value.finisher.text = "The public matchup ends 44–35 once the receipts arrive.";
      },
    ],
    [
      "source excerpt",
      (value: ReturnType<typeof valid>) => {
        value.rightRead.text = "The sample says `const secret = value;` in public.";
      },
    ],
    [
      "unknown field",
      (value: ReturnType<typeof valid>) => {
        (value as unknown as Record<string, unknown>).winner = "left";
      },
    ],
  ])("rejects %s", (_name, mutate) => {
    const value = valid();
    mutate(value);
    expect(validateBattleRead(value, index).ok).toBe(false);
  });

  it("rejects duplicate lines and repeated motifs", () => {
    const value = valid();
    value.alternates[0]!.text = value.finisher.text;
    expect(validateBattleRead(value, index)).toMatchObject({ ok: false });
  });
});
