import { collectProfileSnapshot, type ProfileSnapshot } from "@gitmog/github";

import {
  createFixtureFetch,
  FIXTURE_NOW_MS,
  PERSONAS,
  type PersonaName,
  type PersonaSpec,
} from "@gitmog/test-fixtures/github-personas";
import { scoreProfileFastScan } from "../src/fast-scan/scorecard.js";
import type { ProfileScorecard } from "../src/fast-scan/types.js";

/**
 * Personas are collected through the real collector against a fixture `fetch`, so the
 * scoring suite exercises the same path production does — normalisation, selection,
 * budget and all — without a socket.
 */
export async function snapshotFor(persona: PersonaSpec): Promise<ProfileSnapshot> {
  const result = await collectProfileSnapshot(persona.login, {
    fetchImpl: createFixtureFetch(persona),
    cache: null,
    now: () => FIXTURE_NOW_MS,
  });
  if (!result.ok) throw new Error(`fixture ${persona.login} failed: ${result.error.code}`);
  return result.snapshot;
}

export async function scorecardFor(name: PersonaName): Promise<ProfileScorecard> {
  return scoreProfileFastScan(await snapshotFor(PERSONAS[name]));
}

export { FIXTURE_NOW_MS, PERSONAS, type PersonaName };
