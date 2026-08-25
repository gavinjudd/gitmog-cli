import { stableStringify } from "@gitmog/github";
import type { BattleResult, ProfileScorecard } from "@gitmog/scoring";

export const canonicalPublicBattleBytes = (battle: BattleResult): string => stableStringify(battle);

export const canonicalPublicProfileBytes = (profile: ProfileScorecard): string =>
  stableStringify(profile);

export function assertCanonicalPublicBattleInvariant(
  before: BattleResult,
  after: BattleResult,
): void {
  if (canonicalPublicBattleBytes(before) !== canonicalPublicBattleBytes(after)) {
    throw new Error("Private Context changed the canonical public battle.");
  }
}

export function assertCanonicalPublicProfileInvariant(
  before: ProfileScorecard,
  after: ProfileScorecard,
): void {
  if (canonicalPublicProfileBytes(before) !== canonicalPublicProfileBytes(after)) {
    throw new Error("Private Context changed the canonical public profile.");
  }
}
