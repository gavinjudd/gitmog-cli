#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (...parts) => readFileSync(resolve(root, ...parts), "utf8");
const ANSI_PATTERN = new RegExp(`${String.fromCodePoint(27)}\\[[0-9;]*m`, "gu");
const stripAnsi = (value) => value.replace(ANSI_PATTERN, "");
const lines = (value) => stripAnsi(value).replaceAll("\r\n", "\n").split("\n");
const failures = [];
const fail = (surface, message) => failures.push(`${surface}: ${message}`);

const ordinary = new Map([
  ["help", fixture("packages/cli/tests/fixtures/terminal-progress/help.txt")],
  ["battle", fixture("packages/cli/tests/fixtures/terminal-output/battle-width-80.txt")],
  ["battle-60", fixture("packages/cli/tests/fixtures/terminal-output/battle-width-60.txt")],
  ["profile", fixture("packages/cli/tests/fixtures/terminal-output/profile-ready.txt")],
  ["mixed", fixture("packages/cli/tests/fixtures/terminal-output/battle-mixed.txt")],
]);
const interactions = new Map(
  [
    "public-auth-opened",
    "public-auth-fallback",
    "private-auth",
    "rate-limit-choice",
    "private-setup-install",
    "private-setup-settings",
  ].map((name) => [name, fixture("packages/cli/tests/fixtures/interaction", `${name}.txt`)]),
);

const bannedPhrases = [
  "the receipts are in",
  "built different",
  "main character energy",
  "the numbers speak for themselves",
  "public evidence machine",
  "score remains honest",
  "every line backed by receipts",
  "unlock the power of",
  "seamless experience",
  "elevate your workflow",
  "robust and comprehensive",
  "game-changing",
  "next-level",
  "it’s giving",
  "in the ever-evolving landscape",
  "whether you’re a beginner or an expert",
];
const unresolved = /\{\{[^}]+\}\}|<UNRESOLVED>|\b(?:TODO|TBD)\b/iu;
for (const [name, value] of [...ordinary, ...interactions]) {
  const lower = stripAnsi(value).toLowerCase();
  for (const phrase of bannedPhrases) {
    if (lower.includes(phrase)) fail(name, `banned phrase "${phrase}"`);
  }
  if (unresolved.test(value)) fail(name, "unresolved marker");
  if (
    /\b(?:battleKey|snapshotKey|requestPlan|authenticationState|scoreInfluence|publicWinnerInfluence|parserVersion|installationId)\b/u.test(
      value,
    )
  ) {
    fail(name, "machine-contract word on an ordinary surface");
  }
}

const technicalUtilityWords =
  /\b(?:API|endpoint|OAuth|bearer token|device flow|request tier|authentication state|permission set|parser-backed|attribution|persistence)\b/iu;
for (const [name, value] of [["help", ordinary.get("help")], ...interactions]) {
  if (technicalUtilityWords.test(value)) fail(name, "technical utility jargon");
}

const widthLimits = new Map([
  ["help", 80],
  ["battle", 80],
  ["battle-60", 60],
  ["profile", 80],
  ["mixed", 80],
  ...[...interactions.keys()].map((name) => [name, 80]),
]);
for (const [name, value] of [...ordinary, ...interactions]) {
  const maximum = widthLimits.get(name) ?? 80;
  const over = lines(value).find((line) => Array.from(line).length > maximum);
  if (over !== undefined) fail(name, `line exceeds ${String(maximum)} columns`);
}

for (const [name, value] of interactions) {
  if (!value.includes("[Enter]")) fail(name, "missing default Enter action");
  if (!value.includes("[q] cancel")) fail(name, "missing cancel path");
  if (/SIGN-IN|PRIVATE REPOS/u.test(value) && /\b(?:WINS|mogged|lore|roast)\b/iu.test(value)) {
    fail(name, "authorization/setup prompt contains battle copy");
  }
  if (value.includes("The browser did not open.") && !value.includes("Open this link:")) {
    fail(name, "browser failure lacks manual fallback");
  }
}

const battle = ordinary.get("battle") ?? "";
for (const line of lines(battle).filter((line) => line.startsWith("» "))) {
  if (!/\[\d+\]/u.test(line)) fail("battle", "meme line lacks visible evidence marker");
}
const mixed = (ordinary.get("mixed") ?? "").replace(/\s+/gu, " ");
if (!mixed.includes("Public coverage:")) {
  fail("mixed", "mixed context lacks explicit public coverage label");
}
if (
  !/(?:winner still uses public repos only|Private repos did not change the winner)/u.test(mixed)
) {
  fail("mixed", "mixed context lacks winner disclosure");
}
const mixedDisclosures = (mixed.match(/winner.*?public repos|Private repos.*?winner/giu) ?? [])
  .length;
if (mixedDisclosures !== 1)
  fail("mixed", `expected one winner disclaimer; found ${String(mixedDisclosures)}`);

if (failures.length > 0) {
  throw new Error(`Copy check failed:\n- ${failures.join("\n- ")}`);
}
console.log(
  `Copy check complete (${String(ordinary.size)} ordinary captures; ${String(interactions.size)} interaction captures; surface-aware jargon, width, action, disclosure, and evidence rules passed).`,
);
