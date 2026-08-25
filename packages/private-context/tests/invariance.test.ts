import { describe, expect, it } from "vitest";

import type { BattleResult, ProfileScorecard } from "@gitmog/scoring";

import {
  assertCanonicalPublicBattleInvariant,
  assertCanonicalPublicProfileInvariant,
  canonicalPublicBattleBytes,
} from "../src/invariance.js";

describe("canonical public invariance", () => {
  it("keeps the complete public object byte-identical while private context stays additive", () => {
    const battle = {
      battleKey: "public-key",
      winner: "left",
      score: { left: 61, right: 54 },
      rounds: [{ category: "craft", winner: "left" }],
      evidence: [{ id: "E1", category: "craft" }],
    } as unknown as BattleResult;
    const profile = { login: "fixture-user", score: 61 } as unknown as ProfileScorecard;
    const envelope = {
      evidenceMode: "public-with-private-context",
      publicBattle: battle,
      privateContext: { scoreInfluence: 0, publicWinnerInfluence: 0, persisted: false },
    };
    expect(canonicalPublicBattleBytes(envelope.publicBattle)).toBe(
      canonicalPublicBattleBytes(battle),
    );
    expect(() => assertCanonicalPublicBattleInvariant(battle, envelope.publicBattle)).not.toThrow();
    expect(() => assertCanonicalPublicProfileInvariant(profile, profile)).not.toThrow();
  });

  it("fails closed if any canonical public byte changes", () => {
    const before = { winner: "left", rounds: [] } as unknown as BattleResult;
    const after = { winner: "right", rounds: [] } as unknown as BattleResult;
    expect(() => assertCanonicalPublicBattleInvariant(before, after)).toThrow(
      "Private Context changed the canonical public battle.",
    );
  });
});
